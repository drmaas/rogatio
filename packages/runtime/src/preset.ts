import type { MatcherOperation, NormalizedMatcher } from "@rogatio/compiler";
import {
  compileUrlRegex,
  HTTP_METHODS,
  type HttpMethod,
  hasControl,
  LIMITS,
  normalizeSiteOrigin,
  RESOURCE_TYPES,
  type ResourceType,
} from "@rogatio/schema";
import { canonicalPresetBytes, digestBytes } from "./canonical.js";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { normalizeLogicalPath } from "./path.js";
import { hasOwn, snapshotOwnData } from "./snapshot.js";
import type {
  NormalizedRuntimePreset,
  RuntimeGrant,
  RuntimeLimits,
  RuntimeMockConfig,
  RuntimePresetV1,
  RuntimeResult,
} from "./types.js";
import { canonicalizeOutboundTarget, isOriginAllowed } from "./url.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function exactKeys(value: object, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === required.length &&
    required.every((key) => hasOwn(value, key))
  );
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validMethod(value: unknown): value is HttpMethod {
  return (
    typeof value === "string" && HTTP_METHODS.includes(value as HttpMethod)
  );
}

function normalizeMockHeader(
  value: unknown,
): { readonly name: string; readonly value: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  if (!exactKeys(value, ["name", "value"])) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    record.name.length === 0 ||
    record.name.length > LIMITS.maxMockHeaderNameLength ||
    hasControl(record.name) ||
    record.name.includes(":")
  )
    return null;
  if (
    typeof record.value !== "string" ||
    record.value.length > LIMITS.maxMockHeaderValueLength
  )
    return null;
  return { name: record.name, value: record.value };
}

function normalizeMockConfig(
  value: unknown,
  matcherById: ReadonlyMap<string, MatcherOperation>,
): RuntimeMockConfig | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  const allowedKeys = [
    "ruleId",
    "status",
    "headers",
    "delayMs",
    "body",
    "file",
  ];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
    return null;
  if (!validId(record.ruleId) || !matcherById.has(record.ruleId)) return null;
  if (
    typeof record.status !== "number" ||
    !Number.isSafeInteger(record.status) ||
    record.status < LIMITS.minMockStatus ||
    record.status > LIMITS.maxMockStatus
  )
    return null;

  let headers: RuntimeMockConfig["headers"];
  if (hasOwn(record, "headers")) {
    if (
      !Array.isArray(record.headers) ||
      record.headers.length > LIMITS.maxMockHeadersPerRule
    )
      return null;
    const normalizedHeaders: {
      readonly name: string;
      readonly value: string;
    }[] = [];
    for (const headerValue of record.headers) {
      const header = normalizeMockHeader(headerValue);
      if (header === null) return null;
      normalizedHeaders.push(header);
    }
    headers = Object.freeze(normalizedHeaders);
  }

  let delayMs: number | undefined;
  if (hasOwn(record, "delayMs")) {
    if (
      typeof record.delayMs !== "number" ||
      !Number.isSafeInteger(record.delayMs) ||
      record.delayMs < 0 ||
      record.delayMs > LIMITS.maxMockDelayMs
    )
      return null;
    delayMs = record.delayMs;
  }

  const body = record.body;
  const file = record.file;
  const bodySet = typeof body === "string";
  const fileSet = typeof file === "string";
  if (bodySet === fileSet) return null;
  if (bodySet && body.length > LIMITS.maxMockInlineBodyLength) return null;
  if (fileSet) {
    if (
      file.length === 0 ||
      file.length > LIMITS.maxMockFilePathLength ||
      hasControl(file)
    )
      return null;
  }

  return Object.freeze({
    ruleId: record.ruleId,
    status: record.status,
    ...(headers === undefined ? {} : { headers }),
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(bodySet ? { body } : {}),
    ...(fileSet ? { file } : {}),
  });
}

function validResourceType(value: unknown): value is ResourceType {
  return (
    typeof value === "string" && RESOURCE_TYPES.includes(value as ResourceType)
  );
}

