import { compileProject, type RogatioOperation } from "@rogatio/compiler";
import { validateProjectDetailed } from "@rogatio/schema";
import {
  type AIClient,
  type AIProviderConfig,
  type ChatMessage,
  createAIClient,
} from "./ai-client.js";
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
import { RUNTIME_LIMITS } from "./limits.js";
import { mintToken, type RenderedMock, renderMockResponse } from "./mock.js";
import { normalizeRuntimePreset } from "./preset.js";
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
  readonly preset?: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  /** Loopback faucet port the native host binds to serve mock bodies (REQ-003). */
  readonly mockPort?: number;
  readonly onStart?: (
    activation: RuntimeActivation,
    session: SessionProvider | null,
  ) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly clock?: () => number;
  /** Optional AI provider config for AI completions via native messaging. */
  readonly aiProviderConfig?: AIProviderConfig;
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
 *
 * When `preset` is omitted, the controller enters "deferred" mode: it stays idle
 * until a `runtime.project.set` envelope arrives with the project data, which
 * is validated, compiled, and used to build the preset before starting.
 */
export function createNativeRuntimeController(
  options: NativeRuntimeControllerOptions,
): NativeRuntimeController {
  let preset: NormalizedRuntimePreset | undefined = options.preset;
  const fileRoot = options.fileRoot;
  const mockPort = options.mockPort;
  const clock = options.clock ?? (() => Date.now());

  let state: NativeRuntimeState = "idle";
  let activation: RuntimeActivation | undefined;
  let capability: CapabilityState | undefined;
  const mockTokens = new Map<string, RuntimeMockConfig>();

  // Initialize AI client if config provided
  let aiClient: AIClient | undefined;
  if (options.aiProviderConfig) {
    aiClient = createAIClient(options.aiProviderConfig);
  }

  return {
    async start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult> {
      if (state === "running" || state === "starting") {
        if (activation) return { state: "running", activation };
        return { state };
      }

      // If no preset yet, stay idle (waiting for runtime.project.set)
      if (!preset) {
        return { state: "idle" };
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
      if (!preset) throw new Error("runtime not started");
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
      const now = clock();
      const requestId = input.requestId;
      const timestamp = now;

      // Handle runtime.project.set in idle state (deferred project loading)
      if (input.type === "runtime.project.set" && state === "idle") {
        const projectData = input.metadata.project as unknown;
        if (!projectData || typeof projectData !== "object") {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.project-missing" },
          };
        }

        const schemaResult = validateProjectDetailed(projectData);
        if (!schemaResult.valid) {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.project-invalid" },
          };
        }

        const compileResult = compileProject(schemaResult.data);
        if (!compileResult.ok) {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: {
              ok: false,
              error: "runtime.compile-failed",
              diagnostics: compileResult.diagnostics,
            },
          };
        }

        const matcherOps: RogatioOperation[] = [];
        const mockConfigs: RuntimeMockConfig[] = [];
        for (const op of compileResult.operations) {
          if (op.kind === "mock") {
            const mock = op.mock;
            let file: string | undefined;
            if (mock.file !== undefined) {
              file = mock.file;
            }
            mockConfigs.push({
              ruleId: op.ruleId,
              status: mock.status,
              ...(mock.headers !== undefined ? { headers: mock.headers } : {}),
              ...(mock.delayMs !== undefined ? { delayMs: mock.delayMs } : {}),
              ...(mock.body !== undefined ? { body: mock.body } : {}),
              ...(file !== undefined ? { file } : {}),
            });
          }
          // Include all operations with a matcher field (including mocks)
          // so normalizeRuntimePreset can match mock ruleIds to their matchers.
          // Convert to MatcherOperation shape since the normalizer expects kind="matcher".
          if ("matcher" in op) {
            matcherOps.push({
              kind: "matcher",
              groupId: op.groupId,
              ruleId: op.ruleId,
              matcher: (op as { matcher: unknown }).matcher,
            } as RogatioOperation);
          }
        }

        const presetInput = {
          version: 1,
          limits: RUNTIME_LIMITS,
          matchers: matcherOps,
          grants: [],
          ...(mockConfigs.length > 0 ? { mocks: mockConfigs } : {}),
        };
        console.error(
          "[rogatio-host] normalizeRuntimePreset input: matchers=",
          matcherOps.length,
          "mocks=",
          mockConfigs.length,
          "grants=0",
        );
        const normalized = normalizeRuntimePreset(presetInput);
        console.error(
          "[rogatio-host] normalizeRuntimePreset result: ok=",
          normalized.ok,
        );

        if (!normalized.ok) {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.preset-invalid" },
          };
        }

        preset = normalized.value;

        // Start the controller now that we have a preset
        const startResult = await this.start();
        if (startResult.state !== "running") {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.start-failed" },
          };
        }

        return {
          protocol: "v1",
          type: "runtime.project.set",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: { ok: true, presetDigest: preset.digest },
        };
      }

      // All other envelopes require running state
      if (state !== "running" || capability === undefined) {
        throw new Error("runtime not started");
      }

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
          if (!preset) throw new Error("runtime not started");
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
          if (!preset) throw new Error("runtime not started");
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
          if (!preset) throw new Error("runtime not started");
          return {
            protocol: "v1",
            type: "runtime.status",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { state, presetDigest: preset.digest },
          };
        }
        case "ai.complete": {
          if (!aiClient) {
            return {
              protocol: "v1",
              type: "ai.error",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                code: "ai.not-configured",
                message: "AI provider not configured",
                retryable: false,
              },
            };
          }
          const meta = input.metadata as {
            messages: readonly {
              role: "system" | "user" | "assistant" | "tool";
              content: string;
            }[];
            model: string;
            temperature?: number;
            responseFormat?: { type: "json_object" };
          };
          try {
            const result = await aiClient.complete({
              messages: [...meta.messages] as ChatMessage[],
              model: meta.model,
              temperature: meta.temperature,
              responseFormat: meta.responseFormat,
            });
            return {
              protocol: "v1",
              type: "ai.complete",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                content: result.content,
                usage: result.usage,
              },
            };
          } catch (e) {
            return {
              protocol: "v1",
              type: "ai.error",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                code: "ai.error",
                message:
                  e instanceof Error ? e.message : "AI completion failed",
                retryable: true,
              },
            };
          }
        }
        case "ai.stream.chunk": {
          if (!aiClient) {
            return {
              protocol: "v1",
              type: "ai.error",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                code: "ai.not-configured",
                message: "AI provider not configured",
                retryable: false,
              },
            };
          }
          const meta = input.metadata as {
            messages: readonly {
              role: "system" | "user" | "assistant" | "tool";
              content: string;
            }[];
            model: string;
            temperature?: number;
          };
          try {
            for await (const chunk of aiClient.stream({
              messages: [...meta.messages] as ChatMessage[],
              model: meta.model,
              temperature: meta.temperature,
            })) {
              // For streaming, we return each chunk as a separate envelope
              // The caller (extension) will need to handle multiple envelopes
              return {
                protocol: "v1",
                type: "ai.stream.chunk",
                ...(requestId !== undefined ? { requestId } : {}),
                timestamp,
                metadata: {
                  delta: chunk.delta,
                  done: chunk.done,
                  usage: chunk.usage,
                },
              };
            }
            // If stream ends without done=true, return final chunk
            return {
              protocol: "v1",
              type: "ai.stream.chunk",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                delta: "",
                done: true,
                usage: undefined,
              },
            };
          } catch (e) {
            return {
              protocol: "v1",
              type: "ai.error",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: {
                code: "ai.error",
                message: e instanceof Error ? e.message : "AI streaming failed",
                retryable: true,
              },
            };
          }
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
    if (!preset) throw new Error("runtime not started");
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
