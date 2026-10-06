import {
  compileProject,
  encodePacSteer,
  isPacSafeSource,
  literalHostname,
  type MockOperation,
  type RogatioOperation,
  steeredRequestOrigin,
} from "@rogatio/compiler";
import { formatSha256, validateProjectDetailed } from "@rogatio/schema";
import {
  type BodyMarkerProbeGates,
  DEFAULT_BODY_MARKER_PROBE_GATES,
  installSessionBodyMarkers,
  removeSessionBodyMarkers,
} from "./body-marker-lifecycle.js";
import type { ChromeApi } from "./chrome.js";
import { isNativeHostOriginForbiddenMessage } from "./extension-id.js";
import {
  dropMockRedirectBandFromMatchIndex,
  mergeMockRedirectIndexEntries,
} from "./match-index.js";
import { installMockRedirects, removeMockRedirects } from "./mock-redirect.js";
import {
  installResponseBodyRedirects,
  removeResponseBodyRedirects,
} from "./response-body-redirect.js";

/** Remove mock session redirects and drop their match-index entries. */
async function clearMockRedirects(api: ChromeApi): Promise<void> {
  await removeMockRedirects(api);
  await dropMockRedirectBandFromMatchIndex(api);
}

/**
 * Local structural copy of the native host envelope wire shape. The extension
 * must not depend on the runtime package (package-boundary rule), so the envelope
 * type is redefined here rather than imported from `@rogatio/runtime`.
 */
export interface NativeEnvelopeInput {
  readonly protocol: "v1";
  readonly type: string;
  readonly requestId?: string;
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
}

export type NativeEnvelope = NativeEnvelopeInput;

/** Response envelope types that may not have timestamp (for AI responses). */
type NativeEnvelopeResponse = {
  readonly protocol: "v1";
  readonly type: string;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly metadata: Record<string, unknown>;
};

// AI envelope types
export interface AICompleteRequest {
  readonly protocol: "v1";
  readonly type: "ai.complete";
  readonly requestId: string;
  readonly metadata: {
    readonly messages: readonly {
      readonly role: "system" | "user" | "assistant" | "tool";
      readonly content: string;
    }[];
    readonly model: string;
    readonly temperature?: number;
    readonly responseFormat?: { readonly type: "json_object" };
  };
}

export interface AIStreamChunkRequest {
  readonly protocol: "v1";
  readonly type: "ai.stream.chunk";
  readonly requestId: string;
  readonly metadata: {
    readonly messages: readonly {
      readonly role: "system" | "user" | "assistant" | "tool";
      readonly content: string;
    }[];
    readonly model: string;
    readonly temperature?: number;
  };
}

export interface AICompleteResponse {
  readonly protocol: "v1";
  readonly type: "ai.complete";
  readonly requestId: string;
  readonly metadata: {
    readonly content: string;
    readonly usage?: {
      readonly promptTokens: number;
      readonly completionTokens: number;
    };
  };
}

export interface AIStreamChunkResponse {
  readonly protocol: "v1";
  readonly type: "ai.stream.chunk";
  readonly requestId: string;
  readonly metadata: {
    readonly delta: string;
    readonly done: boolean;
    readonly usage?: {
      readonly promptTokens: number;
      readonly completionTokens: number;
    };
  };
}