function freezeMatcher(operation: MatcherOperation): MatcherOperation {
  const matcher = Object.freeze({
    urlRegex: Object.freeze({
      source: operation.matcher.urlRegex.source,
      flags: "" as const,
    }),
    origins: Object.freeze([...operation.matcher.origins]),
    resourceTypes: Object.freeze([...operation.matcher.resourceTypes]),
    priority: operation.matcher.priority,
    ...(operation.matcher.method === undefined
      ? {}
      : { method: operation.matcher.method }),
  }) satisfies NormalizedMatcher;
  return Object.freeze({
    kind: "matcher" as const,
    groupId: operation.groupId,
    ruleId: operation.ruleId,
    matcher,
  });
}

function normalizeMatcher(value: unknown): MatcherOperation | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const requiredKeys = ["kind", "groupId", "ruleId", "matcher"];
  if (
    !requiredKeys.every((key) => hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) =>
        key !== "kind" &&
        key !== "groupId" &&
        key !== "ruleId" &&
        key !== "matcher" &&
        key !== "action",
    )
  )
    return null;
  const record = value as Record<string, unknown>;
  if (
    record.kind !== "matcher" ||
    !validId(record.groupId) ||
    !validId(record.ruleId)
  )
    return null;
  const matcherValue = record.matcher;
  if (
    matcherValue === null ||
    typeof matcherValue !== "object" ||
    Array.isArray(matcherValue) ||
    (!exactKeys(matcherValue, [
      "urlRegex",
      "origins",
      "resourceTypes",
      "priority",
    ]) &&
      !exactKeys(matcherValue, [
        "urlRegex",
        "origins",
        "resourceTypes",
        "priority",
        "method",
      ]))
  ) {
    return null;
  }
  const matcher = matcherValue as Record<string, unknown>;
  const regexValue = matcher.urlRegex;
  if (
    regexValue === null ||
    typeof regexValue !== "object" ||
    Array.isArray(regexValue) ||
    !exactKeys(regexValue, ["source", "flags"])
  ) {
    return null;
  }
  const regex = regexValue as Record<string, unknown>;
  if (
    typeof regex.source !== "string" ||
    regex.source.length > LIMITS.maxUrlRegexLength ||
    regex.flags !== "" ||
    compileUrlRegex(regex.source) === null
  ) {
    return null;
  }
  if (
    !Array.isArray(matcher.origins) ||
    matcher.origins.length === 0 ||
    matcher.origins.length > LIMITS.maxOriginsPerScope
  )
    return null;
  const origins: string[] = [];
  for (const value of matcher.origins) {
    const normalized = normalizeSiteOrigin(value as string);
    if (normalized === null || origins.includes(normalized)) return null;
    origins.push(normalized);
  }
  if (
    !Array.isArray(matcher.resourceTypes) ||
    matcher.resourceTypes.length === 0 ||
    matcher.resourceTypes.length > LIMITS.maxResourceTypesPerRule
  )
    return null;
  const resourceTypes: ResourceType[] = [];
  for (const value of matcher.resourceTypes) {
    if (!validResourceType(value) || resourceTypes.includes(value)) return null;
    resourceTypes.push(value);
  }
  resourceTypes.sort(
    (left, right) =>
      RESOURCE_TYPES.indexOf(left) - RESOURCE_TYPES.indexOf(right),
  );
  if (
    typeof matcher.priority !== "number" ||
    !Number.isSafeInteger(matcher.priority) ||
    matcher.priority < LIMITS.minPriority ||
    matcher.priority > LIMITS.maxPriority
  )
    return null;
  let method: HttpMethod | undefined;
  if (hasOwn(matcher, "method")) {
    if (!validMethod(matcher.method)) return null;
    method = matcher.method;
  }

  return freezeMatcher({
    kind: "matcher",
    groupId: record.groupId,
    ruleId: record.ruleId,
    matcher: {
      urlRegex: { source: regex.source, flags: "" },
      origins,
      resourceTypes,
      priority: matcher.priority,
      ...(method === undefined ? {} : { method }),
    },
  });
}

function sameLimits(value: unknown): value is RuntimeLimits {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const keys = Object.keys(value);
  const expected = Object.keys(RUNTIME_LIMITS);
  if (
    keys.length !== expected.length ||
    !expected.every((key) => hasOwn(value, key))
  )
    return false;
  for (const key of expected) {
    if (
      (value as Record<string, unknown>)[key] !==
      RUNTIME_LIMITS[key as keyof RuntimeLimits]
    )
      return false;
  }
  return true;
}

