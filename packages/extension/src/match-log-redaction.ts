import { isForbiddenHeader } from "./browser-schema.js";

export const LOG_STRING_MAX = 200;

const QUERY_KEY_DENY_SUBSTRINGS = Object.freeze([
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "api_key",
  "apikey",
  "key",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "auth",
  "session",
  "sid",
  "sig",
  "signature",
  "jwt",
  "assertion",
  "otp",
  "state",
  "nonce",
  "email",
] as const);

const EXTRA_SENSITIVE_HEADER_NAMES = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
] as const);

export function truncateLogString(value: string): string {
  if (value.length <= LOG_STRING_MAX) return value;
  let cut = value.slice(0, LOG_STRING_MAX - 3);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  // Never emit half of a surrogate pair.
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}...`;
}

export function isDenyListedQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return QUERY_KEY_DENY_SUBSTRINGS.some((fragment) => lower.includes(fragment));
}

export function isDenyListedHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  const extras: readonly string[] = EXTRA_SENSITIVE_HEADER_NAMES;
  if (extras.includes(normalized)) return true;
  return (
    isForbiddenHeader(normalized, "request") ||
    isForbiddenHeader(normalized, "response")
  );
}

function stripUrlUserinfoAndFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

export function redactUrlQueryValues(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;

  const base = url.slice(0, queryStart + 1);
  const rest = url.slice(queryStart + 1);
  const hashStart = rest.indexOf("#");
  const fragment = hashStart === -1 ? "" : rest.slice(hashStart);
  const query = hashStart === -1 ? rest : rest.slice(0, hashStart);
  if (query.length === 0) return url;

  const redacted = query
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const rawKey = equals === -1 ? pair : pair.slice(0, equals);
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        decodedKey = rawKey;
      }
      if (equals !== -1 && isDenyListedQueryKey(decodedKey)) {
        return `${rawKey}=[redacted]`;
      }
      return pair;
    })
    .join("&");

  return `${base}${redacted}${fragment}`;
}

export interface RedactUrlOptions {
  readonly redactSensitive: boolean;
}

export function redactUrl(url: string, options: RedactUrlOptions): string {
  let value = stripUrlUserinfoAndFragment(url);
  if (options.redactSensitive) value = redactUrlQueryValues(value);
  return truncateLogString(value);
}

export function sanitizeQueryTransformValue(
  paramName: string,
  value: string,
  redactSensitive: boolean,
): string {
  if (redactSensitive && isDenyListedQueryKey(paramName)) return "[redacted]";
  return truncateLogString(value);
}

export function sanitizeHeaderLogValue(
  headerName: string,
  value: string,
  redactSensitive: boolean,
): string {
  if (redactSensitive && isDenyListedHeaderName(headerName))
    return "[redacted]";
  return truncateLogString(value);
}

export function sanitizeDestinationForLog(
  destination: string,
  redactSensitive: boolean,
): string {
  return redactUrl(destination, { redactSensitive });
}

export function sanitizeInitiatorForLog(
  initiator: string,
  redactSensitive: boolean,
): string {
  return redactUrl(initiator, { redactSensitive });
}
