import type { ChromeApi, ChromeStorageChangedListener } from "./chrome.js";
import { formatMatchAction } from "./match-format.js";
import type { MatchIndexEntry } from "./match-index.js";
import { registerMatchAppendConsumer } from "./match-listener.js";
import {
  LOG_STRING_MAX,
  redactUrl,
  truncateLogString,
} from "./match-log-redaction.js";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabled,
  readMatchLoggingEnabledFromStorageResult,
} from "./match-logging-enabled.js";

/** Session-only ring of redacted match records. Not part of the project envelope. */
export const MATCH_HISTORY_ENTRIES_KEY = "rogatio.matchHistory.entries";

export const MATCH_HISTORY_CAP = 100;

export const CLEAR_MATCH_HISTORY_COMMAND = "clear-match-history";

const MATCH_HISTORY_KINDS = Object.freeze([
  "redirect",
  "query",
  "header",
  "request-body",
  "response-body",
  "mock",
] as const);

export interface MatchHistoryEntry {
  readonly id: string;
  readonly at: number;
  readonly ruleId: string;
  readonly name: string;
  readonly kind: string;
  readonly method: string;
  readonly resourceType: string;
  readonly url: string;
  readonly initiator: string;
  readonly action: string;
}

export interface MatchHistoryLiveFields {
  readonly url?: string;
  readonly method?: string;
  readonly initiator?: string;
  readonly resourceType?: string;
}

const STRING_FIELDS = Object.freeze([
  "id",
  "ruleId",
  "name",
  "kind",
  "method",
  "resourceType",
  "url",
  "initiator",
  "action",
] as const);

let historySequence = 0;
let writeChain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Resolves when queued session writes have finished. */
export function whenMatchHistoryIdle(): Promise<void> {
  return writeChain;
}

function nextHistoryId(at: number): string {
  historySequence += 1;
  if (historySequence > 1_000_000_000) historySequence = 1;
  return `${Math.trunc(at).toString(36)}-${historySequence.toString(36)}`;
}

function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (!Object.hasOwn(value, key)) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function ownString(value: unknown, key: string): string | undefined {
  const raw = ownValue(value, key);
  return typeof raw === "string" ? raw : undefined;
}

function isHistoryKind(kind: string): boolean {
  return (MATCH_HISTORY_KINDS as readonly string[]).includes(kind);
}

function boundField(value: string): string {
  return truncateLogString(value);
}

function sanitizeStoredEntry(raw: unknown): MatchHistoryEntry | undefined {
  try {
    const at = ownValue(raw, "at");
    if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
    const fields: Record<string, string> = {};
    for (const key of STRING_FIELDS) {
      const text = ownString(raw, key);
      if (text === undefined) return undefined;
      if (key === "kind") {
        if (!isHistoryKind(text) || text.length > LOG_STRING_MAX)
          return undefined;
        fields[key] = text;
        continue;
      }
      if (key === "url" || key === "initiator") {
        fields[key] = redactUrl(text, { redactSensitive: false });
        continue;
      }
      fields[key] = boundField(text);
    }
    if (fields.id === undefined || fields.id.length === 0) return undefined;
    return {
      id: fields.id,
      at,
      ruleId: fields.ruleId ?? "",
      name: fields.name ?? "",
      kind: fields.kind ?? "",
      method: fields.method ?? "",
      resourceType: fields.resourceType ?? "",
      url: fields.url ?? "",
      initiator: fields.initiator ?? "",
      action: fields.action ?? "",
    };
  } catch {
    return undefined;
  }
}

/**
 * Read a session value or a raw array. Drops malformed rows and keeps the
 * newest `MATCH_HISTORY_CAP` rows. Hostile input becomes an empty list.
 */
