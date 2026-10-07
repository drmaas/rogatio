import {
  compileUrlRegex,
  HTTP_METHODS,
  type HttpMethod,
  LIMITS,
  RESOURCE_TYPES,
  type ResourceType,
  type SourceCondition,
} from "@rogatio/schema";
import { isRecord, ownString } from "./record.js";

const REQUESTLY_REGEX = /^\/(.+)\/(|i|g|ig|gi)$/;
const LITERAL_HOSTNAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const RESOURCE_SET = new Set<string>(RESOURCE_TYPES);
const METHOD_SET = new Set<string>(HTTP_METHODS);

export const SOURCE_CHANGE = {
  caseInsensitive:
    "The case-insensitive match flag was dropped. Rogatio regular expressions are case-sensitive.",
  hostPort:
    "Requestly compares the host and a non-default port. This host condition matches the hostname on any port.",
  hostAsUrl:
    "The host condition was imported as a URL regular expression so the port stays part of the match.",
  path: "The path condition was imported as a URL regular expression.",
} as const;

/** Skip reason when a host Matches pair cannot be confined to the authority. */
export const HOST_MATCHES_SKIP_REASON =
  "Host regular expressions cannot be confined to the host in a URL regex.";

export interface ConvertedSource {
  readonly source: SourceCondition;
  readonly changes: readonly string[];
}

export type ConvertResult =
  | { readonly ok: true; readonly converted: ConvertedSource }
  | { readonly ok: false; readonly reason: string };

export interface ResolvedFilters {
  readonly resourceTypes: readonly ResourceType[];
  readonly methods: readonly HttpMethod[] | "all";
  readonly changes: readonly string[];
}

export type FilterResult =
  | { readonly ok: true; readonly filters: ResolvedFilters }
  | { readonly ok: false; readonly reason: string };

