import type { SourceCondition } from "@rogatio/schema";
import { compileUrlRegex } from "@rogatio/schema";

/**
 * Match a request URL against a rule source condition.
 * `key: "url"` — flagless regex on the full URL string.
 * `key: "host"` — flagless regex on `URL.hostname` only (no scheme, no port).
 */
export function sourceMatches(source: SourceCondition, url: string): boolean {
  const regex = compileUrlRegex(source.value);
  if (regex === null) return false;
  if (source.key === "url") {
    return regex.test(url);
  }
  try {
    const hostname = new URL(url).hostname;
    return regex.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Return a single literal hostname when `source` is an exact host regex, else null.
 * Proven only for `key: "host"`, `operator: "regex"`, value `^` + hostname + `$`
 * with dots escaped as `\.` and no other metacharacters.
 */
export function literalHostname(source: SourceCondition): string | null {
  if (source.key !== "host" || source.operator !== "regex") return null;
  const match = /^\^((?:[A-Za-z0-9-]+|\\\.)+)\$$/.exec(source.value);
  if (match === null) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  if (!/^(?:[A-Za-z0-9-]+|\\\.)+$/.test(raw)) return null;
  const host = raw.replace(/\\./g, ".");
  if (!/^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$|^[0-9.]+$/.test(host)) {
    return null;
  }
  return host;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