export function parseMatchHistoryEntries(raw: unknown): MatchHistoryEntry[] {
  try {
    let value = raw;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (Object.hasOwn(value, MATCH_HISTORY_ENTRIES_KEY)) {
        value = ownValue(value, MATCH_HISTORY_ENTRIES_KEY);
      }
    }
    if (!Array.isArray(value)) return [];
    const entries: MatchHistoryEntry[] = [];
    for (const item of value) {
      const parsed = sanitizeStoredEntry(item);
      if (parsed) entries.push(parsed);
    }
    if (entries.length <= MATCH_HISTORY_CAP) return entries;
    return entries.slice(entries.length - MATCH_HISTORY_CAP);
  } catch {
    return [];
  }
}

/**
 * Append one redacted row and drop the oldest rows past the cap.
 * Invalid stored rows are dropped. A row that fails validation is ignored.
 */
export function appendMatchHistory(
  entries: readonly MatchHistoryEntry[],
  next: MatchHistoryEntry,
): MatchHistoryEntry[] {
  try {
    const valid = parseMatchHistoryEntries(entries);
    const parsedNext = sanitizeStoredEntry(next);
    if (parsedNext === undefined) return valid;
    const combined = [...valid, parsedNext];
    if (combined.length <= MATCH_HISTORY_CAP) return combined;
    return combined.slice(combined.length - MATCH_HISTORY_CAP);
  } catch {
    return [];
  }
}

function liveText(value: unknown): string {
  return typeof value === "string" ? truncateLogString(value) : "";
}

function liveUrl(value: unknown, redactSensitive: boolean): string {
  return typeof value === "string" ? redactUrl(value, { redactSensitive }) : "";
}

/**
 * Build one history row from the same fields the console line uses.
 * Returns undefined when the entry is not a logged rule kind or a field throws.
 * Live request bodies and wire header values are not read.
 */
export function buildMatchHistoryRecord(
  entry: MatchIndexEntry,
  live: MatchHistoryLiveFields,
  at: number,
  id: string,
): MatchHistoryEntry | undefined {
  try {
    if (!Number.isFinite(at)) return undefined;
    if (typeof id !== "string" || id.length === 0) return undefined;
    const kind = ownString(entry, "kind");
    if (kind === undefined || !isHistoryKind(kind)) return undefined;
    const redactSensitive = ownValue(entry, "redactSensitiveInLogs") === true;
    const ruleId = boundField(ownString(entry, "ruleId") ?? "");
    const name = boundField(ownString(entry, "name") ?? "");
    const action = truncateLogString(formatMatchAction(entry));
    return sanitizeStoredEntry({
      id: truncateLogString(id),
      at,
      ruleId,
      name,
      kind,
      method: liveText(ownValue(live, "method")),
      resourceType: liveText(ownValue(live, "resourceType")),
      url: liveUrl(ownValue(live, "url"), redactSensitive),
      initiator: liveUrl(ownValue(live, "initiator"), redactSensitive),
      action,
    });
  } catch {
    return undefined;
  }
}

export async function readMatchHistory(
  api: ChromeApi,
): Promise<MatchHistoryEntry[]> {
  const session = api.storage.session;
  if (session === undefined) return [];
  try {
    const result = await session.get(MATCH_HISTORY_ENTRIES_KEY);
    return parseMatchHistoryEntries(result);
  } catch {
    return [];
  }
}

/** Empty the session ring. No-op when session storage is missing. */
function clearMatchHistory(api: ChromeApi): Promise<void> {
  return enqueue(async () => {
    const session = api.storage.session;
    if (session === undefined) return;
    await session.set({ [MATCH_HISTORY_ENTRIES_KEY]: [] });
  });
}

/**
 * Append one match on the service-worker write chain.
 * Skips the write when Match logging is off, including a toggle that lands
 * while this append is in flight.
 */
