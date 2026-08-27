import { createHash } from "node:crypto";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

export interface RequestBodyPolicyOperation {
  readonly kind: "request-body";
  readonly groupId: string;
  readonly ruleId: string;
  readonly sourceOrder: number;
  readonly matcher: {
    readonly urlRegex: { readonly source: string; readonly flags: string };
    readonly origins: readonly string[];
    readonly resourceTypes: readonly string[];
    readonly priority: number;
    readonly method: string;
  };
  readonly requestBody: {
    readonly mode: "replace" | "regex";
    readonly body?: string;
    readonly pattern?: string;
    readonly replacement?: string;
  };
}

export interface RequestBodyPolicyV1 {
  readonly protocol: "f17-v1";
  readonly version: 1;
  readonly extensionId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
  readonly localTargetOrigins: readonly string[];
  readonly operations: readonly RequestBodyPolicyOperation[];
  readonly limits: {
    readonly maxRequestBodyBytes: number;
    readonly maxRequestBodyPatternLength: number;
    readonly maxRequestBodyReplacementLength: number;
    readonly maxRequestBodyOperations: number;
    readonly maxRequestBodyTransforms: number;
    readonly maxRegexDeadlineMs: number;
    readonly maxLocalOrigins: number;
    readonly maxCanonicalPolicyBytes: number;
    readonly maxNativeFrameBytes: number;
  };
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) return true;
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      if (i === 0) return true;
      const prev = value.charCodeAt(i - 1);
      if (prev < 0xd800 || prev > 0xdbff) return true;
    }
  }
  return false;
}

function validateOperation(
  op: RequestBodyPolicyOperation,
  seenIds: Set<string>,
): RuntimeResult<void> {
  if (!seenIds.add(`${op.groupId}:${op.ruleId}`)) {
    return failure("runtime.request-body-duplicate-rule-id");
  }
  if (op.sourceOrder < 0) {
    return failure("runtime.request-body-invalid-source-order");
  }
  if (op.matcher.priority < 1 || op.matcher.priority > 1000) {
    return failure("runtime.request-body-invalid-priority");
  }
  if (!op.matcher.origins.length) {
    return failure("runtime.request-body-empty-origins");
  }
  if (!op.matcher.resourceTypes.includes("xmlhttprequest")) {
    return failure("runtime.request-body-invalid-resource-type");
  }
  if (op.requestBody.mode === "replace") {
    if (typeof op.requestBody.body !== "string") {
      return failure("runtime.request-body-replace-missing-body");
    }
    if (op.requestBody.body.length > RUNTIME_LIMITS.maxRequestBodyBytes) {
      return failure("runtime.request-body-replace-too-large");
    }
    if (hasLoneSurrogate(op.requestBody.body)) {
      return failure("runtime.request-body-lone-surrogate");
    }
  } else if (op.requestBody.mode === "regex") {
    if (!op.requestBody.pattern || typeof op.requestBody.pattern !== "string") {
      return failure("runtime.request-body-regex-missing-pattern");
    }
    if (
      op.requestBody.pattern.length > RUNTIME_LIMITS.maxRequestBodyPatternLength
    ) {
      return failure("runtime.request-body-regex-pattern-too-large");
    }
    if (hasLoneSurrogate(op.requestBody.pattern)) {
      return failure("runtime.request-body-lone-surrogate");
    }
    try {
      new RegExp(op.requestBody.pattern, "gu");
    } catch {
      return failure("runtime.request-body-regex-invalid");
    }
    if (typeof op.requestBody.replacement !== "string") {
      return failure("runtime.request-body-regex-missing-replacement");
    }
    if (
      op.requestBody.replacement.length >
      RUNTIME_LIMITS.maxRequestBodyReplacementLength
    ) {
      return failure("runtime.request-body-regex-replacement-too-large");
    }
    if (hasLoneSurrogate(op.requestBody.replacement)) {
      return failure("runtime.request-body-lone-surrogate");
    }
  } else {
    return failure("runtime.request-body-invalid-mode");
  }
  return { ok: true, value: undefined };
}

