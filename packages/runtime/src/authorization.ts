import { HTTP_METHODS, type HttpMethod } from "@rogatio/schema";
import { failure } from "./errors.js";
import { normalizeLogicalPath } from "./path.js";
import { hasOwn, snapshotOwnData } from "./snapshot.js";
import type {
  AuthorizedOperation,
  NormalizedRuntimePreset,
  RuntimeGrant,
  RuntimeOperationKind,
  RuntimeResult,
} from "./types.js";
import { canonicalizeOutboundTarget, isOriginAllowed } from "./url.js";

function validMethod(value: unknown): value is HttpMethod {
  return (
    typeof value === "string" && HTTP_METHODS.includes(value as HttpMethod)
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
  );
}

function exactDescriptor(value: unknown): RuntimeGrant | null {
  const snapshot = snapshotOwnData(value);
  if (
    !snapshot.valid ||
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  )
    return null;
  const record = snapshot.value as Record<string, unknown>;
  const keys = ["groupId", "ruleId", "operationId", "kind", "target", "method"];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => hasOwn(record, key))
  )
    return null;
  if (
    !validId(record.groupId) ||
    !validId(record.ruleId) ||
    !validId(record.operationId) ||
    (record.kind !== "outbound-http" && record.kind !== "confined-file") ||
    typeof record.target !== "string" ||
    !validMethod(record.method)
  )
    return null;
  return {
    groupId: record.groupId,
    ruleId: record.ruleId,
    operationId: record.operationId,
    kind: record.kind,
    target: record.target,
    method: record.method,
  };
}

function canonicalTarget(
  kind: RuntimeOperationKind,
  target: string,
): string | null {
  return kind === "outbound-http"
    ? canonicalizeOutboundTarget(target)
    : normalizeLogicalPath(target);
}

function matchesGrant(descriptor: RuntimeGrant, grant: RuntimeGrant): boolean {
  return (
    descriptor.groupId === grant.groupId &&
    descriptor.ruleId === grant.ruleId &&
    descriptor.operationId === grant.operationId &&
    descriptor.kind === grant.kind &&
    descriptor.target === grant.target &&
    descriptor.method === grant.method
  );
}

export function authorizeExact(
  preset: NormalizedRuntimePreset,
  value: unknown,
): RuntimeResult<AuthorizedOperation> {
  const descriptor = exactDescriptor(value);
  if (descriptor === null) return failure("runtime.authorization-denied");
  const target = canonicalTarget(descriptor.kind, descriptor.target);
  if (target === null) return failure("runtime.authorization-denied");

  for (const grant of preset.grants) {
    if (!matchesGrant({ ...descriptor, target }, grant)) continue;
    const matcher = preset.matchers.find(
      (candidate) =>
        candidate.groupId === grant.groupId &&
        candidate.ruleId === grant.ruleId,
    );
    if (
      matcher === undefined ||
      (grant.kind === "outbound-http" &&
        !isOriginAllowed(grant.target, matcher.matcher.origins))
    ) {
      return failure("runtime.authorization-denied");
    }
    return {
      ok: true,
      value: Object.freeze({
        groupId: grant.groupId,
        ruleId: grant.ruleId,
        operationId: grant.operationId,
        kind: grant.kind,
        target: grant.target,
        method: grant.method,
        presetDigest: preset.digest,
      }),
    };
  }
  return failure("runtime.authorization-denied");
}

export function normalizeAuthorizationDescriptor(
  value: unknown,
): RuntimeResult<RuntimeGrant> {
  const descriptor = exactDescriptor(value);
  if (descriptor === null) return failure("runtime.request-malformed");
  const target = canonicalTarget(descriptor.kind, descriptor.target);
  if (target === null) return failure("runtime.request-malformed");
  return { ok: true, value: { ...descriptor, target } };
}
