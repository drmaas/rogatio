import type {
  ChromeApi,
  ChromeRuleMatchedDebugInfo,
  ChromeScripting,
} from "./chrome.js";
import { formatMatchRecord } from "./match-format.js";
import { lookupMatchIndexEntry } from "./match-index.js";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabled,
} from "./match-logging-enabled.js";

export { MATCH_LOGGING_ENABLED_KEY };

/** Delays after the first failed main_frame inject (navigation race). */
export const MAIN_FRAME_INJECT_RETRY_DELAYS_MS = [50, 150, 350] as const;

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

    const line = formatMatchRecord(
      {
        url: request.url,
        method: request.method,
        initiator: request.initiator,
        resourceType: request.type,
      },
      entry,
    );

    const scripting = api.scripting;
    if (scripting === undefined) return;

    await injectMatchLog(scripting, tabId, line, request.type);
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
