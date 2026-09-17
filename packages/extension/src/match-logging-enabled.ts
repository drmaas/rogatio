import type { ChromeApi } from "./chrome.js";

export const MATCH_LOGGING_ENABLED_KEY = "rogatio.matchLogging.enabled";

function ownRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

/** Missing key defaults on; only boolean `true` enables. */
export function readMatchLoggingEnabledFromStorageResult(
  result: unknown,
): boolean {
  const record = ownRecord(result);
  if (record === undefined) return true;
  if (!Object.hasOwn(record, MATCH_LOGGING_ENABLED_KEY)) return true;
  const enabled = record[MATCH_LOGGING_ENABLED_KEY];
  if (enabled === undefined) return true;
  return enabled === true;
}

export async function readMatchLoggingEnabled(
  api: ChromeApi,
): Promise<boolean> {
  try {
    const result = await api.storage.local.get(MATCH_LOGGING_ENABLED_KEY);
    return readMatchLoggingEnabledFromStorageResult(result);
  } catch {
    return false;
  }
}