export function validateRequestBodyPolicy(
  policy: unknown,
): RuntimeResult<RequestBodyPolicyV1> {
  if (!policy || typeof policy !== "object") {
    return failure("runtime.request-body-policy-invalid");
  }
  const p = policy as Record<string, unknown>;

  if (p.protocol !== "f17-v1") {
    return failure("runtime.request-body-policy-invalid");
  }
  if (p.version !== 1) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (typeof p.extensionId !== "string" || !/^[a-p]{32}$/.test(p.extensionId)) {
    return failure("runtime.request-body-extension-id-invalid");
  }
  if (typeof p.projectId !== "string") {
    return failure("runtime.request-body-policy-invalid");
  }
  if (typeof p.projectRevision !== "number" || p.projectRevision < 1) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (
    !Array.isArray(p.enabledGroupIds) ||
    !p.enabledGroupIds.every((x) => typeof x === "string")
  ) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (
    !Array.isArray(p.grantedOrigins) ||
    !p.grantedOrigins.every((x) => typeof x === "string")
  ) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (
    !Array.isArray(p.localTargetOrigins) ||
    !p.localTargetOrigins.every((x) => typeof x === "string")
  ) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (!Array.isArray(p.operations)) {
    return failure("runtime.request-body-policy-invalid");
  }
  if (p.operations.length > RUNTIME_LIMITS.maxRequestBodyOperations) {
    return failure("runtime.request-body-too-many-operations");
  }

  const limits = p.limits as Record<string, unknown> | undefined;
  if (
    !limits ||
    limits.maxRequestBodyBytes !== RUNTIME_LIMITS.maxRequestBodyBytes ||
    limits.maxRequestBodyPatternLength !==
      RUNTIME_LIMITS.maxRequestBodyPatternLength ||
    limits.maxRequestBodyReplacementLength !==
      RUNTIME_LIMITS.maxRequestBodyReplacementLength ||
    limits.maxRequestBodyOperations !==
      RUNTIME_LIMITS.maxRequestBodyOperations ||
    limits.maxRequestBodyTransforms !==
      RUNTIME_LIMITS.maxRequestBodyTransforms ||
    limits.maxRegexDeadlineMs !== RUNTIME_LIMITS.maxRegexDeadlineMs ||
    limits.maxLocalOrigins !== RUNTIME_LIMITS.maxLocalOrigins ||
    limits.maxCanonicalPolicyBytes !== RUNTIME_LIMITS.maxPresetBytes ||
    limits.maxNativeFrameBytes !== RUNTIME_LIMITS.maxControlBodyBytes
  ) {
    return failure("runtime.request-body-limits-mismatch");
  }

  const seenIds = new Set<string>();
  for (const op of p.operations) {
    const result = validateOperation(op as RequestBodyPolicyOperation, seenIds);
    if (!result.ok) return result;
  }

  return { ok: true, value: p as unknown as RequestBodyPolicyV1 };
}

export function canonicalizePolicy(policy: RequestBodyPolicyV1): string {
  const sortedOps = [...policy.operations].sort(
    (a, b) => a.sourceOrder - b.sourceOrder,
  );
  const canonical = {
    protocol: policy.protocol,
    version: policy.version,
    extensionId: policy.extensionId,
    projectId: policy.projectId,
    projectRevision: policy.projectRevision,
    enabledGroupIds: [...policy.enabledGroupIds].sort(),
    grantedOrigins: [...policy.grantedOrigins].sort(),
    localTargetOrigins: [...policy.localTargetOrigins].sort(),
    operations: sortedOps.map((op) => ({
      kind: op.kind,
      groupId: op.groupId,
      ruleId: op.ruleId,
      sourceOrder: op.sourceOrder,
      matcher: {
        urlRegex: op.matcher.urlRegex,
        origins: [...op.matcher.origins].sort(),
        resourceTypes: [...op.matcher.resourceTypes].sort(),
        priority: op.matcher.priority,
        method: op.matcher.method,
      },
      requestBody: op.requestBody,
    })),
    limits: policy.limits,
  };
  return JSON.stringify(canonical);
}

export async function computePolicyDigest(
  policy: RequestBodyPolicyV1,
): Promise<string> {
  const canonical = canonicalizePolicy(policy);
  const bytes = new TextEncoder().encode(canonical);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `sha256:${hash}`;
}
