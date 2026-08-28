import {
  compileUrlRegex,
  HTTP_METHODS,
  LIMITS,
  normalizeSiteOrigin,
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
  if (!isRecord(value) || !isRecord(value.urlRegex)) return false;
  if (
    typeof value.urlRegex.source !== "string" ||
    value.urlRegex.flags !== "" ||
    compileUrlRegex(value.urlRegex.source) === null ||
    !Array.isArray(value.origins) ||
    !value.origins.every(
      (origin) =>
        typeof origin === "string" && normalizeSiteOrigin(origin) !== null,
    ) ||
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