export function recordMatchHistory(
  api: ChromeApi,
  entry: MatchIndexEntry,
  live: MatchHistoryLiveFields,
  now: number = Date.now(),
): Promise<void> {
  return enqueue(async () => {
    if (!(await readMatchLoggingEnabled(api))) return;
    const session = api.storage.session;
    if (session === undefined) return;
    const record = buildMatchHistoryRecord(
      entry,
      live,
      now,
      nextHistoryId(now),
    );
    if (record === undefined) return;
    if (!(await readMatchLoggingEnabled(api))) return;
    const current = await readMatchHistory(api);
    if (!(await readMatchLoggingEnabled(api))) return;
    await session.set({
      [MATCH_HISTORY_ENTRIES_KEY]: appendMatchHistory(current, record),
    });
    if (!(await readMatchLoggingEnabled(api))) {
      await session.set({ [MATCH_HISTORY_ENTRIES_KEY]: [] });
    }
  });
}

export function isClearMatchHistoryMessage(message: unknown): boolean {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    return false;
  }
  if (
    !Object.hasOwn(message, "version") ||
    !Object.hasOwn(message, "command")
  ) {
    return false;
  }
  try {
    const record = message as Record<string, unknown>;
    return (
      record.version === 1 && record.command === CLEAR_MATCH_HISTORY_COMMAND
    );
  } catch {
    return false;
  }
}

/**
 * Service-worker message for the Clear button. Returns true when this module
 * owns the response. Other messages stay with the project protocol.
 */
export function handleMatchHistoryMessage(
  api: ChromeApi,
  message: unknown,
  sendResponse: (response: unknown) => void,
): boolean {
  if (!isClearMatchHistoryMessage(message)) return false;
  void clearMatchHistory(api).then(
    () => {
      sendResponse({ ok: true });
    },
    () => {
      sendResponse({ ok: false });
    },
  );
  return true;
}

function liveFromAppend(live: {
  readonly url?: string;
  readonly method?: string;
  readonly initiator?: string;
  readonly resourceType?: string;
}): MatchHistoryLiveFields {
  return {
    ...(typeof live.url === "string" ? { url: live.url } : {}),
    ...(typeof live.method === "string" ? { method: live.method } : {}),
    ...(typeof live.initiator === "string"
      ? { initiator: live.initiator }
      : {}),
    ...(typeof live.resourceType === "string"
      ? { resourceType: live.resourceType }
      : {}),
  };
}

/**
 * Subscribe the session ring to the console match pipeline and clear it when
 * Match logging is turned off. The service worker is the only writer.
 */
export function registerMatchHistory(api: ChromeApi): () => void {
  const unregister = registerMatchAppendConsumer((entry, live) => {
    void recordMatchHistory(api, entry, liveFromAppend(live)).catch(() => {});
  });

  const onChanged = api.storage.onChanged;
  let listener: ChromeStorageChangedListener | undefined;
  if (onChanged?.addListener !== undefined) {
    listener = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!Object.hasOwn(changes, MATCH_LOGGING_ENABLED_KEY)) return;
      const next = changes[MATCH_LOGGING_ENABLED_KEY]?.newValue;
      if (next === true || next === undefined) return;
      void clearMatchHistory(api).catch(() => {});
    };
    onChanged.addListener(listener);
  }

  void (async () => {
    try {
      const result = await api.storage.local.get(MATCH_LOGGING_ENABLED_KEY);
      if (!readMatchLoggingEnabledFromStorageResult(result)) {
        await clearMatchHistory(api);
      }
    } catch {
      // A failed toggle read must not wipe session history.
    }
  })();

  return () => {
    unregister();
    if (listener !== undefined) onChanged?.removeListener?.(listener);
  };
}

export function subscribeMatchHistory(
  api: ChromeApi,
  listener: (entries: readonly MatchHistoryEntry[]) => void,
): () => void {
  const onChanged = api.storage.onChanged;
  if (onChanged?.addListener === undefined) return () => {};
  const wrapped: ChromeStorageChangedListener = (changes, areaName) => {
    if (areaName !== "session") return;
    if (!Object.hasOwn(changes, MATCH_HISTORY_ENTRIES_KEY)) return;
    listener(
      parseMatchHistoryEntries(changes[MATCH_HISTORY_ENTRIES_KEY]?.newValue),
    );
  };
  onChanged.addListener(wrapped);
  return () => {
    onChanged.removeListener?.(wrapped);
  };
}
