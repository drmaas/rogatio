import { hasControl } from "@rogatio/schema";

/** Keep in sync with the extension redirect prefix. */
export const MOCK_LISTENER_PREFIX = "/.rogatio/mock/";

export interface MockListenerTarget {
  readonly token: string;
  readonly digest: string;
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
 * Parse an origin-form mock URL.
 * Shape: `/.rogatio/mock/<token>/<digest>`. A query is ignored. Extra path
 * segments, dot segments, and controls are rejected.
 */
export function parseMockRedirect(rawUrl: string): MockListenerTarget | null {
  const queryAt = rawUrl.indexOf("?");
  const path = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
  if (!path.startsWith(MOCK_LISTENER_PREFIX)) return null;
  const rest = path.slice(MOCK_LISTENER_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  if (rest.indexOf("/", slash + 1) !== -1) return null;
  let token: string;
  let digest: string;
  try {
    token = decodeURIComponent(rest.slice(0, slash));
    digest = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (!isSingleSegment(token) || !isSingleSegment(digest)) return null;
  return { token, digest };
}
