import type { RogatioOperation } from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";
import {
  sanitizeBodyRewriteForLog,
  sanitizeDestinationForLog,
  sanitizeHeaderLogValue,
  sanitizeQueryTransformValue,
  truncateLogString,
} from "./match-log-redaction.js";
import {
  type BodyMarkerOperation,
  bodyMarkerIdForIndex,
  isBodyMarkerBandId,
} from "./session-body-markers.js";

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

/** Intended body action from rule config (never live body bytes). */
export interface BodyIntent {
  readonly mode: string;
  readonly rewrite: string;
}

export type MatchIndexIntent =
  | RedirectIntent
  | QueryIntent
  | HeaderIntent
  | BodyIntent;

export interface MatchIndexEntry {
  readonly ruleId: string;
  readonly name: string;
  readonly kind:
    | "redirect"
    | "query"
    | "header"
    | "request-body"
    | "response-body";
  readonly redactSensitiveInLogs: boolean;
  readonly intent: MatchIndexIntent;
}

export type MatchIndexSnapshot = Record<string, MatchIndexEntry>;

function resolveRedactSensitive(operation: RogatioOperation): boolean {
  return operation.redactSensitiveInLogs === true;
}

function intentHasOwnString(intent: MatchIndexIntent, key: string): boolean {
  return (
    Object.hasOwn(intent, key) &&
    typeof (intent as unknown as Record<string, unknown>)[key] === "string"
  );
}

function isRedirectIntent(intent: MatchIndexIntent): intent is RedirectIntent {
  return intentHasOwnString(intent, "destination");
}

function isQueryIntent(intent: MatchIndexIntent): intent is QueryIntent {
  return (
    Object.hasOwn(intent, "params") &&
    Array.isArray((intent as QueryIntent).params)
  );
}

function isHeaderIntent(intent: MatchIndexIntent): intent is HeaderIntent {
  return (
    intentHasOwnString(intent, "direction") &&
    intentHasOwnString(intent, "operation") &&
    intentHasOwnString(intent, "name")
  );
}

function isBodyIntent(intent: MatchIndexIntent): intent is BodyIntent {
  return intentHasOwnString(intent, "mode");
}

function bodyRewriteFromIntent(intent: BodyIntent): string {
  if (!Object.hasOwn(intent, "rewrite")) return "";
  const rewrite = (intent as { rewrite?: unknown }).rewrite;
  return typeof rewrite === "string" ? rewrite : "";
}

function boundStoredKind(kind: string): MatchIndexEntry["kind"] {
  const truncated = truncateLogString(kind);
  if (
    truncated === "redirect" ||
    truncated === "query" ||
    truncated === "header" ||
    truncated === "request-body" ||
    truncated === "response-body"
  ) {
    return truncated;
  }
  return truncated as MatchIndexEntry["kind"];
}

function bodyModeFromOperation(operation: BodyMarkerOperation): string {
  if (operation.kind === "request-body") {
    return operation.requestBody.mode;
  }
  const action = operation.responseBody;
  if (
    action !== null &&
    typeof action === "object" &&
    Object.hasOwn(action, "mode") &&
    typeof (action as { mode?: unknown }).mode === "string"
  ) {
    return (action as { mode: string }).mode;
  }
  return "regex";
}

function bodyRewriteFromOperation(operation: BodyMarkerOperation): string {
  if (operation.kind === "request-body") {
    const action = operation.requestBody;
    if (action.mode === "replace") return action.body;
    return `${action.pattern} → ${action.replacement}`;
  }
  const action = operation.responseBody;
  if (
    action !== null &&
    typeof action === "object" &&
    Object.hasOwn(action, "mode") &&
    (action as { mode?: unknown }).mode === "replace" &&
    Object.hasOwn(action, "body") &&
    typeof (action as { body?: unknown }).body === "string"
  ) {
    return (action as { body: string }).body;
  }
  const replacements =
    action !== null &&
    typeof action === "object" &&
    Object.hasOwn(action, "replacements") &&
    Array.isArray((action as { replacements?: unknown }).replacements)
      ? (
          action as {
            replacements: ReadonlyArray<{
              pattern?: unknown;
              replacement?: unknown;
            }>;
          }
        ).replacements
      : [];
  return replacements
    .map((entry) => {
      const pattern = typeof entry?.pattern === "string" ? entry.pattern : "";
      const replacement =
        typeof entry?.replacement === "string" ? entry.replacement : "";
      return `${pattern} → ${replacement}`;
    })
    .join("; ");
}

function sanitizeQueryParams(
  params: readonly QueryIntentParam[],
  redactSensitive: boolean,
): QueryIntentParam[] {
  return params.map((param) => {
    const operation = truncateLogString(
      typeof param.operation === "string" ? param.operation : "set",
    );
    const name = truncateLogString(
      typeof param.name === "string" ? param.name : "",
    );
    if (param.value === undefined) return { name, operation };
    const value = sanitizeQueryTransformValue(
      typeof param.name === "string" ? param.name : "",
      typeof param.value === "string" ? param.value : "",
      redactSensitive,
    );
    return { name, operation, value };
  });
}