export interface AIErrorResponse {
  readonly protocol: "v1";
  readonly type: "ai.error";
  readonly requestId: string;
  readonly metadata: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

async function createHash(
  algorithm: string,
  data: Uint8Array,
): Promise<string> {
  const normalized =
    algorithm.replace("-", "").toLowerCase() === "sha256"
      ? "SHA-256"
      : "SHA-256";
  const hash = await crypto.subtle.digest(normalized, data as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface NativeSessionOptions {
  readonly extensionId: string;
  readonly nativeRuntime: {
    start(config: NativeRuntimeConfig): Promise<{
      state: string;
      message?: string;
      proxy?: { readonly host: string; readonly port: number };
    }>;
    stop(): Promise<{ state: string }>;
    status(): Promise<{ state: string }>;
    sendPolicy(frames: Uint8Array[]): Promise<void>;
    /**
     * Send a single envelope to the consolidated native host and resolve with
     * the response envelope. Optional: only present when the host supports the
     * envelope protocol (spec REQ-001).
     */
    send?(envelope: NativeEnvelopeInput): Promise<NativeEnvelope>;
  };
  readonly getProject: () => Promise<{
    data: unknown;
    enabledGroupIds: readonly string[];
    fileRoot?: string;
  } | null>;
  /**
   * Session body URL-match markers for match logging. Install only when
   * `runtimeStripPathAvailable` is true (fail-closed). No F17 capability mint.
   */
  readonly bodyMarkers?: {
    readonly api: ChromeApi;
    readonly runtimeStripPathAvailable: boolean;
    readonly probeGates?: BodyMarkerProbeGates;
  };
}

export interface NativeRuntimeConfig {
  readonly sessionId: string;
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacRoutes: readonly string[];
  /** Response-body and mock rules need the loopback listener even when PAC is empty. */
  readonly contentListener: boolean;
  readonly targetPolicy: {
    publicAllowed: boolean;
    localOrigins: readonly string[];
  };
}

export async function buildNativePolicy(
  projectData: unknown,
  enabledGroupIds: readonly string[],
  localOrigins: readonly string[],
  extensionId: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const schemaResult = validateProjectDetailed(projectData);
  if (!schemaResult.valid) {
    return { ok: false, reason: "invalid-project" };
  }
  const compileResult = compileProject(schemaResult.data);
  if (!compileResult.ok) {
    return { ok: false, reason: "compile-failed" };
  }
  const operations = compileResult.operations.filter(
    (op) =>
      op.kind === "request-body" ||
      op.kind === "response-body" ||
      op.kind === "mock" ||
      op.kind === "redirect" ||
      op.kind === "query" ||
      op.kind === "header",
  );
  const policy = {
    protocol: "v1",
    version: 1,
    extensionId,
    project: schemaResult.data,
    enabledGroupIds,
    localTargetOrigins: localOrigins,
    operations,
  };
  return { ok: true, value: policy };
}

function stableStartFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isNativeHostOriginForbiddenMessage(message))
    return "extension.native-host-origin-forbidden";
  if (message.includes("extension.native-host-missing"))
    return "extension.native-host-missing";
  if (message.includes("extension.request-body-needs-trust"))
    return "extension.request-body-needs-trust";
  return "extension.native-runtime-transition";
}

async function rollbackBodyMarkers(
  bodyMarkers: NativeSessionOptions["bodyMarkers"],
): Promise<void> {
  if (bodyMarkers === undefined) return;
  await removeSessionBodyMarkers(bodyMarkers.api);
}

async function syncBodyMarkersAfterStart(
  options: NativeSessionOptions,
  projectData: unknown,
  enabledGroupIds: readonly string[],
): Promise<void> {
  const bodyMarkers = options.bodyMarkers;
  if (bodyMarkers === undefined) return;

  const schemaResult = validateProjectDetailed(projectData);
  if (!schemaResult.valid) {
    await rollbackBodyMarkers(bodyMarkers);
    return;
  }
  const compileResult = compileProject(schemaResult.data);
  if (!compileResult.ok) {
    await rollbackBodyMarkers(bodyMarkers);
    return;
  }
  const enabled = new Set(enabledGroupIds);
  const operations = compileResult.operations.filter((op) =>
    enabled.has(op.groupId),
  );

  await installSessionBodyMarkers({
    api: bodyMarkers.api,
    operations,
    runtimeStripPathAvailable: bodyMarkers.runtimeStripPathAvailable,
    probeGates: bodyMarkers.probeGates ?? DEFAULT_BODY_MARKER_PROBE_GATES,
  });
}

/**
 * PAC routes for enabled request-body rules only.
 * Host-key rules steer the hostname. A URL regex that names one literal host
 * steers `scheme://host/*`. Response-body rules are not PAC routes.
 */
function pacRoutesFromBodyOperations(
  operations: readonly RogatioOperation[],
): readonly string[] {
  const routes = new Set<string>();
  for (const op of operations) {
    if (op.kind !== "request-body") continue;
    if (!isPacSafeSource(op.matcher.source)) continue;
    const host = literalHostname(op.matcher.source);
    if (host !== null) {
      routes.add(host);
      continue;
    }
    const steer = steeredRequestOrigin(op.matcher.source);
    if (steer !== null) routes.add(encodePacSteer(steer));
  }
  return [...routes].sort();
}

export async function startNativeSession(
  options: NativeSessionOptions,
): Promise<
  | { ok: true; sessionId: string; policyDigest: string }
  | { ok: false; reason: string }
> {
  console.log("[rogatio] startNativeSession: getting project");
  const project = await options.getProject();
  if (!project) {
    console.log("[rogatio] no project");
    return { ok: false, reason: "no-project" };
  }

  console.log("[rogatio] building native policy");
  const policyResult = await buildNativePolicy(
    project.data,
    project.enabledGroupIds,
    [],
    options.extensionId,
  );
  if (!policyResult.ok) {
    console.log("[rogatio] policy build failed:", policyResult.reason);
    await rollbackBodyMarkers(options.bodyMarkers);
    return { ok: false, reason: policyResult.reason };
  }

  // Send project data to host for deferred project loading.
  // send() triggers ensurePort() → connectNative(), which launches the host
  // process in idle state. The host receives runtime.project.set, validates
  // the project, builds the preset, and transitions to running.
  const send = options.nativeRuntime.send;
  console.log("[rogatio] send available:", !!send);
  let presetDigest: string | undefined;
  if (send) {
    console.log("[rogatio] sending runtime.project.set");
    try {
      const projectSetResponse = await send({
        protocol: "v1",
        type: "runtime.project.set",
        timestamp: Date.now(),
        metadata: {
          project: project.data,
          enabledGroupIds: project.enabledGroupIds,
          ...(typeof project.fileRoot === "string"
            ? { fileRoot: project.fileRoot }
            : {}),
        },
      });
      console.log(
        "[rogatio] project.set response:",
        JSON.stringify(projectSetResponse),
      );

      if (typeof projectSetResponse.metadata.presetDigest === "string") {
        presetDigest = projectSetResponse.metadata.presetDigest;
      }
      if (
        !projectSetResponse.metadata.ok &&
        projectSetResponse.metadata.error !== "runtime.already-started"
      ) {
        console.log(
          "[rogatio] project.set failed:",
          projectSetResponse.metadata.error,
        );
        await rollbackBodyMarkers(options.bodyMarkers);
        return {
          ok: false,
          reason: String(
            projectSetResponse.metadata.error ?? "project-set-failed",
          ),
        };
      }
    } catch (error) {
      console.log("[rogatio] project.set exception:", error);
      await rollbackBodyMarkers(options.bodyMarkers);
      return { ok: false, reason: stableStartFailureReason(error) };
    }
  }

  const sessionId = crypto.randomUUID();
  const policyFrames = encodePolicy(policyResult.value);

  console.log("[rogatio] sending policy frames");
  await options.nativeRuntime.sendPolicy(policyFrames);

  const policyDigest = await computeDigest(policyResult.value);

  const policyOps = (policyResult.value as { operations?: unknown }).operations;
  const operations = Array.isArray(policyOps)
    ? (policyOps as RogatioOperation[])
    : [];
  const pacRoutes = pacRoutesFromBodyOperations(operations);
  const enabledGroups = new Set(project.enabledGroupIds);
  const contentListener =
    operations.some((op) => op.kind === "response-body") ||
    operations.some(
      (op) => op.kind === "mock" && enabledGroups.has(op.groupId),
    );

  const config: NativeRuntimeConfig = {
    sessionId,
    policyDigest,
    extensionId: options.extensionId,
    pacRoutes,
    contentListener,
    targetPolicy: { publicAllowed: true, localOrigins: [] },
  };

  const startResult = await options.nativeRuntime.start(config);
  if (startResult.state !== "started") {
    await rollbackBodyMarkers(options.bodyMarkers);
    return { ok: false, reason: startResult.message ?? "start-failed" };
  }

  await syncBodyMarkersAfterStart(
    options,
    project.data,
    project.enabledGroupIds,
  );

  const proxy = startResult.proxy;
  const redirectApi = options.bodyMarkers?.api;
  if (
    contentListener &&
    redirectApi !== undefined &&
    proxy !== undefined &&
    typeof proxy.port === "number" &&
    presetDigest !== undefined
  ) {
    const responseOps = operations.filter(
      (op): op is Extract<RogatioOperation, { kind: "response-body" }> =>
        op.kind === "response-body",
    );
    const installed = await installResponseBodyRedirects({
      api: redirectApi,
      operations: responseOps,
      port: proxy.port,
      digest: presetDigest,
    });
    if (!installed.ok) {
      await removeResponseBodyRedirects(redirectApi);
      await rollbackBodyMarkers(options.bodyMarkers);
      await options.nativeRuntime.stop();
      return { ok: false, reason: installed.reason };
    }
  }

  const mockOps = operations.filter(
    (op): op is MockOperation =>
      op.kind === "mock" && enabledGroups.has(op.groupId),
  );
  if (mockOps.length > 0) {
    if (
      redirectApi === undefined ||
      proxy === undefined ||
      typeof proxy.port !== "number" ||
      presetDigest === undefined ||
      send === undefined
    ) {
      if (redirectApi !== undefined) {
        await clearMockRedirects(redirectApi);
        await removeResponseBodyRedirects(redirectApi);
      }
      await rollbackBodyMarkers(options.bodyMarkers);
      await options.nativeRuntime.stop();
      return { ok: false, reason: "mock-listener-unavailable" };
    }
    let issued: readonly { ruleId?: unknown; token?: unknown }[] = [];
    try {
      const connect = await send({
        protocol: "v1",
        type: "mock.connect",
        timestamp: Date.now(),
        metadata: {},
      });
      const mocks = connect.metadata.mocks;
      issued = Array.isArray(mocks)
        ? (mocks as readonly { ruleId?: unknown; token?: unknown }[])
        : [];
    } catch {
      await clearMockRedirects(redirectApi);
      await removeResponseBodyRedirects(redirectApi);
      await rollbackBodyMarkers(options.bodyMarkers);
      await options.nativeRuntime.stop();
      return { ok: false, reason: "mock-connect-failed" };
    }
    const tokens = new Map<string, string>();
    for (const entry of issued) {
      if (typeof entry.ruleId !== "string" || typeof entry.token !== "string") {
        tokens.clear();
        break;
      }
      if (tokens.has(entry.ruleId)) {
        tokens.clear();
        break;
      }
      tokens.set(entry.ruleId, entry.token);
    }
    const paired = mockOps.flatMap((operation) => {
      const token = tokens.get(operation.ruleId);
      return token === undefined ? [] : [{ operation, token }];
    });
    if (paired.length !== mockOps.length) {
      await clearMockRedirects(redirectApi);
      await removeResponseBodyRedirects(redirectApi);
      await rollbackBodyMarkers(options.bodyMarkers);
      await options.nativeRuntime.stop();
      return { ok: false, reason: "mock-token-mismatch" };
    }
    const mockInstalled = await installMockRedirects({
      api: redirectApi,
      rules: paired,
      port: proxy.port,
      digest: presetDigest,
    });
    if (!mockInstalled.ok) {
      await clearMockRedirects(redirectApi);
      await removeResponseBodyRedirects(redirectApi);
      await rollbackBodyMarkers(options.bodyMarkers);
      await options.nativeRuntime.stop();
      return { ok: false, reason: mockInstalled.reason };
    }
    await mergeMockRedirectIndexEntries(
      redirectApi,
      paired.map((rule) => rule.operation),
    );
  }

  return { ok: true, sessionId, policyDigest: config.policyDigest };
}

export async function stopNativeSession(
  options: NativeSessionOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (options.bodyMarkers !== undefined) {
    await clearMockRedirects(options.bodyMarkers.api);
    await removeResponseBodyRedirects(options.bodyMarkers.api);
  }
  await rollbackBodyMarkers(options.bodyMarkers);
  await options.nativeRuntime.stop();
  return { ok: true };
}

/**
 * Send an AI completion request to the native host.
 * Returns the complete response or null on error.
 */
function isAIStreamChunkResponse(
  response: NativeEnvelopeResponse,
): response is AIStreamChunkResponse {
  return (
    response.type === "ai.stream.chunk" &&
    typeof response.metadata === "object" &&
    response.metadata !== null &&
    "delta" in response.metadata &&
    "done" in response.metadata &&
    typeof (response.metadata as Record<string, unknown>).delta === "string" &&
    typeof (response.metadata as Record<string, unknown>).done === "boolean"
  );
}

function isAICompleteResponse(
  response: NativeEnvelopeResponse,
): response is AICompleteResponse {
  return (
    response.type === "ai.complete" &&
    typeof response.metadata === "object" &&
    response.metadata !== null &&
    "content" in response.metadata &&
    typeof (response.metadata as Record<string, unknown>).content === "string"
  );
}

export async function requestAIComplete(
  options: NativeSessionOptions,
  messages: readonly {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }[],
  model: string,
  temperature?: number,
  responseFormat?: { type: "json_object" },
): Promise<AICompleteResponse | null> {
  const send = options.nativeRuntime.send;
  if (!send) return null;
  try {
    const requestId = crypto.randomUUID();
    const response = await send({
      protocol: "v1",
      type: "ai.complete",
      requestId,
      timestamp: Date.now(),
      metadata: { messages, model, temperature, responseFormat },
    });
    if (!isAICompleteResponse(response)) return null;
    return response;
  } catch {
    return null;
  }
}

/**
 * Stream AI completion from the native host.
 * Yields each stream chunk as it arrives.
 */
export async function* requestAIStream(
  options: NativeSessionOptions,
  messages: readonly {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }[],
  model: string,
  temperature?: number,
): AsyncIterable<AIStreamChunkResponse> {
  const send = options.nativeRuntime.send;
  if (!send) return;
  const requestId = crypto.randomUUID();
  try {
    const response = await send({
      protocol: "v1",
      type: "ai.stream.chunk",
      requestId,
      timestamp: Date.now(),
      metadata: { messages, model, temperature },
    });
    if (!isAIStreamChunkResponse(response)) return;
    yield response;
    if (response.metadata.done) return;
    // For subsequent chunks, we need to continue reading
    // This is a simplified implementation; real streaming would need
    // the native host to support continued streaming
  } catch {
    // Silently fail
  }
}

/** Provider metadata reported by the native host via `ai.status` (spec REQ-001). */
export type AIStatusReport =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly providerUrl: string;
      readonly model: string;
    };

