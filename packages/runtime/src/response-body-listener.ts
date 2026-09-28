/** Keep in sync with the extension redirect prefix. */
export const RESPONSE_BODY_LISTENER_PREFIX = "/.rogatio/body/";

export interface ResponseBodyRedirectTarget {
  readonly ruleId: string;
  readonly digest: string;
  readonly originalUrl: string;
}

/**
 * Parse an origin-form listener URL.
 * Shape: `/.rogatio/body/<ruleId>/<digest>/<originalUrl>` plus the original query.
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
  let ruleId: string;
  let digest: string;
  try {
    ruleId = decodeURIComponent(rest.slice(0, slash1));
    digest = decodeURIComponent(rest.slice(slash1 + 1, slash2));
  } catch {
    return null;
  }
  if (ruleId.length === 0 || digest.length === 0) return null;
  const original = rest.slice(slash2 + 1) + search;
  if (!/^https?:\/\//i.test(original)) return null;
  return { ruleId, digest, originalUrl: original };
}
