import type {
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { isForbiddenHeader } from "@rogatio/schema";
import type { ChromeApi } from "./chrome.js";

export const MATCH_LOGGING_INDEX_KEY = "rogatio.matchLogging.index";

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

export interface RedirectIntent {
  readonly destination: string;
}

export interface QueryIntentParam {
  readonly name: string;
  readonly operation: string;
  readonly value?: string;
}

export interface QueryIntent {
  readonly params: readonly QueryIntentParam[];
}

export interface HeaderIntent {
  readonly direction: string;
  readonly operation: string;
  readonly name: string;
  readonly value?: string;
}

export type MatchIndexIntent = RedirectIntent | QueryIntent | HeaderIntent;

export interface MatchIndexEntry {
  readonly ruleId: string;
  readonly kind: "redirect" | "query" | "header";
  readonly redactSensitiveInLogs: boolean;
  readonly intent: MatchIndexIntent;
}

export type MatchIndexSnapshot = Record<string, MatchIndexEntry>;

export function truncateLogString(value: string): string {
  if (value.length <= 200) return value;
  let cut = value.slice(0, 197);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  // Never emit half of a surrogate pair.
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}...`;
}

function isDenyListedQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return QUERY_KEY_DENY_SUBSTRINGS.some((fragment) => lower.includes(fragment));
}

function isDenyListedHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  const extras: readonly string[] = EXTRA_SENSITIVE_HEADER_NAMES;
  if (extras.includes(normalized)) return true;
  // Direction-agnostic: redact a value whose name is forbidden either way.
  return (
    isForbiddenHeader(normalized, "request") ||
    isForbiddenHeader(normalized, "response")
  );
}

function redactUrlQueryValues(url: string): string {
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

function resolveRedactSensitive(operation: RogatioOperation): boolean {
  return operation.redactSensitiveInLogs === true;
}

function sanitizeDestination(
  destination: string,
  redactSensitive: boolean,
): string {
  let value = destination;
  if (redactSensitive) value = redactUrlQueryValues(value);
  return truncateLogString(value);
}

function sanitizeQueryParams(
  params: QueryOperation["action"]["params"],
  redactSensitive: boolean,
): QueryIntentParam[] {
  return params.map((param) => {
    const operation = param.operation ?? "set";
    const name = truncateLogString(param.name);
    if (param.value === undefined) return { name, operation };
    let value = param.value;
    if (redactSensitive && isDenyListedQueryKey(param.name)) {
      value = "[redacted]";
    } else {
      value = truncateLogString(value);
    }
    return { name, operation, value };
  });
}

function sanitizeHeaderIntent(
  intent: HeaderIntent,
  redactSensitive: boolean,
): HeaderIntent {
  const name = truncateLogString(intent.name);
  const direction = intent.direction;
  const operation = intent.operation;
  if (intent.value === undefined) {
    return { direction, operation, name };
  }
  let value = intent.value;
  if (redactSensitive && isDenyListedHeaderName(intent.name)) {
    value = "[redacted]";
  } else {
    value = truncateLogString(value);
  }
  return { direction, operation, name, value };
}

function entryFromOperation(
  operation: RogatioOperation,
): MatchIndexEntry | undefined {
  const redactSensitiveInLogs = resolveRedactSensitive(operation);
  if (operation.kind === "redirect") {
    const redirect = operation as RedirectOperation;
    return {
      ruleId: redirect.ruleId,
      kind: "redirect",
      redactSensitiveInLogs,
      intent: {
        destination: sanitizeDestination(
          redirect.redirect.destination,
          redactSensitiveInLogs,
        ),
      },
    };
  }
  if (operation.kind === "query") {
    const query = operation as QueryOperation;
    return {
      ruleId: query.ruleId,
      kind: "query",
      redactSensitiveInLogs,
      intent: {
        params: sanitizeQueryParams(query.action.params, redactSensitiveInLogs),
      },
    };
  }
  return undefined;
}

export function sanitizeMatchIndexEntry(
  entry: MatchIndexEntry,
): MatchIndexEntry {
  const redactSensitiveInLogs = entry.redactSensitiveInLogs === true;
  if (entry.kind === "redirect") {
    const intent = entry.intent as RedirectIntent;
    return {
      ruleId: entry.ruleId,
      kind: "redirect",
      redactSensitiveInLogs,
      intent: {
        destination: sanitizeDestination(
          intent.destination,
          redactSensitiveInLogs,
        ),
      },
    };
  }
  if (entry.kind === "query") {
    const intent = entry.intent as QueryIntent;
    return {
      ruleId: entry.ruleId,
      kind: "query",
      redactSensitiveInLogs,
      intent: {
        params: intent.params.map((param) => {
          const operation = param.operation;
          const name = truncateLogString(param.name);
          if (param.value === undefined) return { name, operation };
          let value = param.value;
          if (redactSensitiveInLogs && isDenyListedQueryKey(param.name)) {
            value = "[redacted]";
          } else {
            value = truncateLogString(value);
          }
          return { name, operation, value };
        }),
      },
    };
  }
  return {
    ruleId: entry.ruleId,
    kind: "header",
    redactSensitiveInLogs,
    intent: sanitizeHeaderIntent(
      entry.intent as HeaderIntent,
      redactSensitiveInLogs,
    ),
  };
}

export function buildInstallIndexSnapshot(
  installed: ReadonlyArray<{
    readonly ruleId: number;
    readonly operation: RogatioOperation;
  }>,
): MatchIndexSnapshot {
  const snapshot: MatchIndexSnapshot = {};
  for (const entry of installed) {
    const indexEntry = entryFromOperation(entry.operation);
    if (indexEntry === undefined) continue;
    snapshot[String(entry.ruleId)] = indexEntry;
  }
  return snapshot;
}

export async function writeMatchIndex(
  api: ChromeApi,
  snapshot: MatchIndexSnapshot,
): Promise<void> {
  const sanitized: MatchIndexSnapshot = {};
  for (const [id, entry] of Object.entries(snapshot)) {
    sanitized[id] = sanitizeMatchIndexEntry(entry);
  }
  await api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: sanitized });
}

// Inherited members of a tampered stored object are not data.
function own(raw: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined;
}

function ownRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

function parseRedirectIntent(
  raw: Record<string, unknown>,
): RedirectIntent | undefined {
  const destination = own(raw, "destination");
  if (typeof destination !== "string") return undefined;
  return { destination };
}

function parseQueryIntent(
  raw: Record<string, unknown>,
): QueryIntent | undefined {
  const rawParams = own(raw, "params");
  if (!Array.isArray(rawParams)) return undefined;
  const params: QueryIntentParam[] = [];
  for (const item of rawParams) {
    const param = ownRecord(item);
    if (param === undefined) return undefined;
    const name = own(param, "name");
    const operation = own(param, "operation");
    const value = own(param, "value");
    if (typeof name !== "string" || typeof operation !== "string") {
      return undefined;
    }
    if (value !== undefined && typeof value !== "string") return undefined;
    params.push(
      value === undefined ? { name, operation } : { name, operation, value },
    );
  }
  return { params };
}

function parseHeaderIntent(
  raw: Record<string, unknown>,
): HeaderIntent | undefined {
  const direction = own(raw, "direction");
  const operation = own(raw, "operation");
  const name = own(raw, "name");
  const value = own(raw, "value");
  if (
    typeof direction !== "string" ||
    typeof operation !== "string" ||
    typeof name !== "string"
  ) {
    return undefined;
  }
  if (value !== undefined && typeof value !== "string") return undefined;
  return value === undefined
    ? { direction, operation, name }
    : { direction, operation, name, value };
}

function parseStoredEntry(raw: unknown): MatchIndexEntry | undefined {
  const entry = ownRecord(raw);
  if (entry === undefined) return undefined;
  const ruleId = own(entry, "ruleId");
  const kind = own(entry, "kind");
  const redactSensitiveInLogs = own(entry, "redactSensitiveInLogs");
  if (typeof ruleId !== "string") return undefined;
  if (kind !== "redirect" && kind !== "query" && kind !== "header") {
    return undefined;
  }
  if (typeof redactSensitiveInLogs !== "boolean") return undefined;
  const intentRaw = ownRecord(own(entry, "intent"));
  if (intentRaw === undefined) return undefined;
  let intent: MatchIndexIntent | undefined;
  if (kind === "redirect") intent = parseRedirectIntent(intentRaw);
  else if (kind === "query") intent = parseQueryIntent(intentRaw);
  else intent = parseHeaderIntent(intentRaw);
  if (intent === undefined) return undefined;
  return { ruleId, kind, redactSensitiveInLogs, intent };
}

async function readRawIndex(api: ChromeApi): Promise<Record<string, unknown>> {
  const result = ownRecord(
    await api.storage.local.get(MATCH_LOGGING_INDEX_KEY),
  );
  if (result === undefined) return {};
  return ownRecord(own(result, MATCH_LOGGING_INDEX_KEY)) ?? {};
}

export async function lookupMatchIndexEntry(
  api: ChromeApi,
  numericId: number,
): Promise<MatchIndexEntry | undefined> {
  // Storage is writable by extension pages: a rejected read or a throwing
  // accessor resolves to "unknown id", never an exception on the match path.
  try {
    const index = await readRawIndex(api);
    return parseStoredEntry(own(index, String(numericId)));
  } catch {
    return undefined;
  }
}
