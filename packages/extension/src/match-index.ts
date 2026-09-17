import type {
  HeaderOperation,
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";
import {
  sanitizeDestinationForLog,
  sanitizeHeaderLogValue,
  sanitizeQueryTransformValue,
  truncateLogString,
} from "./match-log-redaction.js";

export const MATCH_LOGGING_INDEX_KEY = "rogatio.matchLogging.index";

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

function resolveRedactSensitive(operation: RogatioOperation): boolean {
  return operation.redactSensitiveInLogs === true;
}

function sanitizeQueryParams(
  params: QueryOperation["action"]["params"],
  redactSensitive: boolean,
): QueryIntentParam[] {
  return params.map((param) => {
    const operation = param.operation ?? "set";
    const name = truncateLogString(param.name);
    if (param.value === undefined) return { name, operation };
    const value = sanitizeQueryTransformValue(
      param.name,
      param.value,
      redactSensitive,
    );
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
  const value = sanitizeHeaderLogValue(
    intent.name,
    intent.value,
    redactSensitive,
  );
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
        destination: sanitizeDestinationForLog(
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
  if (operation.kind === "header") {
    const header = operation as HeaderOperation;
    const name = truncateLogString(header.header.name);
    const direction = header.header.direction;
    const headerOperation = header.header.operation;
    if (header.header.value === undefined) {
      return {
        ruleId: header.ruleId,
        kind: "header",
        redactSensitiveInLogs,
        intent: { direction, operation: headerOperation, name },
      };
    }
    return {
      ruleId: header.ruleId,
      kind: "header",
      redactSensitiveInLogs,
      intent: {
        direction,
        operation: headerOperation,
        name,
        value: sanitizeHeaderLogValue(
          header.header.name,
          header.header.value,
          redactSensitiveInLogs,
        ),
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
        destination: sanitizeDestinationForLog(
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
          const value = sanitizeQueryTransformValue(
            param.name,
            param.value,
            redactSensitiveInLogs,
          );
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

export async function readMatchIndexSnapshot(
  api: ChromeApi,
): Promise<MatchIndexSnapshot> {
  try {
    const index = await readRawIndex(api);
    const snapshot: MatchIndexSnapshot = {};
    for (const [id, raw] of Object.entries(index)) {
      const entry = parseStoredEntry(raw);
      if (entry !== undefined) snapshot[id] = entry;
    }
    return snapshot;
  } catch {
    return {};
  }
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
