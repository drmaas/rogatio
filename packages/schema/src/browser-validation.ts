import { LIMITS } from "./limits.js";

export function countCapturingGroups(urlRegex: string): number {
  let count = 0;
  let index = 0;
  const length = urlRegex.length;
  while (index < length) {
    const char = urlRegex[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      if (urlRegex[index + 1] === "?") {
        index = skipBalancedGroup(urlRegex, index);
        continue;
      }
      count += 1;
    }
    index += 1;
  }
  return count;
}

function skipBalancedGroup(source: string, start: number): number {
  let depth = 0;
  let index = start;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return length;
}

export interface RedirectDestinationIssue {
  readonly code: string;
  readonly message: string;
}

export function validateRedirectDestination(
  destination: string,
  urlRegex: string,
): readonly RedirectDestinationIssue[] {
  const issues: RedirectDestinationIssue[] = [];
  if (typeof destination !== "string" || destination.length === 0) {
    issues.push({
      code: "schema.required",
      message: "Redirect destination must be a non-empty string.",
    });
    return issues;
  }
  if (destination.length > LIMITS.maxRedirectDestinationLength) {
    issues.push({
      code: "schema.out-of-range",
      message: `Redirect destination must be at most ${LIMITS.maxRedirectDestinationLength} characters.`,
    });
    return issues;
  }
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    issues.push({
      code: "schema.invalid-format",
      message: "Redirect destination must be an absolute URL.",
    });
    return issues;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    issues.push({
      code: "schema.invalid-value",
      message: "Redirect destination must use the http or https scheme.",
    });
    return issues;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    issues.push({
      code: "schema.invalid-value",
      message: "Redirect destination must not contain credentials.",
    });
    return issues;
  }
  if (url.hostname.length === 0 || url.hostname.includes("*")) {
    issues.push({
      code: "schema.invalid-format",
      message: "Redirect destination must have a valid host.",
    });
    return issues;
  }

  const groups = countCapturingGroups(urlRegex);
  const backreference = /\\([1-9])/g;
  let match = backreference.exec(destination);
  while (match !== null) {
    const referenced = Number(match[1]);
    if (referenced > groups) {
      issues.push({
        code: "schema.invalid-value",
        message: `Redirect destination references capture group ${referenced} but the URL pattern defines ${groups}.`,
      });
    }
    match = backreference.exec(destination);
  }
  return issues;
}
