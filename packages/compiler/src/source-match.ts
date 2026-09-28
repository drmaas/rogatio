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

/**
 * Return one exact http(s) URL when `source` is an anchored literal URL regex.
 * Capture groups of literals are kept (they do not change the matched text).
 * Wildcards, alternation, and host extraction return null.
 */
export function literalUrl(source: SourceCondition): string | null {
  if (source.key !== "url" || source.operator !== "regex") return null;
  const pattern = source.value;
  if (!pattern.startsWith("^") || !pattern.endsWith("$")) return null;
  const decoded = decodeLiteralRegexBody(pattern.slice(1, -1));
  if (decoded === null) return null;
  return exactHttpUrl(decoded);
}

function exactHttpUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.href !== value) return null;
  return value;
}

const LITERAL_ESCAPES = "\\.^$*+?()[]{}|/";

function decodeLiteralRegexBody(body: string): string | null {
  let out = "";
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === undefined) return null;
    if (char === "\\") {
      const next = body[index + 1];
      if (next === undefined || !LITERAL_ESCAPES.includes(next)) return null;
      out += next;
      index += 1;
      continue;
    }
    if (char === "(") {
      if (body[index + 1] === "?") {
        if (!body.startsWith("?:", index + 1)) return null;
        depth += 1;
        index += 2;
        continue;
      }
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) return null;
      depth -= 1;
      continue;
    }
    if (".*+?|[]{}^$".includes(char)) return null;
    out += char;
  }
  if (depth !== 0 || out.length === 0) return null;
  return out;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
