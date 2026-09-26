import { literalHostname, type NormalizedMatcher } from "@rogatio/compiler";

export interface ProjectedSourceCondition {
  readonly regexFilter: string;
  readonly requestDomains?: readonly string[];
}

export type SourceProjectionResult =
  | { readonly projectable: true; readonly condition: ProjectedSourceCondition }
  | { readonly projectable: false };

function escapeRegexHost(hostname: string): string {
  return hostname.replace(/\./g, "\\.");
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function hostPinnedRegexFilter(hostname: string): string {
  return `^https?://${escapeRegexHost(hostname)}(?::[0-9]+)?(?:[/?#]|$)`;
}

/** Shared DNR and session body-marker condition projection (REQ-020). */
export function projectSourceCondition(
  matcher: NormalizedMatcher,
): SourceProjectionResult {
  const { source } = matcher;
  if (source.key === "url") {
    return {
      projectable: true,
      condition: { regexFilter: source.value },
    };
  }
  const host = literalHostname(source);
  if (host === null) {
    return { projectable: false };
  }
  const regexFilter = hostPinnedRegexFilter(host);
  if (isIpLiteral(host)) {
    return { projectable: true, condition: { regexFilter } };
  }
  return {
    projectable: true,
    condition: { regexFilter, requestDomains: [host] },
  };
}

export function isPacRoutableBodySource(matcher: NormalizedMatcher): boolean {
  return literalHostname(matcher.source) !== null;
}