function makeGrant(
  value: unknown,
  matcherById: ReadonlyMap<string, MatcherOperation>,
): RuntimeGrant | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  if (
    !exactKeys(value, [
      "groupId",
      "ruleId",
      "operationId",
      "kind",
      "target",
      "method",
    ])
  )
    return null;
  const record = value as Record<string, unknown>;
  if (
    !validId(record.groupId) ||
    !validId(record.ruleId) ||
    !validId(record.operationId) ||
    (record.kind !== "outbound-http" && record.kind !== "confined-file") ||
    !validMethod(record.method) ||
    typeof record.target !== "string"
  )
    return null;
  const matcher = matcherById.get(record.ruleId);
  if (matcher === undefined || matcher.groupId !== record.groupId) return null;
  if (
    matcher.matcher.method !== undefined &&
    matcher.matcher.method !== record.method
  )
    return null;

  let target: string | null;
  if (record.kind === "outbound-http") {
    if (record.method !== "GET" && record.method !== "HEAD") return null;
    target = canonicalizeOutboundTarget(record.target);
    if (target === null || !isOriginAllowed(target, matcher.matcher.origins))
      return null;
  } else {
    target = normalizeLogicalPath(record.target);
  }
  if (target === null) return null;
  return Object.freeze({
    groupId: record.groupId,
    ruleId: record.ruleId,
    operationId: record.operationId,
    kind: record.kind,
    target,
    method: record.method,
  });
}

export function normalizeRuntimePreset(
  value: unknown,
): RuntimeResult<NormalizedRuntimePreset> {
  const snapshot = snapshotOwnData(value);
  if (
    !snapshot.valid ||
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  ) {
    return failure("runtime.invalid-preset");
  }
  const record = snapshot.value as Record<string, unknown>;
  const allowedKeys = ["version", "limits", "matchers", "grants", "mocks"];
  const requiredKeys = ["version", "limits", "matchers", "grants"];
  const keyCount = Object.keys(record).length;
  if (
    Object.keys(record).some((key) => !allowedKeys.includes(key)) ||
    !requiredKeys.every((key) => hasOwn(record, key)) ||
    (keyCount !== 4 && keyCount !== 5)
  )
    return failure("runtime.invalid-preset");
  if (record.version !== 1 || !sameLimits(record.limits))
    return failure("runtime.invalid-preset");
  if (!Array.isArray(record.matchers) || !Array.isArray(record.grants))
    return failure("runtime.invalid-preset");

  const matchers: MatcherOperation[] = [];
  const matcherById = new Map<string, MatcherOperation>();
  for (const value of record.matchers) {
    const matcher = normalizeMatcher(value);
    if (matcher === null || matcherById.has(matcher.ruleId))
      return failure("runtime.invalid-preset");
    matcherById.set(matcher.ruleId, matcher);
    matchers.push(matcher);
  }

  const grants: RuntimeGrant[] = [];
  const operationIds = new Set<string>();
  for (const value of record.grants) {
    const grant = makeGrant(value, matcherById);
    if (grant === null || operationIds.has(grant.operationId))
      return failure("runtime.invalid-preset");
    operationIds.add(grant.operationId);
    grants.push(grant);
  }

  const mocks: RuntimeMockConfig[] = [];
  if (hasOwn(record, "mocks")) {
    if (!Array.isArray(record.mocks)) return failure("runtime.invalid-preset");
    const seenRuleIds = new Set<string>();
    for (const value of record.mocks) {
      const mock = normalizeMockConfig(value, matcherById);
      if (mock === null || seenRuleIds.has(mock.ruleId))
        return failure("runtime.invalid-preset");
      seenRuleIds.add(mock.ruleId);
      mocks.push(mock);
    }
  }

  const normalizedPreset: RuntimePresetV1 = Object.freeze({
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: Object.freeze(matchers),
    grants: Object.freeze(grants),
    ...(mocks.length > 0 ? { mocks: Object.freeze(mocks) } : {}),
  });
  const bytes = canonicalPresetBytes(normalizedPreset);
  if (bytes.byteLength > RUNTIME_LIMITS.maxPresetBytes)
    return failure("runtime.invalid-preset");
  const digest = digestBytes(bytes);
  const exposedBytes = bytes.slice();
  const normalized = Object.freeze({
    ...normalizedPreset,
    digest,
    get canonicalBytes(): Uint8Array {
      return exposedBytes.slice();
    },
  }) as NormalizedRuntimePreset;
  return { ok: true, value: normalized };
}
