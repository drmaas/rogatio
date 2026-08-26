import { compileProject } from "@rogatio/compiler";
import { validateProjectDetailed } from "@rogatio/schema";
import { declaredPermissionOrigins } from "./permissions.js";

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
    protocol: "f17-v1",
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
  const _declared = declaredPermissionOrigins({ operations: [] });

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
  const _result = await options.nativeRuntime.stop();
  return { ok: true };
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
  return `sha256:${hash}`;
}
