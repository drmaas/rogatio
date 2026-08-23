import type { MatcherOperation, NormalizedMatcher } from "@rogatio/compiler";
import {
  compileUrlRegex,
  HTTP_METHODS,
  LIMITS,
  normalizeSiteOrigin,
  RESOURCE_TYPES,
} from "./browser-schema.js";
import { extensionDiagnostic } from "./diagnostics.js";

export interface MatcherProjection {
  readonly id: number;
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly installable: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMatcherOperation(value: unknown): value is MatcherOperation {
  if (!isRecord(value) || value.kind !== "matcher") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  const matcher = value.matcher;
  if (!isRecord(matcher) || !isRecord(matcher.urlRegex)) return false;
  if (
    typeof matcher.urlRegex.source !== "string" ||
    matcher.urlRegex.flags !== "" ||
    compileUrlRegex(matcher.urlRegex.source) === null ||
    !Array.isArray(matcher.origins) ||
    !matcher.origins.every(
      (origin) =>
        typeof origin === "string" && normalizeSiteOrigin(origin) !== null,
    ) ||
    !Array.isArray(matcher.resourceTypes) ||
    !matcher.resourceTypes.every((type) =>
      RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]),
    ) ||
    typeof matcher.priority !== "number" ||
    !Number.isSafeInteger(matcher.priority) ||
    matcher.priority < LIMITS.minPriority ||
    matcher.priority > LIMITS.maxPriority
  )
    return false;
  if (
    matcher.method !== undefined &&
    !HTTP_METHODS.includes(matcher.method as (typeof HTTP_METHODS)[number])
  )
    return false;
  return true;
}

export function projectMatchers(
  operations: readonly MatcherOperation[],
): readonly MatcherProjection[] {
  const result: MatcherProjection[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation: unknown = operations[index];
    if (!isMatcherOperation(operation)) {
      throw new Error(extensionDiagnostic("extension.invalid-operation").code);
    }
    result.push({
      id: 1_000_001 + index,
      groupId: operation.groupId,
      ruleId: operation.ruleId,
      matcher: {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      },
      installable: false,
    });
  }
  return result;
}
