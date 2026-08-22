export type HeaderDirection = "request" | "response";

export const FORBIDDEN_REQUEST_HEADERS = Object.freeze([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

export const FORBIDDEN_RESPONSE_HEADERS = Object.freeze([
  "connection",
  "content-encoding",
  "content-length",
  "date",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

const FORBIDDEN_REQUEST_PREFIXES = Object.freeze(["proxy-", "sec-"]);

export function isForbiddenHeader(
  name: string,
  direction: HeaderDirection,
): boolean {
  const normalized = name.toLowerCase();
  const forbidden =
    direction === "request"
      ? FORBIDDEN_REQUEST_HEADERS
      : FORBIDDEN_RESPONSE_HEADERS;

  return (
    forbidden.includes(normalized as never) ||
    (direction === "request" &&
      FORBIDDEN_REQUEST_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      ))
  );
}
