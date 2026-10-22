import { hasControl } from "@rogatio/schema";

/** Keep in sync with the extension redirect prefix. */
const RESPONSE_BODY_LISTENER_PREFIX = "/.rogatio/body/";

export interface ResponseBodyRedirectTarget {
  readonly token: string;
  readonly ruleId: string;
  readonly digest: string;
  readonly originalUrl: string;
}

function isSingleSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 2048 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !hasControl(value)
  );
}

/**
 * Parse an origin-form listener URL.
 * Shape: `/.rogatio/body/<token>/<ruleId>/<digest>/<originalUrl>` plus the
 * original query. The token is one unguessable path segment.
 */
export function parseResponseBodyRedirect(
  rawUrl: string,
): ResponseBodyRedirectTarget | null {
  const queryAt = rawUrl.indexOf("?");
  const path = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
  const search = queryAt === -1 ? "" : rawUrl.slice(queryAt);
  if (!path.startsWith(RESPONSE_BODY_LISTENER_PREFIX)) return null;
  const rest = path.slice(RESPONSE_BODY_LISTENER_PREFIX.length);
  const slash1 = rest.indexOf("/");
  if (slash1 <= 0) return null;
  const slash2 = rest.indexOf("/", slash1 + 1);
  if (slash2 <= slash1 + 1) return null;
  const slash3 = rest.indexOf("/", slash2 + 1);
  if (slash3 <= slash2 + 1) return null;
  let token: string;
  let ruleId: string;
  let digest: string;
  try {
    token = decodeURIComponent(rest.slice(0, slash1));
    ruleId = decodeURIComponent(rest.slice(slash1 + 1, slash2));
    digest = decodeURIComponent(rest.slice(slash2 + 1, slash3));
  } catch {
    return null;
  }
  if (
    !isSingleSegment(token) ||
    !isSingleSegment(ruleId) ||
    !isSingleSegment(digest)
  ) {
    return null;
  }
  const original = rest.slice(slash3 + 1) + search;
  if (!/^https?:\/\//i.test(original)) return null;
  return { token, ruleId, digest, originalUrl: original };
}
