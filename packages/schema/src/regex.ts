import { LIMITS } from "./limits.js";

export function compileUrlRegex(value: string): RegExp | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > LIMITS.maxUrlRegexLength
  )
    return null;

  try {
    return new RegExp(value);
  } catch {
    return null;
  }
}

export function isValidUrlRegex(value: unknown): value is string {
  return typeof value === "string" && compileUrlRegex(value) !== null;
}

// Body rewrites run as `new RegExp(pattern, "gu")`. Validity is the unicode
// flag alone; length stays with the request/response body pattern limits.
export function compileReplacementRegex(value: string): RegExp | null {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    return new RegExp(value, "u");
  } catch {
    return null;
  }
}

export function isValidReplacementRegex(value: unknown): value is string {
  return typeof value === "string" && compileReplacementRegex(value) !== null;
}