function sanitizeHeaderIntent(
  intent: HeaderIntent,
  redactSensitive: boolean,
): HeaderIntent {
  const direction = truncateLogString(intent.direction);
  const operation = truncateLogString(intent.operation);
  const name = truncateLogString(intent.name);
  if (intent.value === undefined || typeof intent.value !== "string") {
    return { direction, operation, name };
  }
  const value = sanitizeHeaderLogValue(
    intent.name,
    intent.value,
    redactSensitive,
  );
  return { direction, operation, name, value };
}

function sanitizeIntentByShape(
  intent: MatchIndexIntent,
  redactSensitive: boolean,
): MatchIndexIntent {
  if (isRedirectIntent(intent)) {
    return {
      destination: sanitizeDestinationForLog(
        intent.destination,
        redactSensitive,
      ),
    };
  }
  if (isQueryIntent(intent)) {
    return {
      params: sanitizeQueryParams(intent.params, redactSensitive),
    };
  }
  if (isHeaderIntent(intent)) {
    return sanitizeHeaderIntent(intent, redactSensitive);
  }
  if (isBodyIntent(intent)) {
    return {
      mode: truncateLogString(intent.mode),
      rewrite: sanitizeBodyRewriteForLog(
        bodyRewriteFromIntent(intent),
        redactSensitive,
      ),
    };
  }
  if (intent === null || typeof intent !== "object" || Array.isArray(intent)) {
    return intent;
  }
  const bounded: Record<string, unknown> = {
    ...(intent as Record<string, unknown>),
  };
  for (const key of Object.keys(bounded)) {
    if (!Object.hasOwn(bounded, key)) continue;
    const value = bounded[key];
    if (typeof value === "string") bounded[key] = truncateLogString(value);
  }
  return bounded as unknown as MatchIndexIntent;
}

function rawEntryFromOperation(
  operation: RogatioOperation,
): MatchIndexEntry | undefined {
  const redactSensitiveInLogs = resolveRedactSensitive(operation);
  if (operation.kind === "redirect") {
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: "redirect",
      redactSensitiveInLogs,
      intent: { destination: operation.redirect.destination },
    };
  }
  if (operation.kind === "query") {
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: "query",
      redactSensitiveInLogs,
      intent: {
        params: operation.action.params.map((param) => {
          const operationName = param.operation ?? "set";
          if (param.value === undefined) {
            return { name: param.name, operation: operationName };
          }
          return {
            name: param.name,
            operation: operationName,
            value: param.value,
          };
        }),
      },
    };
  }
  if (operation.kind === "header") {
    const {
      direction,
      operation: headerOperation,
      name,
      value,
    } = operation.header;
    if (value === undefined) {
      return {
        ruleId: operation.ruleId,
        name: operation.name,
        kind: "header",
        redactSensitiveInLogs,
        intent: { direction, operation: headerOperation, name },
      };
    }
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: "header",
      redactSensitiveInLogs,
      intent: { direction, operation: headerOperation, name, value },
    };
  }
  if (operation.kind === "request-body" || operation.kind === "response-body") {
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: operation.kind,
      redactSensitiveInLogs,
      intent: {
        mode: bodyModeFromOperation(operation),
        rewrite: bodyRewriteFromOperation(operation),
      },
    };
  }
  return undefined;
}

