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
