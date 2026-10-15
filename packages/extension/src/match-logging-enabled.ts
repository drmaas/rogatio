import type { ChromeApi, ChromeStorageChangedListener } from "./chrome.js";

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

/** Follow the Match logging toggle. A removed key stays on (the default). */
export function subscribeMatchLoggingEnabled(
  api: ChromeApi,
  listener: (enabled: boolean) => void,
): () => void {
  const onChanged = api.storage.onChanged;
  if (onChanged?.addListener === undefined) return () => {};
  const wrapped: ChromeStorageChangedListener = (changes, areaName) => {
    if (areaName !== "local") return;
    if (!Object.hasOwn(changes, MATCH_LOGGING_ENABLED_KEY)) return;
    const next = changes[MATCH_LOGGING_ENABLED_KEY]?.newValue;
    listener(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: next,
      }),
    );
  };
  onChanged.addListener(wrapped);
  return () => {
    onChanged.removeListener?.(wrapped);
  };
}
