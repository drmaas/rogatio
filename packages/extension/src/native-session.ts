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
  const project = await options.getProject();
  if (!project) return { ok: false, reason: "no-project" };

  const granted = await options.getGrantedOrigins();

  const policyResult = await buildNativePolicy(
    project.data,
    project.enabledGroupIds,
    granted,
    [],
    options.extensionId,
  );
  if (!policyResult.ok) return { ok: false, reason: policyResult.reason };

  const sessionId = crypto.randomUUID();
  const policyFrames = encodePolicy(policyResult.value);

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
