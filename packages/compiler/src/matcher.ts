import {
  compileUrlRegex,
  HTTP_METHODS,
  LIMITS,
  RESOURCE_TYPES,
} from "@rogatio/schema";
import type { NormalizedMatcher } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the structural shape of a normalized matcher. The schema layer
 * guarantees this for compiled operations; the extension re-checks untrusted
 * messages and the runtime re-validates authority, so the rule lives here as
 * the single source of truth.
 */
export function validateMatcherShape(
  value: unknown,
): value is NormalizedMatcher {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  const source = value.source;
  if (
    (source.key !== "url" && source.key !== "host") ||
    source.operator !== "regex" ||
    typeof source.value !== "string" ||
    compileUrlRegex(source.value) === null ||
    !Array.isArray(value.resourceTypes) ||
    !value.resourceTypes.every((type) =>
      RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]),
    ) ||
    typeof value.priority !== "number" ||
    !Number.isSafeInteger(value.priority) ||
    value.priority < LIMITS.minPriority ||
    value.priority > LIMITS.maxPriority
  )
    return false;
  if (
    value.method !== undefined &&
    !HTTP_METHODS.includes(value.method as (typeof HTTP_METHODS)[number])
  )
    return false;
  return true;
}
