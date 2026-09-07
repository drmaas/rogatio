import { compileProject } from "@rogatio/compiler";
import { formatSha256, validateProjectDetailed } from "@rogatio/schema";

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
    start(
      config: NativeRuntimeConfig,
    ): Promise<{ state: string; message?: string }>;
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
  } | null>;
  readonly getGrantedOrigins: () => Promise<readonly string[]>;
}

export interface NativeRuntimeConfig {
  readonly sessionId: string;
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacOrigins: readonly string[];
  readonly targetPolicy: {
    publicAllowed: boolean;
    localOrigins: readonly string[];
  };
}

export async function buildNativePolicy(
  projectData: unknown,
  enabledGroupIds: readonly string[],
  grantedOrigins: readonly string[],
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
      op.kind === "redirect" ||
      op.kind === "query" ||
      op.kind === "header" ||
      op.kind === "mock",
  );
  const policy = {
    protocol: "v1",
    version: 1,
    extensionId,
    project: schemaResult.data,
    enabledGroupIds,
    grantedOrigins,
    localTargetOrigins: localOrigins,
    operations,
  };
  return { ok: true, value: policy };
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

  const granted = await options.getGrantedOrigins();
  console.log("[rogatio] building native policy");
  const policyResult = await buildNativePolicy(
    project.data,
    project.enabledGroupIds,
    granted,
    [],
    options.extensionId,
  );
  if (!policyResult.ok) {
    console.log("[rogatio] policy build failed:", policyResult.reason);
    return { ok: false, reason: policyResult.reason };
  }

  // Send project data to host for deferred project loading.
  // send() triggers ensurePort() → connectNative(), which launches the host
  // process in idle state. The host receives runtime.project.set, validates
  // the project, builds the preset, and transitions to running.
  const send = options.nativeRuntime.send;
  console.log("[rogatio] send available:", !!send);
  if (send) {
    console.log("[rogatio] sending runtime.project.set");
    try {
      const projectSetResponse = await send({
        protocol: "v1",
        type: "runtime.project.set",
        timestamp: Date.now(),
        metadata: { project: project.data },
      });
      console.log(
        "[rogatio] project.set response:",
        JSON.stringify(projectSetResponse),
      );

      if (
        !projectSetResponse.metadata.ok &&
        projectSetResponse.metadata.error !== "runtime.already-started"
      ) {
        console.log(
          "[rogatio] project.set failed:",
          projectSetResponse.metadata.error,
        );
        return {
          ok: false,
          reason: String(
            projectSetResponse.metadata.error ?? "project-set-failed",
          ),
        };
      }
    } catch (error) {
      console.log("[rogatio] project.set exception:", error);
      return { ok: false, reason: String(error) };
    }
  }

  const sessionId = crypto.randomUUID();
  const policyFrames = encodePolicy(policyResult.value);

  console.log("[rogatio] sending policy frames");
  await options.nativeRuntime.sendPolicy(policyFrames);

  const policyDigest = await computeDigest(policyResult.value);

  const config: NativeRuntimeConfig = {
    sessionId,
    policyDigest,
    extensionId: options.extensionId,
    pacOrigins: [],
    targetPolicy: { publicAllowed: true, localOrigins: [] },
  };

  const startResult = await options.nativeRuntime.start(config);
  if (startResult.state !== "started") {
    return { ok: false, reason: startResult.message ?? "start-failed" };
  }

  return { ok: true, sessionId, policyDigest: config.policyDigest };
}

export async function stopNativeSession(
  options: NativeSessionOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await options.nativeRuntime.stop();
  return { ok: true };
}

/**
 * Establish mock delivery with the consolidated native host (spec REQ-003).
 * Sends a `mock.connect` envelope and returns the per-rule tokens, or null when
 * the host does not support the envelope protocol or the request fails.
 */
export interface NativeMockConnection {
  readonly port: number | null;
  readonly mocks: readonly {
    readonly ruleId: string;
    readonly token: string;
  }[];
}

/**
 * Establish mock delivery with the consolidated native host (spec REQ-003).
 * Sends a `mock.connect` envelope and returns the loopback faucet port plus the
 * per-rule tokens, or null when the host does not support the envelope protocol
 * or the request fails.
 */
export async function connectNativeMock(
  options: NativeSessionOptions,
  presetDigest: string,
): Promise<NativeMockConnection | null> {
  const send = options.nativeRuntime.send;
  if (!send) return null;
  try {
    const response = await send({
      protocol: "v1",
      type: "mock.connect",
      timestamp: Date.now(),
      metadata: { presetDigest },
    });
    const metadata = response.metadata as {
      port?: number;
      mocks?: readonly { ruleId: string; token: string }[];
      error?: string;
    };
    if (metadata.error || !metadata.mocks) return null;
    return { port: metadata.port ?? null, mocks: metadata.mocks };
  } catch {
    return null;
  }
}

/**
 * Fetch a single mock response from the consolidated native host (spec REQ-003).
 * Resolves with the rendered response, or null when unavailable.
 */
export async function requestNativeMock(
  options: NativeSessionOptions,
  token: string,
  method?: string,
): Promise<{
  status: number;
  headers: readonly (readonly [string, string])[];
  bodyBytes: Uint8Array;
} | null> {
  const send = options.nativeRuntime.send;
  if (!send) return null;
  try {
    const response = await send({
      protocol: "v1",
      type: "mock.request",
      timestamp: Date.now(),
      metadata: { token, ...(method !== undefined ? { method } : {}) },
    });
    const metadata = response.metadata as {
      status: number;
      headers?: readonly (readonly [string, string])[];
      mockBody?: string;
      error?: string;
    };
    if (metadata.error || typeof metadata.mockBody !== "string") return null;
    const bodyBytes = base64ToBytes(metadata.mockBody);
    return {
      status: metadata.status,
      headers: metadata.headers ?? [],
      bodyBytes,
    };
  } catch {
    return null;
  }
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

/**
 * Check if the native host supports AI (has send method and AI configured).
 */
export async function checkAISupport(
  options: NativeSessionOptions,
): Promise<boolean> {
  const send = options.nativeRuntime.send;
  if (!send) return false;
  try {
    const response = await send({
      protocol: "v1",
      type: "ai.complete",
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      metadata: {
        messages: [{ role: "user", content: "ping" }],
        model: "test",
      },
    });
    return (
      response.type !== "ai.error" ||
      (response.metadata as AIErrorResponse["metadata"]).code !==
        "ai.not-configured"
    );
  } catch {
    return false;
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

/** Browser-safe base64 decode (service workers have no `Buffer`). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
