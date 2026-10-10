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
import { type DirectoryPick, pickDirectory } from "./directory-picker.js";
import { failure } from "./errors.js";
import { resolveConfinedRoot } from "./file-root.js";
import {
  getCurrentSession,
  hasActiveSession,
  type SessionProvider,
  startInterception,
  stopInterception,
} from "./interception.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { mintToken, type RenderedMock, renderMockResponse } from "./mock.js";
import {
  clearMockFileError,
  listMockFileErrors,
  recordMockFileError,
} from "./mock-errors.js";
import { normalizeRuntimePreset, parseEnabledGroupIds } from "./preset.js";
import {
  matchersFromOperations,
  mocksFromOperations,
} from "./project-preset.js";
import type {
  AIStatusMetadata,
  AuthorizeRequest,
  Envelope,
  EnvelopeInput,
  MockConnectResponse,
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
  readonly pacRoutes: readonly string[];
  readonly proxy?: { readonly host: string; readonly port: number };
  /** Exact local origins supplied when interception starts. */
  readonly localOrigins?: readonly string[];
}

export interface CapabilityProfile {
  readonly supported: boolean;
  readonly reasons: string[];
}

export interface SessionConfig {
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacRoutes: readonly string[];
  /** Start the response-body listener even when there are no PAC routes. */
  readonly contentListener?: boolean;
  readonly targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  };
}