export function sanitizeMatchIndexEntry(
  entry: MatchIndexEntry,
): MatchIndexEntry {
  const ruleId = truncateLogString(entry.ruleId);
  const name = truncateLogString(entry.name);
  const kind = boundStoredKind(entry.kind);
  const redactSensitiveInLogs = entry.redactSensitiveInLogs === true;

  if (entry.kind === "redirect" && isRedirectIntent(entry.intent)) {
    return {
      ruleId,
      name,
      kind,
      redactSensitiveInLogs,
      intent: {
        destination: sanitizeDestinationForLog(
          entry.intent.destination,
          redactSensitiveInLogs,
        ),
      },
    };
  }
  if (entry.kind === "query" && isQueryIntent(entry.intent)) {
    return {
      ruleId,
      name,
      kind,
      redactSensitiveInLogs,
      intent: {
        params: sanitizeQueryParams(entry.intent.params, redactSensitiveInLogs),
      },
    };
  }
  if (entry.kind === "header" && isHeaderIntent(entry.intent)) {
    return {
      ruleId,
      name,
      kind,
      redactSensitiveInLogs,
      intent: sanitizeHeaderIntent(entry.intent, redactSensitiveInLogs),
    };
  }
  if (
    (entry.kind === "request-body" || entry.kind === "response-body") &&
    isBodyIntent(entry.intent)
  ) {
    return {
      ruleId,
      name,
      kind,
      redactSensitiveInLogs,
      intent: {
        mode: truncateLogString(entry.intent.mode),
        rewrite: sanitizeBodyRewriteForLog(
          bodyRewriteFromIntent(entry.intent),
          redactSensitiveInLogs,
        ),
      },
    };
  }
  return {
    ruleId,
    name,
    kind,
    redactSensitiveInLogs,
    intent: sanitizeIntentByShape(entry.intent, redactSensitiveInLogs),
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
    const indexEntry = rawEntryFromOperation(entry.operation);
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

/**
 * Serialize match-index read-modify-write across dynamic DNR wholesale writes
 * and session body-marker merge/drop (avoids wiping body band under concurrency).
 */
let matchIndexWriteTail: Promise<void> = Promise.resolve();

export function withMatchIndexWriteLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = matchIndexWriteTail;
  let release!: () => void;
  matchIndexWriteTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(operation).finally(release);
}

/**
 * Merge body-marker install ids into the durable match index (lockstep with
 * session install order: `bodyMarkerIdForIndex(i)`).
 */
export async function mergeBodyMarkerIndexEntries(
  api: ChromeApi,
  operations: readonly BodyMarkerOperation[],
): Promise<void> {
  await withMatchIndexWriteLock(async () => {
    const current = await readMatchIndexSnapshot(api);
    const next: MatchIndexSnapshot = { ...current };
    for (const [key] of Object.entries(next)) {
      const numeric = Number(key);
      if (isBodyMarkerBandId(numeric)) delete next[key];
    }
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const entry = rawEntryFromOperation(operation);
      if (entry === undefined) continue;
      next[String(bodyMarkerIdForIndex(index))] = entry;
    }
    await writeMatchIndex(api, next);
  });
}

/** Drop all body-band ids from the match index (session stop / start-failure). */
export async function dropBodyMarkerBandFromMatchIndex(
  api: ChromeApi,
): Promise<void> {
  await withMatchIndexWriteLock(async () => {
    const current = await readMatchIndexSnapshot(api);
    const next: MatchIndexSnapshot = {};
    for (const [key, entry] of Object.entries(current)) {
      const numeric = Number(key);
      if (isBodyMarkerBandId(numeric)) continue;
      next[key] = entry;
    }
    await writeMatchIndex(api, next);
  });
}

/** Body-band slice of a snapshot (for wholesale DNR index preserve). */
export function bodyMarkerEntriesFromSnapshot(
  snapshot: MatchIndexSnapshot,
): MatchIndexSnapshot {
  const body: MatchIndexSnapshot = {};
  for (const [key, entry] of Object.entries(snapshot)) {
    const numeric = Number(key);
    if (!isBodyMarkerBandId(numeric)) continue;
    if (entry.kind !== "request-body" && entry.kind !== "response-body") {
      continue;
    }
    body[key] = entry;
  }
  return body;
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

function parseBodyIntent(raw: Record<string, unknown>): BodyIntent | undefined {
  const mode = own(raw, "mode");
  if (typeof mode !== "string") return undefined;
  const rewriteRaw = own(raw, "rewrite");
  // Absent rewrite (legacy §3 mode-only) → empty string; non-string → drop.
  if (rewriteRaw !== undefined && typeof rewriteRaw !== "string") {
    return undefined;
  }
  return {
    mode,
    rewrite: typeof rewriteRaw === "string" ? rewriteRaw : "",
  };
}

function parseStoredEntry(raw: unknown): MatchIndexEntry | undefined {
  const entry = ownRecord(raw);
  if (entry === undefined) return undefined;
  const ruleId = own(entry, "ruleId");
  const nameRaw = own(entry, "name");
  const kind = own(entry, "kind");
  const redactSensitiveInLogs = own(entry, "redactSensitiveInLogs");
  if (typeof ruleId !== "string") return undefined;
  const name = typeof nameRaw === "string" ? nameRaw : "";
  if (
    kind !== "redirect" &&
    kind !== "query" &&
    kind !== "header" &&
    kind !== "request-body" &&
    kind !== "response-body"
  ) {
    return undefined;
  }
  if (typeof redactSensitiveInLogs !== "boolean") return undefined;
  const intentRaw = ownRecord(own(entry, "intent"));
  if (intentRaw === undefined) return undefined;
  let intent: MatchIndexIntent | undefined;
  if (kind === "redirect") intent = parseRedirectIntent(intentRaw);
  else if (kind === "query") intent = parseQueryIntent(intentRaw);
  else if (kind === "header") intent = parseHeaderIntent(intentRaw);
  else intent = parseBodyIntent(intentRaw);
  if (intent === undefined) return undefined;
  return { ruleId, name, kind, redactSensitiveInLogs, intent };
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
