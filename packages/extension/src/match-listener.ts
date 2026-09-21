import type {
  ChromeApi,
  ChromeRuleMatchedDebugInfo,
  ChromeScripting,
} from "./chrome.js";
import { formatMatchRecord } from "./match-format.js";
import { lookupMatchIndexEntry, type MatchIndexEntry } from "./match-index.js";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabled,
} from "./match-logging-enabled.js";

export { MATCH_LOGGING_ENABLED_KEY };

/** Delays after the first failed main_frame inject (navigation race). */
export const MAIN_FRAME_INJECT_RETRY_DELAYS_MS = [50, 150, 350] as const;

/** Live request fields passed to the post-lookup append seam. */
export interface MatchAppendLiveFields {
  readonly tabId: number;
  readonly url?: string;
  readonly method?: string;
  readonly initiator?: string;
  readonly resourceType?: string;
}

/**
 * In-process post-lookup side-notify consumer (#204 history later).
 * Sync only — async console inject stays a separate hard-wired path so a
 * bad/slow side consumer cannot own delivery. Product path today: inject only;
 * no history store/UI registers here.
 */
export type MatchAppendConsumer = (
  entry: MatchIndexEntry,
  live: MatchAppendLiveFields,
) => void;

const matchAppendConsumers: MatchAppendConsumer[] = [];

/**
 * Register an in-process append-seam consumer. Returns an unregister
 * function. Consumers must not throw across the service-worker boundary;
 * throws are swallowed fail-closed.
 */
export function registerMatchAppendConsumer(
  consumer: MatchAppendConsumer,
): () => void {
  matchAppendConsumers.push(consumer);
  return () => {
    const index = matchAppendConsumers.indexOf(consumer);
    if (index >= 0) matchAppendConsumers.splice(index, 1);
  };
}

function notifyMatchAppend(
  entry: MatchIndexEntry,
  live: MatchAppendLiveFields,
): void {
  for (const consumer of matchAppendConsumers) {
    try {
      consumer(entry, live);
    } catch {
      // Fail closed: a bad consumer must not break inject or the SW.
    }
  }
}

/** Closure-free injected func: all content arrives through serializable args. */
export function injectMatchLogLine(line: string): void {
  console.log("%s", line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function tryInjectMatchLog(
  scripting: ChromeScripting,
  tabId: number,
  line: string,
): Promise<boolean> {
  try {
    // Called as a method: Chrome rejects a detached `executeScript` reference.
    await scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: injectMatchLogLine as (...args: unknown[]) => void,
      args: [line],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Emit one match line into the tab console. Redirect/query (and other
 * main_frame) matches often reject the first inject while the document
 * navigates; retry briefly before fail-closed silence. Non-main_frame stays
 * single-shot.
 */
async function injectMatchLog(
  scripting: ChromeScripting,
  tabId: number,
  line: string,
  resourceType: string | undefined,
): Promise<void> {
  if (await tryInjectMatchLog(scripting, tabId, line)) return;
  if (resourceType !== "main_frame") return;

  for (const delayMs of MAIN_FRAME_INJECT_RETRY_DELAYS_MS) {
    await sleep(delayMs);
    if (await tryInjectMatchLog(scripting, tabId, line)) return;
  }
}

/**
 * Product match-log path: format + console inject. Runs after side-notify;
 * not registered via `registerMatchAppendConsumer` (async + sole delivery).
 */
async function consoleInjectMatch(
  api: ChromeApi,
  entry: MatchIndexEntry,
  live: MatchAppendLiveFields,
): Promise<void> {
  const line = formatMatchRecord(
    {
      url: live.url,
      method: live.method,
      initiator: live.initiator,
      resourceType: live.resourceType,
    },
    entry,
  );

  const scripting = api.scripting;
  if (scripting === undefined) return;

  await injectMatchLog(scripting, live.tabId, line, live.resourceType);
}

export async function handleRuleMatchedDebug(
  api: ChromeApi,
  info: ChromeRuleMatchedDebugInfo,
): Promise<void> {
  try {
    if (!(await readMatchLoggingEnabled(api))) return;

    const request = info.request;
    if (request === null || typeof request !== "object") return;

    const tabId = request.tabId;
    if (typeof tabId !== "number" || tabId === -1) return;

    const entry = await lookupMatchIndexEntry(api, info.rule.ruleId);
    if (entry === undefined) return;

    const live: MatchAppendLiveFields = {
      tabId,
      ...(typeof request.url === "string" ? { url: request.url } : {}),
      ...(typeof request.method === "string" ? { method: request.method } : {}),
      ...(typeof request.initiator === "string"
        ? { initiator: request.initiator }
        : {}),
      ...(typeof request.type === "string"
        ? { resourceType: request.type }
        : {}),
    };

    // Post-lookup append seam: notify in-process consumers, then console-inject.
    notifyMatchAppend(entry, live);
    await consoleInjectMatch(api, entry, live);
  } catch {
    // Fail closed: malformed event payloads or unexpected throws stay silent.
  }
}

export function registerMatchLogListener(api: ChromeApi): void {
  const event = api.declarativeNetRequest?.onRuleMatchedDebug;
  if (event === undefined || typeof event.addListener !== "function") return;
  if (typeof api.scripting?.executeScript !== "function") return;

  try {
    // Chrome event objects require their own receiver; a detached
    // `addListener` throws `Illegal invocation` and would abort worker startup.
    event.addListener((info) => {
      // Fail closed: a malformed event payload must not surface as an
      // unhandled rejection in the service worker.
      handleRuleMatchedDebug(api, info).catch(() => {});
    });
  } catch {
    // Fail closed: registration failure must not break the service worker.
  }
}