/**
 * Upper bound for the `ai.status` reply. An older host does not know the
 * envelope type and never answers, so the bridge would wait out its full
 * timeout; bounding the wait keeps a stale host from slowing the page down
 * (spec REQ-007).
 */
const AI_STATUS_TIMEOUT_MS = 2000;

function isAIStatusResponse(response: NativeEnvelopeResponse): boolean {
  return (
    response.type === "ai.status" &&
    typeof response.metadata === "object" &&
    response.metadata !== null &&
    typeof (response.metadata as Record<string, unknown>).configured ===
      "boolean"
  );
}

/**
 * Ask the native host for its AI provider metadata. Metadata only: this issues
 * no completion request and no provider network traffic (spec REQ-004).
 *
 * Returns null whenever the host does not report: an older host that rejects the
 * unknown envelope type, a dropped frame, a bridge timeout, or non-conforming
 * metadata (spec REQ-007). The API key is never part of this exchange.
 */
export async function requestAIStatus(
  options: NativeSessionOptions,
): Promise<AIStatusReport | null> {
  const send = options.nativeRuntime.send;
  if (!send) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sent = send({
      protocol: "v1",
      type: "ai.status",
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      metadata: {},
    }).then(
      (response: NativeEnvelope) => response,
      // The bridge rejects when the host never answers (older host).
      () => null,
    );
    const bounded = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), AI_STATUS_TIMEOUT_MS);
    });
    const response = await Promise.race([sent, bounded]);
    if (response === null || !isAIStatusResponse(response)) return null;
    const metadata = response.metadata as Record<string, unknown>;
    if (metadata.configured !== true) return { configured: false };
    const providerUrl = metadata.providerUrl;
    const model = metadata.model;
    if (
      typeof providerUrl !== "string" ||
      providerUrl.length === 0 ||
      typeof model !== "string" ||
      model.length === 0
    ) {
      // Partial metadata is non-conforming: never a half-rendered card.
      return null;
    }
    return { configured: true, providerUrl, model };
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function encodePolicy(policy: unknown): Uint8Array[] {
  const json = JSON.stringify(policy);
  const bytes = new TextEncoder().encode(json);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 64 * 1024) {
    const chunk = bytes.slice(i, i + 64 * 1024);
    frames.push(chunk);
  }
  return frames;
}

async function computeDigest(policy: unknown): Promise<string> {
  const json = JSON.stringify(policy);
  const bytes = new TextEncoder().encode(json);
  const hash = await createHash("sha256", bytes);
  return formatSha256(hash);
}
