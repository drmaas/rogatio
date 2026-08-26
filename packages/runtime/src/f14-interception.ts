import type { CapabilityProfile, RuntimeActivation } from "./f14-lifecycle.js";

export interface InterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(activation: RuntimeActivation): Promise<void>;
  stop(): Promise<void>;
}

export type InterceptionOutcome =
  | { readonly kind: "active"; readonly provider: string }
  | { readonly kind: "unsupported"; readonly reasons: string[] };

/**
 * Session-bound interception provider management.
 * Replaces the global provider with per-session ownership.
 */
export interface SessionProvider {
  readonly sessionId: string;
  readonly provider: InterceptionProvider;
  readonly activation: RuntimeActivation;
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacOrigins: readonly string[];
  readonly targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  };
  readonly startedAt: number;
}

let registeredProvider: InterceptionProvider | null = null;
let currentSession: SessionProvider | null = null;

/** Register the platform-specific interception provider (used by F15/F17). */
export function registerInterceptionProvider(
  provider: InterceptionProvider,
): void {
  registeredProvider = provider;
}

export function getInterceptionProvider(): InterceptionProvider | null {
  return registeredProvider;
}

export function getCurrentSession(): SessionProvider | null {
  return currentSession;
}

/**
 * Capability-gated interception entry point with session ownership.
 * With no registered provider (this scope) interception is `unsupported`.
 * Activation is never performed unless the provider reports a supported capability profile.
 */
export async function startInterception(
  activation: RuntimeActivation,
  policyDigest: string,
  extensionId: string,
  pacOrigins: readonly string[],
  targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  },
): Promise<InterceptionOutcome> {
  if (registeredProvider === null) {
    return { kind: "unsupported", reasons: ["no-interception-provider"] };
  }
  const capabilities = registeredProvider.detect();
  if (!capabilities.supported) {
    return { kind: "unsupported", reasons: capabilities.reasons };
  }

  // Check for existing session collision
  if (currentSession !== null) {
    return { kind: "unsupported", reasons: ["session-collision"] };
  }

  const sessionId = `session-${activation.startedAt}-${Math.random().toString(36).slice(2)}`;

  // Start provider in non-accepting mode first
  try {
    await registeredProvider.start(activation);
  } catch (error) {
    return {
      kind: "unsupported",
      reasons: ["provider-start-failed", String(error)],
    };
  }

  // Create session record
  currentSession = {
    sessionId,
    provider: registeredProvider,
    activation,
    policyDigest,
    extensionId,
    pacOrigins,
    targetPolicy,
    startedAt: activation.startedAt,
  };

  return { kind: "active", provider: registeredProvider.platform };
}

export async function stopInterception(): Promise<void> {
  if (currentSession === null && registeredProvider === null) return;

  const session = currentSession;
  currentSession = null;

  if (session?.provider) {
    try {
      await session.provider.stop();
    } catch {
      // Best effort cleanup
    }
  }
}

export function hasActiveSession(): boolean {
  return currentSession !== null;
}

export function clearSession(): void {
  currentSession = null;
}
