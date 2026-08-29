import { authorizeExact } from "./authorization.js";
import {
  acquireOperation,
  type CapabilityState,
  closeCapabilityState,
  createCapabilityState,
  findSession,
  pairCapability,
} from "./capability.js";
import { failure } from "./errors.js";
import {
  hasActiveSession,
  type SessionProvider,
  startInterception,
  stopInterception,
} from "./interception.js";
import { mintToken, type RenderedMock, renderMockResponse } from "./mock.js";
import type {
  AuthorizeRequest,
  Envelope,
  EnvelopeInput,
  MockConnectResponse,
  MockRequest,
  MockResponse,
  NativeRuntimeState,
  NormalizedRuntimePreset,
  PairRequest,
  PresetDigest,
  RuntimeMockConfig,
  RuntimeResult,
} from "./types.js";

export interface RuntimeActivation {
  readonly state: "running";
  readonly startedAt: number;
  readonly presetDigest: PresetDigest;
  readonly pacOrigins: readonly string[];
  readonly proxy?: { readonly host: string; readonly port: number };
}

export interface CapabilityProfile {
  readonly supported: boolean;
  readonly reasons: string[];
}

export interface SessionConfig {
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacOrigins: readonly string[];
  readonly targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  };
}

export interface NativeRuntimeControllerOptions {
  readonly preset: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  /** Loopback faucet port the native host binds to serve mock bodies (REQ-003). */
  readonly mockPort?: number;
  readonly onStart?: (
    activation: RuntimeActivation,
    session: SessionProvider | null,
  ) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly clock?: () => number;
}

export interface RuntimeStartResult {
  readonly state:
    | "running"
    | "unsupported"
    | "starting"
    | "stopping"
    | "stopped"
    | "idle";
  readonly activation?: RuntimeActivation;
  readonly session?: SessionProvider | null;
}