export function escapeRegex(literal: string): string {
  return literal.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

export function convertSource(source: Record<string, unknown>): ConvertResult {
  const key = ownString(source, "key");
  const operator = ownString(source, "operator");
  const value = ownString(source, "value");
  if (key === undefined || operator === undefined || value === undefined) {
    return { ok: false, reason: "The source condition is missing." };
  }
  if (operator === "Equals" && value.length === 0) {
    return { ok: false, reason: "The source value is empty." };
  }
  if (key === "Url") return convertUrl(operator, value);
  if (key === "host") return convertHost(operator, value);
  if (key === "path") return convertPath(operator, value);
  return { ok: false, reason: `Unsupported source key "${key}".` };
}

export function readFilters(source: Record<string, unknown>): FilterResult {
  if (!Object.hasOwn(source, "filters") || source.filters === undefined) {
    return {
      ok: true,
      filters: {
        resourceTypes: [...RESOURCE_TYPES],
        methods: "all",
        changes: [],
      },
    };
  }
  const raw = source.filters;
  const list = Array.isArray(raw) ? raw : [raw];
  const changes: string[] = [];
  let resourceTypes: ResourceType[] | undefined;
  let methods: HttpMethod[] | undefined;

  for (const entry of list) {
    if (!isRecord(entry)) {
      return { ok: false, reason: "A source filter is not an object." };
    }
    if (isActive(entry.pageUrl) || isActive(entry.pageDomains)) {
      return {
        ok: false,
        reason:
          "Page URL and page domain filters are not supported, so the rule was not imported.",
      };
    }
    if (isActive(entry.requestPayload)) {
      return {
        ok: false,
        reason:
          "Request payload filters are not supported, so the rule was not imported.",
      };
    }
    if (Object.hasOwn(entry, "resourceType")) {
      const read = readResourceTypes(entry.resourceType);
      if (!read.ok) return read;
      resourceTypes = intersect(resourceTypes, read.values);
      changes.push(...read.changes);
    }
    if (Object.hasOwn(entry, "requestMethod")) {
      const read = readMethods(entry.requestMethod);
      if (!read.ok) return read;
      methods = intersect(methods, read.values);
      changes.push(...read.changes);
    }
  }

  if (resourceTypes !== undefined && resourceTypes.length === 0) {
    return {
      ok: false,
      reason: "The resource type filter matches no supported type.",
    };
  }
  if (methods !== undefined && methods.length === 0) {
    return {
      ok: false,
      reason: "The request method filter matches no supported method.",
    };
  }

  return {
    ok: true,
    filters: {
      resourceTypes: resourceTypes ?? [...RESOURCE_TYPES],
      methods: methods ?? "all",
      changes,
    },
  };
}

export function acceptRegex(
  pattern: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (pattern.length === 0 || pattern.length > LIMITS.maxUrlRegexLength) {
    return {
      ok: false,
      reason: "The source regular expression exceeds the length limit.",
    };
  }
  if (compileUrlRegex(pattern) === null) {
    return { ok: false, reason: "The source regular expression is invalid." };
  }
  return { ok: true };
}

function convertUrl(operator: string, value: string): ConvertResult {
  if (operator === "Equals") {
    return finishUrl(`^${escapeRegex(value)}$`, []);
  }
  if (operator === "Contains") {
    const pattern = value.length === 0 ? "[\\s\\S]*" : escapeRegex(value);
    return finishUrl(pattern, []);
  }
  if (operator === "Wildcard_Matches") {
    return finishUrl(`^${wildcardBody(value)}$`, []);
  }
  if (operator === "Matches") return finishMatches(value);
  return { ok: false, reason: `Unsupported source operator "${operator}".` };
}

function convertHost(operator: string, value: string): ConvertResult {
  if (value.includes(":") && splitHostPort(value) === null) {
    return { ok: false, reason: "IPv6 host conditions are not supported." };
  }
  if (operator === "Equals") {
    if (isLiteralHostname(value)) {
      return finish(
        { key: "host", operator: "regex", value: `^${escapeRegex(value)}$` },
        [SOURCE_CHANGE.hostPort],
      );
    }
    const port = splitHostPort(value);
    if (port !== null) {
      return finishUrl(`^https?:\\/\\/${escapeRegex(value)}(?:[/?#].*)?$`, [
        SOURCE_CHANGE.hostAsUrl,
      ]);
    }
    return {
      ok: false,
      reason: "The host value is not a literal hostname or hostname:port.",
    };
  }
  if (operator === "Contains") {
    const body =
      value.length === 0 ? "[^/?#@]*" : `[^/?#@]*${escapeRegex(value)}[^/?#@]*`;
    return finishUrl(`^https?:\\/\\/${body}(?:[/?#].*)?$`, [
      SOURCE_CHANGE.hostAsUrl,
    ]);
  }
  if (operator === "Wildcard_Matches") {
    // Host-only wildcards: * must not cross /, ?, #, or @ (authority only).
    // Optional :port keeps non-default ports in the authority match.
    return finishUrl(
      `^https?:\\/\\/${hostWildcardBody(value)}(?::[0-9]+)?(?:[/?#].*)?$`,
      [SOURCE_CHANGE.hostAsUrl],
    );
  }
  if (operator === "Matches") {
    // RE2 has no lookarounds, so a user regex cannot be confined to the host.
    return { ok: false, reason: HOST_MATCHES_SKIP_REASON };
  }
  return { ok: false, reason: `Unsupported source operator "${operator}".` };
}

function convertPath(operator: string, value: string): ConvertResult {
  const changes: string[] = [SOURCE_CHANGE.path];
  if (operator === "Equals") {
    if (value === "/" || value.length === 0) {
      return finishUrl("^https?:\\/\\/[^/?#]+\\/?(?:[?#].*)?$", changes);
    }
    return finishUrl(
      `^https?:\\/\\/[^/?#]+${escapeRegex(value)}(?:[?#].*)?$`,
      changes,
    );
  }
  if (operator === "Contains") {
    const body =
      value.length === 0 ? "[^?#]*" : `[^?#]*${escapeRegex(value)}[^?#]*`;
    return finishUrl(`^https?:\\/\\/[^/?#]+\\/${body}(?:[?#].*)?$`, changes);
  }
  if (operator === "Wildcard_Matches") {
    return finishUrl(
      `^https?:\\/\\/[^/?#]+${wildcardBody(value)}(?:[?#].*)?$`,
      changes,
    );
  }
  if (operator === "Matches") {
    const parsed = parseRequestlyRegex(value);
    if (!parsed.ok) return parsed;
    const inner = stripAnchors(parsed.source);
    if (parsed.caseInsensitive) changes.push(SOURCE_CHANGE.caseInsensitive);
    return finishUrl(`^https?:\\/\\/[^/?#]+(?:${inner})(?:[?#].*)?$`, changes);
  }
  return { ok: false, reason: `Unsupported source operator "${operator}".` };
}

function finishMatches(value: string): ConvertResult {
  const parsed = parseRequestlyRegex(value);
  if (!parsed.ok) return parsed;
  return finishUrl(
    parsed.source,
    parsed.caseInsensitive ? [SOURCE_CHANGE.caseInsensitive] : [],
  );
}

function finishUrl(pattern: string, changes: readonly string[]): ConvertResult {
  return finish({ key: "url", operator: "regex", value: pattern }, changes);
}

function finish(
  source: SourceCondition,
  changes: readonly string[],
): ConvertResult {
  const accepted = acceptRegex(source.value);
  if (!accepted.ok) return accepted;
  return { ok: true, converted: { source, changes } };
}

export function parseRequestlyRegex(value: string):
  | {
      readonly ok: true;
      readonly source: string;
      readonly caseInsensitive: boolean;
    }
  | { readonly ok: false; readonly reason: string } {
  const match = REQUESTLY_REGEX.exec(value);
  const source = match?.[1];
  if (match === null || source === undefined) {
    return {
      ok: false,
      reason:
        "A Matches value must be a /pattern/flags regular expression with flags i, g, or both.",
    };
  }
  const flags = match[2] ?? "";
  try {
    new RegExp(source);
  } catch {
    return { ok: false, reason: "The source regular expression is invalid." };
  }
  return { ok: true, source, caseInsensitive: flags.includes("i") };
}

export function wildcardBody(pattern: string): string {
  return pattern
    .split("*")
    .map((part) => escapeRegex(part))
    .join("(.*?)");
}

/**
 * Host Wildcard_Matches body: same capture count as {@link wildcardBody}, but
 * each `*` is confined to authority characters (no `/`, `?`, `#`, or `@`).
 */
export function hostWildcardBody(pattern: string): string {
  return pattern
    .split("*")
    .map((part) => escapeRegex(part))
    .join("([^/?#@]*?)");
}

export function isRequestlyRegexLiteral(value: string): boolean {
  return REQUESTLY_REGEX.test(value);
}

function stripAnchors(pattern: string): string {
  let next = pattern;
  if (next.startsWith("^")) next = next.slice(1);
  if (next.endsWith("$")) next = next.slice(0, -1);
  return next;
}

function isLiteralHostname(value: string): boolean {
  return LITERAL_HOSTNAME.test(value);
}

function splitHostPort(value: string): { host: string; port: string } | null {
  const index = value.lastIndexOf(":");
  if (index <= 0) return null;
  const host = value.slice(0, index);
  const port = value.slice(index + 1);
  if (
    !/^[0-9]+$/.test(port) ||
    host.includes(":") ||
    !isLiteralHostname(host)
  ) {
    return null;
  }
  return { host, port };
}

function isActive(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return value.length > 0;
  return value !== undefined && value !== null;
}

function readResourceTypes(value: unknown):
  | {
      readonly ok: true;
      readonly values: readonly ResourceType[];
      readonly changes: readonly string[];
    }
  | { readonly ok: false; readonly reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "The resource type filter is not a list." };
  }
  if (value.length === 0) {
    return {
      ok: false,
      reason: "The resource type filter matches no supported type.",
    };
  }
  const known: ResourceType[] = [];
  const unknown: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (RESOURCE_SET.has(entry)) known.push(entry as ResourceType);
    else unknown.push(entry);
  }
  const ordered = RESOURCE_TYPES.filter((type) => known.includes(type));
  const changes =
    unknown.length > 0
      ? [`Dropped unrecognized resource types: ${unknown.join(", ")}.`]
      : [];
  return { ok: true, values: ordered, changes };
}

function readMethods(value: unknown):
  | {
      readonly ok: true;
      readonly values: readonly HttpMethod[];
      readonly changes: readonly string[];
    }
  | { readonly ok: false; readonly reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "The request method filter is not a list." };
  }
  if (value.length === 0) {
    return {
      ok: false,
      reason: "The request method filter matches no supported method.",
    };
  }
  const known: HttpMethod[] = [];
  const unknown: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (METHOD_SET.has(entry)) known.push(entry as HttpMethod);
    else unknown.push(entry);
  }
  const ordered = HTTP_METHODS.filter((method) => known.includes(method));
  const changes =
    unknown.length > 0
      ? [`Dropped unrecognized request methods: ${unknown.join(", ")}.`]
      : [];
  return { ok: true, values: ordered, changes };
}

function intersect<T>(
  current: readonly T[] | undefined,
  next: readonly T[],
): T[] {
  if (current === undefined) return [...next];
  const allowed = new Set(next);
  return current.filter((entry) => allowed.has(entry));
}
