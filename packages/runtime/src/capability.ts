import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { failure, runtimeError } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type {
  NormalizedRuntimePreset,
  PresetDigest,
  RuntimeResult,
} from "./types.js";

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;

interface StoredSession {
  readonly digest: Buffer;
  readonly expiresAt: number;
  readonly tokenDigest: Buffer;
  activeOperations: number;
}

export interface CapabilityState {
  readonly presetDigest: PresetDigest;
  readonly bootstrap: string;
  readonly bootstrapDigest: Buffer;
  readonly bootstrapExpiresAt: number;
  readonly sessions: StoredSession[];
  consumed: boolean;
  closed: boolean;
}

export function createCapabilityState(
  preset: NormalizedRuntimePreset,
  now: number,
): CapabilityState {
  const bootstrap = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    presetDigest: preset.digest,
    bootstrap,
    bootstrapDigest: digestToken(bootstrap),
    bootstrapExpiresAt: now + RUNTIME_LIMITS.bootstrapLifetimeMs,
    sessions: [],
    consumed: false,
    closed: false,
  };
}

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== TOKEN_LENGTH) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").length === TOKEN_BYTES;
  } catch {
    return false;
  }
}

function sameToken(value: string, expectedDigest: Buffer): boolean {
  const actual = digestToken(value);
  return (
    actual.length === expectedDigest.length &&
    timingSafeEqual(actual, expectedDigest)
  );
}

function sameDigest(value: string, expected: string): boolean {
  if (!/^sha256:[0-9a-f]{64}$/.test(value) || value.length !== expected.length)
    return false;
  const actual = Buffer.from(value, "ascii");
  const wanted = Buffer.from(expected, "ascii");
  return timingSafeEqual(actual, wanted);
}

function cleanSessions(state: CapabilityState, now: number): void {
  for (let index = state.sessions.length - 1; index >= 0; index -= 1) {
    if (state.sessions[index]?.expiresAt <= now)
      state.sessions.splice(index, 1);
  }
}

export function pairCapability(
  state: CapabilityState,
  capability: unknown,
  digest: unknown,
  now: number,
): RuntimeResult<{ sessionCapability: string; expiresInMs: number }> {
  cleanSessions(state, now);
  if (
    state.closed ||
    state.consumed ||
    !isToken(capability) ||
    typeof digest !== "string" ||
    !sameDigest(digest, state.presetDigest) ||
    now >= state.bootstrapExpiresAt ||
    !sameToken(capability, state.bootstrapDigest)
  ) {
    return failure("runtime.pairing-denied");
  }
  if (state.sessions.length >= RUNTIME_LIMITS.maxConcurrentSessions) {
    return failure("runtime.overloaded");
  }

  state.consumed = true;
  const sessionCapability = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = now + RUNTIME_LIMITS.sessionLifetimeMs;
  state.sessions.push({
    digest: Buffer.from(state.presetDigest, "ascii"),
    expiresAt,
    tokenDigest: digestToken(sessionCapability),
    activeOperations: 0,
  });
  return {
    ok: true,
    value: {
      sessionCapability,
      expiresInMs: RUNTIME_LIMITS.sessionLifetimeMs,
    },
  };
}

export function findSession(
  state: CapabilityState,
  capability: unknown,
  digest: unknown,
  now: number,
): StoredSession | null {
  cleanSessions(state, now);
  if (state.closed || !isToken(capability) || typeof digest !== "string")
    return null;
  if (!sameDigest(digest, state.presetDigest)) return null;
  const candidate = digestToken(capability);
  for (const session of state.sessions) {
    if (
      candidate.length === session.tokenDigest.length &&
      timingSafeEqual(candidate, session.tokenDigest) &&
      sameDigest(digest, session.digest.toString("ascii"))
    ) {
      return session;
    }
  }
  return null;
}

export function acquireOperation(
  _state: CapabilityState,
  session: StoredSession,
): RuntimeResult<() => void> {
  if (session.activeOperations >= RUNTIME_LIMITS.maxOperationsPerSession) {
    return failure("runtime.overloaded");
  }
  session.activeOperations += 1;
  return {
    ok: true,
    value: () => {
      session.activeOperations = Math.max(0, session.activeOperations - 1);
    },
  };
}

export function closeCapabilityState(state: CapabilityState): void {
  state.closed = true;
  state.consumed = true;
  state.sessions.length = 0;
  state.bootstrapDigest.fill(0);
}

export function capabilityError(): ReturnType<typeof runtimeError> {
  return runtimeError("runtime.pairing-denied");
}