export interface NativeRuntimeControllerOptions {
  readonly preset?: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  readonly onStart?: (
    activation: RuntimeActivation,
    session: SessionProvider | null,
  ) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly clock?: () => number;
  /** Optional AI provider config for AI completions via native messaging. */
  readonly aiProviderConfig?: AIProviderConfig;
  /**
   * Optional reader for re-reading the AI provider config while the host runs.
   * When present, every AI envelope refreshes the config and rebuilds the client
   * when it changed, so `rogatio ai setup` takes effect without a host restart
   * (spec REQ-003). When absent, the launch-time `aiProviderConfig` stays in
   * force unchanged.
   */
  readonly aiConfigReader?: () => Promise<AIProviderConfig | null>;
  /**
   * Opens the system folder dialog. Tests inject this so a host envelope
   * never waits on a real dialog.
   */
  readonly directoryPicker?: () => Promise<DirectoryPick>;
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

export interface ActiveRuntimePolicy {
  readonly project: unknown;
  readonly operations: readonly RogatioOperation[];
  readonly presetDigest: string;
}

export interface NativeRuntimeController {
  start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult>;
  stop(): Promise<{ readonly state: "stopped" | "unsupported" | "idle" }>;
  status(): { readonly state: NativeRuntimeState };
  getSession(): SessionProvider | null;
  /** Immutable active policy retained from `runtime.project.set`. */
  getActivePolicy(): ActiveRuntimePolicy | null;
  /** Resolve a stored mock token to rendered response bytes (loopback faucet). */
  serveMock(
    token: string,
    options?: {
      readonly method?: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<RuntimeResult<RenderedMock>>;
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
  let fileRoot = options.fileRoot;
  const clock = options.clock ?? (() => Date.now());
  const directoryPicker = options.directoryPicker ?? pickDirectory;
  const mockFileErrors = new Map<string, string>();

  let state: NativeRuntimeState = "idle";
  let activation: RuntimeActivation | undefined;
  let capability: CapabilityState | undefined;
  let activePolicy: ActiveRuntimePolicy | null = null;
  const mockTokens = new Map<string, RuntimeMockConfig>();

  // AI provider config in force and its client. When `aiConfigReader` is wired,
  // both are refreshed on every AI envelope so config changes take effect
  // without a host restart and the reported metadata can never disagree with
  // the client (spec REQ-003).
  let aiConfigInForce: AIProviderConfig | null =
    options.aiProviderConfig ?? null;
  let aiClient: AIClient | undefined;
  if (aiConfigInForce) {
    aiClient = createAIClient(aiConfigInForce);
  }

  function isUsableAIProviderConfig(value: unknown): value is AIProviderConfig {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return (
      typeof record.providerUrl === "string" &&
      record.providerUrl.length > 0 &&
      typeof record.model === "string" &&
      record.model.length > 0 &&
      typeof record.apiKey === "string" &&
      record.apiKey.length > 0
    );
  }

  function canonicalAIConfig(config: AIProviderConfig | null): string {
    return config === null
      ? "null"
      : JSON.stringify([config.providerUrl, config.model, config.apiKey]);
  }

  async function refreshAIProviderConfig(): Promise<AIProviderConfig | null> {
    const reader = options.aiConfigReader;
    if (!reader) return aiConfigInForce;
    let next: AIProviderConfig | null = null;
    try {
      const read = await reader();
      next = isUsableAIProviderConfig(read) ? read : null;
    } catch {
      // A malformed or unreadable config file reports unconfigured: never a
      // throw, never partial metadata (spec REQ-001, REQ-010).
      next = null;
    }
    if (canonicalAIConfig(next) !== canonicalAIConfig(aiConfigInForce)) {
      aiConfigInForce = next;
      aiClient = next ? createAIClient(next) : undefined;
    }
    return aiConfigInForce;
  }

  async function bindInterception(
    current: RuntimeActivation,
    sessionConfig: SessionConfig,
  ): Promise<{
    activation: RuntimeActivation;
    session: SessionProvider | null;
    interception: { active: boolean; reasons: string[] };
  }> {
    if (
      sessionConfig.pacRoutes.length === 0 &&
      sessionConfig.contentListener !== true
    ) {
      return {
        activation: { ...current, pacRoutes: [] },
        session: null,
        interception: { active: false, reasons: ["no-pac-routes"] },
      };
    }
    if (hasActiveSession()) {
      const session = getCurrentSession();
      return {
        activation: current,
        session,
        interception: {
          active: session !== null,
          reasons: session !== null ? [] : ["session-missing"],
        },
      };
    }
    const result = await startInterception(
      current,
      sessionConfig.policyDigest,
      sessionConfig.extensionId,
      sessionConfig.pacRoutes,
      {
        public: sessionConfig.targetPolicy.public,
        localOrigins: sessionConfig.targetPolicy.localOrigins,
      },
    );
    if (result.kind === "unsupported") {
      return {
        activation: current,
        session: null,
        interception: { active: false, reasons: [...result.reasons] },
      };
    }
    const session = getCurrentSession();
    const next: RuntimeActivation = {
      ...current,
      pacRoutes: sessionConfig.pacRoutes,
      proxy: result.proxy,
    };
    return {
      activation: next,
      session,
      interception: { active: true, reasons: [] },
    };
  }

  return {
    async start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult> {
      if (state === "running" || state === "starting") {
        if (sessionConfig && activation) {
          const bound = await bindInterception(activation, sessionConfig);
          activation = bound.activation;
          return {
            state: "running",
            activation,
            session: bound.session,
          };
        }
        if (activation) return { state: "running", activation };
        return { state };
      }

      // If no preset yet, stay idle (waiting for runtime.project.set)
      if (!preset) {
        return { state: "idle" };
      }

      const startedAt = clock();
      capability = createCapabilityState(preset, startedAt);
      mockFileErrors.clear();
      mockTokens.clear();
      for (const mock of preset.mocks ?? []) {
        mockTokens.set(mintToken(), mock);
      }
      activation = {
        state: "running",
        startedAt,
        presetDigest: preset.digest,
        pacRoutes: sessionConfig?.pacRoutes ?? [],
      };

      let session: SessionProvider | null = null;
      if (sessionConfig) {
        const bound = await bindInterception(activation, sessionConfig);
        activation = bound.activation;
        session = bound.session;
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
      mockFileErrors.clear();
      if (options.onStop) await options.onStop();
      await stopInterception();
      if (capability) closeCapabilityState(capability);
      mockTokens.clear();
      activation = undefined;
      activePolicy = null;
      state = "stopped";
      return { state: "stopped" };
    },

    status() {
      return { state };
    },

    getSession() {
      return hasActiveSession() ? getCurrentSession() : null;
    },

    getActivePolicy() {
      return activePolicy;
    },

    async serveMock(
      token: string,
      options?: {
        readonly method?: string;
        readonly signal?: AbortSignal;
      },
    ): Promise<RuntimeResult<RenderedMock>> {
      const mock = mockTokens.get(token);
      if (mock === undefined || state !== "running" || preset === undefined) {
        return failure("runtime.mock-unknown");
      }
      const method = options?.method?.toUpperCase();
      const matcher = preset.matchers.find(
        (candidate) => candidate.ruleId === mock.ruleId,
      );
      if (method !== undefined) {
        if (matcher === undefined) return failure("runtime.mock-unknown");
        if (
          matcher.matcher.method !== undefined &&
          matcher.matcher.method !== method
        ) {
          return failure("runtime.unsupported-method");
        }
      }
      const rendered = await renderMockResponse({
        mock,
        fileRoot,
        presetDigest: preset.digest,
        ...(method !== undefined ? { method } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (!rendered.ok) {
        recordMockFileError(mockFileErrors, mock.ruleId, rendered.error.code);
        return rendered;
      }
      if (mock.file !== undefined)
        clearMockFileError(mockFileErrors, mock.ruleId);
      return rendered;
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

        const metadata = input.metadata;
        if (metadata === null || typeof metadata !== "object") {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.project-missing" },
          };
        }
        const enabledGroups = parseEnabledGroupIds(
          metadata,
          schemaResult.data.groups.map((group) => group.id),
        );
        if (!enabledGroups.ok) {
          return {
            protocol: "v1",
            type: "runtime.project.set",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: enabledGroups.error.code },
          };
        }
        if (Object.hasOwn(metadata, "fileRoot")) {
          const resolvedRoot = await resolveConfinedRoot(
            (metadata as Record<string, unknown>).fileRoot,
          );
          if (!resolvedRoot.ok) {
            return {
              protocol: "v1",
              type: "runtime.project.set",
              ...(requestId !== undefined ? { requestId } : {}),
              timestamp,
              metadata: { ok: false, error: resolvedRoot.error.code },
            };
          }
          fileRoot = resolvedRoot.value;
        }

        const matcherOps = matchersFromOperations(compileResult.operations);
        const mocks = mocksFromOperations(
          compileResult.operations,
          enabledGroups.value,
        );
        const presetInput = {
          version: 1,
          limits: RUNTIME_LIMITS,
          matchers: matcherOps,
          grants: [],
          ...(mocks.length > 0 ? { mocks } : {}),
        };
        console.error(
          "[rogatio-host] normalizeRuntimePreset input: matchers=",
          matcherOps.length,
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
        activePolicy = {
          project: schemaResult.data,
          operations: compileResult.operations,
          presetDigest: preset.digest,
        };

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

      if (input.type === "runtime.project.set" && state === "running") {
        return {
          protocol: "v1",
          type: "runtime.project.set",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: { ok: false, error: "runtime.already-started" },
        };
      }

      if (input.type === "runtime.start") {
        if (state === "idle" || !preset || activation === undefined) {
          return {
            protocol: "v1",
            type: "runtime.start",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: {
              ok: false,
              error: "runtime.not-ready",
              interception: { active: false, reasons: ["not-ready"] },
            },
          };
        }
        const meta = input.metadata as {
          policyDigest?: string;
          extensionId?: string;
          pacRoutes?: readonly string[];
          contentListener?: boolean;
          requestUrl?: string;
          targetPolicy?: {
            public?: boolean;
            publicAllowed?: boolean;
            localOrigins?: readonly string[];
          };
        };
        const sessionConfig: SessionConfig = {
          policyDigest:
            typeof meta.policyDigest === "string" ? meta.policyDigest : "",
          extensionId:
            typeof meta.extensionId === "string" ? meta.extensionId : "",
          pacRoutes: Array.isArray(meta.pacRoutes) ? meta.pacRoutes : [],
          contentListener: meta.contentListener === true,
          targetPolicy: {
            public:
              meta.targetPolicy?.public === true ||
              meta.targetPolicy?.publicAllowed === true,
            localOrigins: Array.isArray(meta.targetPolicy?.localOrigins)
              ? meta.targetPolicy.localOrigins
              : [],
          },
        };
        const bound = await bindInterception(activation, sessionConfig);
        activation = bound.activation;
        return {
          protocol: "v1",
          type: "runtime.start",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: {
            ok: bound.interception.active,
            interception: bound.interception,
            ...(activation.proxy !== undefined
              ? { proxy: activation.proxy }
              : {}),
            pacRoutes: activation.pacRoutes,
          },
        };
      }

      if (input.type === "runtime.stop") {
        await this.stop();
        return {
          protocol: "v1",
          type: "runtime.stop",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: { ok: true, state: "stopped" },
        };
      }

      if (input.type === "runtime.pick-directory") {
        const picked = await directoryPicker();
        if (!picked.ok) {
          return {
            protocol: "v1",
            type: "runtime.pick-directory",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: picked.code },
          };
        }
        if (picked.path === null) {
          return {
            protocol: "v1",
            type: "runtime.pick-directory",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: true, cancelled: true },
          };
        }
        const resolved = await resolveConfinedRoot(picked.path);
        return {
          protocol: "v1",
          type: "runtime.pick-directory",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: resolved.ok
            ? { ok: true, path: resolved.value }
            : { ok: false, error: resolved.error.code },
        };
      }

      if (input.type === "runtime.set-file-root") {
        if (state !== "running") {
          return {
            protocol: "v1",
            type: "runtime.set-file-root",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: "runtime.not-started" },
          };
        }
        const candidate = input.metadata.path;
        if (candidate === undefined || candidate === null || candidate === "") {
          fileRoot = undefined;
          mockFileErrors.clear();
          return {
            protocol: "v1",
            type: "runtime.set-file-root",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: true, cleared: true },
          };
        }
        const resolved = await resolveConfinedRoot(candidate);
        if (!resolved.ok) {
          return {
            protocol: "v1",
            type: "runtime.set-file-root",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: { ok: false, error: resolved.error.code },
          };
        }
        fileRoot = resolved.value;
        mockFileErrors.clear();
        return {
          protocol: "v1",
          type: "runtime.set-file-root",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: { ok: true, path: resolved.value },
        };
      }

      if (input.type === "runtime.check-directory") {
        const candidate = input.metadata.path;
        const resolved = await resolveConfinedRoot(candidate);
        return {
          protocol: "v1",
          type: "runtime.check-directory",
          ...(requestId !== undefined ? { requestId } : {}),
          timestamp,
          metadata: resolved.ok
            ? { ok: true, path: resolved.value }
            : { ok: false, error: resolved.error.code },
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
          const descriptorRecord =
            typeof meta.descriptor === "object" && meta.descriptor !== null
              ? (meta.descriptor as { target?: string })
              : {};
          const requestUrl =
            typeof meta.requestUrl === "string" && meta.requestUrl.length > 0
              ? meta.requestUrl
              : typeof descriptorRecord.target === "string"
                ? descriptorRecord.target
                : "";
          const result = authorizeExact(preset, meta.descriptor, requestUrl);
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
          };
          return {
            protocol: "v1",
            type: "mock.connect",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata,
          };
        }
        case "runtime.status": {
          if (!preset) throw new Error("runtime not started");
          return {
            protocol: "v1",
            type: "runtime.status",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata: {
              state,
              presetDigest: preset.digest,
              mockFileErrors: listMockFileErrors(mockFileErrors),
            },
          };
        }
        case "ai.status": {
          const config = await refreshAIProviderConfig();
          const metadata: AIStatusMetadata =
            config !== null
              ? {
                  configured: true,
                  providerUrl: config.providerUrl,
                  model: config.model,
                }
              : { configured: false };
          return {
            protocol: "v1",
            type: "ai.status",
            ...(requestId !== undefined ? { requestId } : {}),
            timestamp,
            metadata,
          };
        }
        case "ai.complete": {
          await refreshAIProviderConfig();
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
              model: meta.model || aiConfigInForce?.model || "",
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
          await refreshAIProviderConfig();
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
              model: meta.model || aiConfigInForce?.model || "",
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
}
