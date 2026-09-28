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

/** Wire marker for a request-body PAC steer route: `steer:https://api.example.com`. */
export const PAC_STEER_MARKER = "steer:";

export interface SteeredOrigin {
  readonly scheme: "http" | "https";
  readonly host: string;
  readonly port?: number;
}

/**
 * Request-body steering origin.
 * The regex must start `^http://` or `^https://`, then one literal host
 * (dots escaped), then `/`. No top-level `|`. The path after the host may
 * still be a regular expression; PAC uses only `scheme://host/*`.
 */
export function steeredRequestOrigin(
  source: SourceCondition,
): SteeredOrigin | null {
  if (source.key !== "url" || source.operator !== "regex") return null;
  if (hasTopLevelAlternation(source.value)) return null;
  const match =
    /^\^(https?):\/\/((?:[A-Za-z0-9-]+|\\\.)+)(?::([0-9]+))?\//.exec(
      source.value,
    );
  if (match === null) return null;
  const scheme = match[1];
  const rawHost = match[2];
  if ((scheme !== "http" && scheme !== "https") || rawHost === undefined) {
    return null;
  }
  const host = rawHost.replace(/\\\./g, ".");
  if (!isLiteralSteerHost(host)) return null;
  const portText = match[3];
  if (portText === undefined) return { scheme, host };
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { scheme, host, port };
}

export function encodePacSteer(origin: SteeredOrigin): string {
  const port = origin.port !== undefined ? `:${origin.port}` : "";
  return `${PAC_STEER_MARKER}${origin.scheme}://${origin.host}${port}`;
}

export function decodePacSteer(entry: string): SteeredOrigin | null {
  if (!entry.startsWith(PAC_STEER_MARKER)) return null;
  const value = entry.slice(PAC_STEER_MARKER.length);
  let url: URL;
  try {
    url = new URL(`${value}/`);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const scheme = url.protocol === "https:" ? "https" : "http";
  const port = url.port === "" ? undefined : Number(url.port);
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    return null;
  }
  const rebuilt =
    port === undefined
      ? `${scheme}://${url.hostname}`
      : `${scheme}://${url.hostname}:${port}`;
  if (rebuilt !== value || !isLiteralSteerHost(url.hostname)) return null;
  return port === undefined
    ? { scheme, host: url.hostname }
    : { scheme, host: url.hostname, port };
}

function hasTopLevelAlternation(pattern: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === "|" && depth === 0) return true;
  }
  return false;
}

function isLiteralSteerHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    return false;
  }
  const labels = host.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  return true;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
