import {
  LIMITS,
  type SourceCondition,
  validateRedirectDestination,
} from "@rogatio/schema";
import { ownString } from "./record.js";
import { acceptRegex, escapeRegex, isRequestlyRegexLiteral } from "./source.js";

export interface ReplaceRedirect {
  readonly source: SourceCondition;
  readonly destination: string;
  readonly nameSuffix: string;
}

export type ReplaceResult =
  | {
      readonly ok: true;
      readonly redirects: readonly ReplaceRedirect[];
      readonly changes: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

const BASE_CHANGE =
  "Replace was imported as a redirect that substitutes the first literal occurrence.";

export function mapReplace(
  source: Record<string, unknown>,
  from: string,
  to: string,
): ReplaceResult {
  if (from.length === 0) {
    return { ok: false, reason: "The replace text is empty." };
  }
  if (isRequestlyRegexLiteral(from)) {
    return {
      ok: false,
      reason:
        "A regular-expression replace cannot be represented as one redirect destination.",
    };
  }
  if (to.includes("\\")) {
    return {
      ok: false,
      reason:
        "The replacement contains a backslash, which Rogatio would read as a capture reference.",
    };
  }
  const key = ownString(source, "key");
  const operator = ownString(source, "operator");
  const value = ownString(source, "value");
  if (key === undefined || operator === undefined || value === undefined) {
    return { ok: false, reason: "The source condition is missing." };
  }
  if (operator === "Matches") {
    return {
      ok: false,
      reason:
        "Replace combined with a Matches source cannot be represented as one redirect destination.",
    };
  }

  const changes = [BASE_CHANGE];
  if (to.includes("$")) {
    changes.push(
      "A literal $ in the replacement was escaped so it is not read as a capture reference.",
    );
  }
  const replacement = escapeDollars(to);

  if (key === "Url" && operator === "Equals") {
    return mapEquals(value, from, replacement, changes);
  }
  if (key === "Url" && operator === "Wildcard_Matches") {
    return mapWildcard(value, from, replacement, changes);
  }
  if (key === "Url" && operator === "Contains") {
    return mapContains(value, from, replacement, changes);
  }
  if (key === "host" && operator === "Equals") {
    return mapHostEquals(value, from, replacement, changes);
  }
  return {
    ok: false,
    reason: `Replace is not supported for source ${key} ${operator}.`,
  };
}

function mapEquals(
  url: string,
  from: string,
  to: string,
  changes: string[],
): ReplaceResult {
  if (!isAbsoluteHttpUrl(url)) {
    return {
      ok: false,
      reason: "The exact URL is not an absolute http(s) URL.",
    };
  }
  const index = url.indexOf(from);
  if (index < 0) {
    return {
      ok: false,
      reason: "The URL does not contain the text to replace.",
    };
  }
  const destination = escapeDollars(
    url.slice(0, index) + unescapeDollars(to) + url.slice(index + from.length),
  );
  const pattern = `^${escapeRegex(url)}$`;
  const redirect = acceptRedirect(pattern, destination, "");
  if (redirect === null) {
    return {
      ok: false,
      reason:
        "The replacement does not produce an absolute http(s) redirect destination.",
    };
  }
  return { ok: true, redirects: [redirect], changes };
}

function mapWildcard(
  pattern: string,
  from: string,
  to: string,
  changes: string[],
): ReplaceResult {
  if (!pattern.startsWith("http://") && !pattern.startsWith("https://")) {
    return {
      ok: false,
      reason: "A wildcard replace must start with an absolute http(s) URL.",
    };
  }
  const pieces = pattern.split("*");
  if (pieces.length - 1 > LIMITS.maxCaptureGroups) {
    return {
      ok: false,
      reason: "The wildcard has more than 9 captures.",
    };
  }
  const replaced = replaceFirstLiteral(pieces, from, unescapeDollars(to));
  if (replaced === null) {
    return {
      ok: false,
      reason: "The text to replace is not a fixed part of the URL.",
    };
  }
  const source = `^${pieces.map((part) => escapeRegex(part)).join("(.*?)")}$`;
  const destination = templateFromPieces(replaced);
  const redirect = acceptRedirect(source, destination, "");
  if (redirect === null) {
    return {
      ok: false,
      reason:
        "The replacement does not produce an absolute http(s) redirect destination.",
    };
  }
  return { ok: true, redirects: [redirect], changes };
}

function mapContains(
  contains: string,
  from: string,
  to: string,
  changes: string[],
): ReplaceResult {
  changes.push("Separate http and https rules were created.");
  const lookahead =
    contains.length > 0 && contains !== from
      ? `(?=.*${escapeRegex(contains)})`
      : "";
  const redirects: ReplaceRedirect[] = [];
  for (const scheme of ["https", "http"] as const) {
    const pattern = `^${lookahead}${scheme}://(.*?)${escapeRegex(from)}(.*)$`;
    const destination = `${scheme}://\\1${to}\\2`;
    const redirect = acceptRedirect(pattern, destination, scheme);
    if (redirect !== null) redirects.push(redirect);
  }
  if (redirects.length === 0) {
    return {
      ok: false,
      reason:
        "The replacement does not produce an absolute http(s) redirect destination.",
    };
  }
  return { ok: true, redirects, changes };
}

function mapHostEquals(
  host: string,
  from: string,
  to: string,
  changes: string[],
): ReplaceResult {
  if (host.includes("/") || host.includes("?") || host.includes("#")) {
    return {
      ok: false,
      reason: "The host value is not a literal hostname or hostname:port.",
    };
  }
  changes.push("Separate http and https rules were created.");
  const redirects: ReplaceRedirect[] = [];
  const schemes: ReadonlyArray<{
    scheme: "https" | "http";
    port: string;
  }> = [
    { scheme: "https", port: host.includes(":") ? "" : "(?::443)?" },
    { scheme: "http", port: host.includes(":") ? "" : "(?::80)?" },
  ];
  for (const entry of schemes) {
    const prefix = `${entry.scheme}://${host}`;
    const index = prefix.indexOf(from);
    if (index < 0) continue;
    const nextPrefix =
      prefix.slice(0, index) +
      unescapeDollars(to) +
      prefix.slice(index + from.length);
    const pattern = `^${escapeRegex(entry.scheme)}:\\/\\/${escapeRegex(host)}${entry.port}((?:[/?#].*)?)$`;
    const destination = `${escapeDollars(nextPrefix)}\\1`;
    const redirect = acceptRedirect(pattern, destination, entry.scheme);
    if (redirect !== null) redirects.push(redirect);
  }
  if (redirects.length === 0) {
    return {
      ok: false,
      reason: "The text to replace is not a fixed part of the host.",
    };
  }
  return { ok: true, redirects, changes };
}

function acceptRedirect(
  pattern: string,
  destination: string,
  nameSuffix: string,
): ReplaceRedirect | null {
  if (!acceptRegex(pattern).ok) return null;
  if (
    destination.length === 0 ||
    destination.length > LIMITS.maxRedirectDestinationLength
  ) {
    return null;
  }
  if (validateRedirectDestination(destination, pattern).length > 0) return null;
  return {
    source: { key: "url", operator: "regex", value: pattern },
    destination,
    nameSuffix,
  };
}

function replaceFirstLiteral(
  pieces: readonly string[],
  from: string,
  to: string,
): string[] | null {
  const next = [...pieces];
  for (let index = 0; index < next.length; index += 1) {
    const piece = next[index] ?? "";
    const at = piece.indexOf(from);
    if (at < 0) continue;
    next[index] = piece.slice(0, at) + to + piece.slice(at + from.length);
    return next;
  }
  return null;
}

function templateFromPieces(pieces: readonly string[]): string {
  let template = "";
  for (let index = 0; index < pieces.length; index += 1) {
    template += escapeDollars(pieces[index] ?? "");
    if (index < pieces.length - 1) template += `\\${index + 1}`;
  }
  return template;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hostname.length > 0 &&
      !url.hostname.includes("*")
    );
  } catch {
    return false;
  }
}

function escapeDollars(value: string): string {
  return value.replaceAll("$", "$$");
}

function unescapeDollars(value: string): string {
  return value.replaceAll("$$", "$");
}
