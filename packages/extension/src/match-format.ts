import type { MatchIndexEntry } from "./match-index.js";
import {
  redactUrl,
  sanitizeHeaderLogValue,
  sanitizeQueryTransformValue,
  truncateLogString,
} from "./match-log-redaction.js";

const PREFIX = "\x1B[1;34m[rogatio]\x1B[m";
const DIM = "\x1B[2m";
const RESET = "\x1B[m";

export interface MatchFormatEvent {
  readonly url?: string;
  readonly method?: string;
  readonly initiator?: string;
  readonly resourceType?: string;
}

// The index lives in extension-writable storage: read every entry field
// defensively and re-bound it here instead of trusting the write path.
function readProperty(source: unknown, key: string): unknown {
  if (source === null || typeof source !== "object") return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readString(source: unknown, key: string): string | undefined {
  const value = readProperty(source, key);
  return typeof value === "string" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function logString(value: string | undefined): string {
  return value === undefined ? "" : truncateLogString(value);
}

function logUrl(value: string | undefined, redactSensitive: boolean): string {
  return value === undefined ? "" : redactUrl(value, { redactSensitive });
}

function nonEmpty(value: string): boolean {
  return value.length > 0;
}

function formatRedirectAction(
  intent: unknown,
  redactSensitive: boolean,
): string {
  const destination = logUrl(
    readString(intent, "destination"),
    redactSensitive,
  );
  return nonEmpty(destination) ? `→ ${destination}` : "";
}

function formatQueryAction(intent: unknown, redactSensitive: boolean): string {
  const params = readProperty(intent, "params");
  if (!Array.isArray(params)) return "";
  const parts: string[] = [];
  for (const param of params) {
    const rawName = readString(param, "name");
    if (rawName === undefined) continue;
    const name = truncateLogString(rawName);
    const rawValue = readString(param, "value");
    if (readString(param, "operation") === "remove" || rawValue === undefined) {
      parts.push(`remove ${name}`);
      continue;
    }
    const value = sanitizeQueryTransformValue(
      rawName,
      rawValue,
      redactSensitive,
    );
    parts.push(`set ${name}=${value}`);
  }
  return parts.join(" ");
}

function formatHeaderAction(intent: unknown, redactSensitive: boolean): string {
  const rawName = readString(intent, "name");
  if (rawName === undefined) return "";
  const direction = logString(readString(intent, "direction"));
  const operation = logString(readString(intent, "operation"));
  const name = truncateLogString(rawName);
  const rawValue = readString(intent, "value");
  const target =
    rawValue === undefined
      ? name
      : `${name}=${sanitizeHeaderLogValue(rawName, rawValue, redactSensitive)}`;
  return [direction, operation, target].filter(nonEmpty).join(" ");
}

function formatIntendedAction(
  entry: MatchIndexEntry,
  redactSensitive: boolean,
): string {
  const intent = readProperty(entry, "intent");
  const kind = readString(entry, "kind");
  if (kind === "redirect") return formatRedirectAction(intent, redactSensitive);
  if (kind === "query") return formatQueryAction(intent, redactSensitive);
  if (kind === "header") return formatHeaderAction(intent, redactSensitive);
  return "";
}

export function formatMatchRecord(
  event: MatchFormatEvent,
  entry: MatchIndexEntry,
): string {
  const redactSensitive = readProperty(entry, "redactSensitiveInLogs") === true;

  const method = logString(optionalString(event.method));
  const resourceType = logString(optionalString(event.resourceType));
  const requestUrl = logUrl(optionalString(event.url), redactSensitive);

  const ruleId = logString(readString(entry, "ruleId"));
  const displayName = logString(readString(entry, "name"));
  const kind = logString(readString(entry, "kind"));
  const action = formatIntendedAction(entry, redactSensitive);
  const initiatorUrl = logUrl(optionalString(event.initiator), redactSensitive);
  const initiator = nonEmpty(initiatorUrl) ? `initiator=${initiatorUrl}` : "";

  const live = ["matched", method, resourceType, requestUrl]
    .filter(nonEmpty)
    .join(" ");
  const detail = [ruleId, displayName, kind, action, initiator]
    .filter(nonEmpty)
    .join(" ");

  if (!nonEmpty(detail)) return `${PREFIX} ${live}`;
  return `${PREFIX} ${live} ${DIM}${detail}${RESET}`;
}