export interface NativeRuntimeController {
  start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult>;
  stop(): Promise<{ readonly state: "stopped" | "unsupported" | "idle" }>;
  status(): { readonly state: NativeRuntimeState };
  getSession(): SessionProvider | null;
  /** Resolve a stored mock token to rendered response bytes (loopback faucet). */
  serveMock(token: string): Promise<RuntimeResult<RenderedMock>>;
  /**
   * The single-use bootstrap capability token the extension presents in
   * `pair.request` (spec REQ-005). Returns undefined before start, after the
   * token is consumed, or after the capability state is closed.
   */
  getBootstrapCapability(): string | undefined;
  /**
   * Process a single native-messaging envelope and return the response envelope
   * (spec REQ-001..REQ-005). Throws EnvelopeError for malformed input.
   */
  handleEnvelope(input: EnvelopeInput): Promise<Envelope>;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Consolidated native runtime control plane. A single native-messaging host
 * serves pairing, authorization, and mock delivery (spec REQ-001). Activation is
 * unconditional: the host runs whenever started, independent of any device-local
 * CA / PAC routing capability (spec REQ-004 / assumption D).
 */
export function createNativeRuntimeController(
  options: NativeRuntimeControllerOptions,
): NativeRuntimeController {
  const preset = options.preset;
  const fileRoot = options.fileRoot;
  const mockPort = options.mockPort;
  const clock = options.clock ?? (() => Date.now());

  let state: NativeRuntimeState = "idle";
  let activation: RuntimeActivation | undefined;
  let capability: CapabilityState | undefined;
  const mockTokens = new Map<string, RuntimeMockConfig>();

  return {
    async start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult> {
      if (state === "running" || state === "starting") {
        if (activation) return { state: "running", activation };
        return { state };
      }

      const startedAt = clock();
      capability = createCapabilityState(preset, startedAt);
      mockTokens.clear();
      for (const mock of preset.mocks ?? []) {
        mockTokens.set(mintToken(), mock);
      }
      activation = {
        state: "running",
        startedAt,
        presetDigest: preset.digest,
        pacOrigins: [],
      };

      let session: SessionProvider | null = null;
      if (sessionConfig) {
        const result = await startInterception(
          activation,
          sessionConfig.policyDigest,
          sessionConfig.extensionId,
          sessionConfig.pacOrigins,
          sessionConfig.targetPolicy,
        );
        if (result.kind !== "unsupported") {
          session = hasActiveSession() ? getCurrentSession() : null;
          if (session)
            activation = { ...activation, pacOrigins: session.pacOrigins };
        }
      }

      if (options.onStart) await options.onStart(activation, session);
      state = "running";
      return { state: "running", activation, session };
    },

    async stop() {
      if (state === "idle") {
        state = "stopped";
        return { state: "stopped" };
      }
      if (state === "stopped") {
        return { state: "stopped" };
      }
      state = "stopping";
      if (options.onStop) await options.onStop();
      await stopInterception();
      if (capability) closeCapabilityState(capability);
      mockTokens.clear();
      activation = undefined;
      state = "stopped";
      return { state: "stopped" };
    },

    status() {
      return { state };
    },

    getSession() {
      return hasActiveSession() ? getCurrentSession() : null;
    },

    async serveMock(token: string): Promise<RuntimeResult<RenderedMock>> {
      const mock = mockTokens.get(token);
      if (mock === undefined) return failure("runtime.mock-unknown");
      return renderMockResponse({
        mock,
        fileRoot,
        presetDigest: preset.digest,
      });
    },

    getBootstrapCapability() {
      if (
        capability === undefined ||
        capability.consumed ||
        capability.closed
      ) {
        return undefined;
      }
      return capability.bootstrap;
    },

    async handleEnvelope(input: EnvelopeInput): Promise<Envelope> {
      if (state !== "running" || capability === undefined) {
        throw new Error("runtime not started");
      }
      const now = clock();
      const requestId = input.requestId;
      const timestamp = now;

      switch (input.type) {
        case "pair.request": {
          const meta = input.metadata as unknown as PairRequest;
          const result = pairCapability(
            capability,
            meta.capability,
            meta.presetDigest,
            now,
          );
          const metadata = result.ok
            ? {
                sessionCapability: result.value.sessionCapability,
                expiresInMs: result.value.expiresInMs,
              }
            : {
                sessionCapability: "",
                expiresInMs: 0,
                error: result.error.code,
              };
          return {
            protocol: "v1",
            type: "pair.response",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata,
          };
        }
        case "authorize.request": {
          const meta = input.metadata as unknown as AuthorizeRequest;
          const session = findSession(
            capability,
            meta.sessionCapability,
            meta.presetDigest,
            now,
          );
          if (session === null) {
            return {
              protocol: "v1",
              type: "authorize.response",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                authorized: false,
                error: "runtime.authorization-denied",
              },
            };
          }
          const op = acquireOperation(capability, session);
          if (!op.ok) {
            return {
              protocol: "v1",
              type: "authorize.response",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: { authorized: false, error: op.error.code },
            };
          }
          const result = authorizeExact(preset, meta.descriptor);
          op.value();
          if (!result.ok) {
            return {
              protocol: "v1",
              type: "authorize.response",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: { authorized: false, error: result.error.code },
            };
          }
          const op2 = result.value;
          return {
            protocol: "v1",
            type: "authorize.response",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: {
              authorized: true,
              groupId: op2.groupId,
              ruleId: op2.ruleId,
              operationId: op2.operationId,
              kind: op2.kind,
              target: op2.target,
              method: op2.method,
            },
          };
        }
        case "mock.connect": {
          // The host is already bound to a single preset at start(); return its
          // mock tokens. The request presetDigest (if any) is informational and
          // not required to match (spec REQ-003).
          const mocks = [...mockTokens.entries()].map(([token, mock]) => ({
            ruleId: mock.ruleId,
            token,
          }));
          const metadata: MockConnectResponse = {
            protocol: "v1",
            presetDigest: preset.digest,
            mocks,
            ...(mockPort !== undefined ? { port: mockPort } : {}),
          };
          return {
            protocol: "v1",
            type: "mock.connect",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata,
          };
        }
        case "mock.request": {
          const meta = input.metadata as unknown as MockRequest;
          const mock = mockTokens.get(meta.token);
          if (mock === undefined) {
            const body = JSON.stringify({
              ok: false,
              error: { code: "runtime.mock-unknown" },
            });
            const metadata: MockResponse = {
              status: 404,
              headers: [["Content-Type", "application/json"]],
              mockBody: base64(new TextEncoder().encode(body)),
            };
            return {
              protocol: "v1",
              type: "mock.response",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata,
            };
          }
          return renderMock(mock, requestId, timestamp);
        }
        case "runtime.status": {
          return {
            protocol: "v1",
            type: "runtime.status",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { state, presetDigest: preset.digest },
          };
        }
        default: {
          return {
            protocol: "v1",
            type: input.type,
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { error: "runtime.request-malformed" },
          };
        }
      }
    },
  };

  async function renderMock(
    mock: RuntimeMockConfig,
    requestId: string | undefined,
    timestamp: number,
  ): Promise<Envelope> {
    if (mock.delayMs !== undefined) await delay(mock.delayMs);
    const rendered = await renderMockResponse({
      mock,
      fileRoot,
      presetDigest: preset.digest,
    });
    if (!rendered.ok) {
      const body = JSON.stringify({
        ok: false,
        error: { code: rendered.error.code },
      });
      const metadata: MockResponse = {
        status: 500,
        headers: [["Content-Type", "application/json"]],
        mockBody: base64(new TextEncoder().encode(body)),
      };
      return {
        protocol: "v1",
        type: "mock.response",
        ...(requestId !== undefined ? { requestId } : {}),
        timestamp,
        metadata,
      };
    }
    const headers: Array<readonly [string, string]> = [];
    for (const header of rendered.value.headers) {
      headers.push([header[0], header[1]]);
    }
    const metadata: MockResponse = {
      status: rendered.value.status,
      headers,
      mockBody: base64(rendered.value.bodyBytes),
    };
    return {
      protocol: "v1",
      type: "mock.response",
      ...(requestId !== undefined ? { requestId } : {}),
      timestamp,
      metadata,
    };
  }
}

function getCurrentSession(): SessionProvider | null {
  return null;
}
