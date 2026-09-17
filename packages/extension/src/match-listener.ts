import type { ChromeApi, ChromeRuleMatchedDebugInfo } from "./chrome.js";
import { formatMatchRecord } from "./match-format.js";
import { lookupMatchIndexEntry } from "./match-index.js";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabled,
} from "./match-logging-enabled.js";

export { MATCH_LOGGING_ENABLED_KEY };

/** Closure-free injected func: all content arrives through serializable args. */
export function injectMatchLogLine(line: string): void {
  console.log("%s", line);
}

async function handleRuleMatchedDebug(
  api: ChromeApi,
  info: ChromeRuleMatchedDebugInfo,
): Promise<void> {
  if (!(await readMatchLoggingEnabled(api))) return;

  const tabId = info.request.tabId;
  if (tabId === -1) return;

  const entry = await lookupMatchIndexEntry(api, info.rule.ruleId);
  if (entry === undefined) return;

  const line = formatMatchRecord(
    {
      url: info.request.url,
      method: info.request.method,
      initiator: info.request.initiator,
      resourceType: info.request.type,
    },
    entry,
  );

  const scripting = api.scripting;
  if (scripting === undefined) return;

  try {
    // Called as a method: Chrome rejects a detached `executeScript` reference.
    await scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: injectMatchLogLine as (...args: unknown[]) => void,
      args: [line],
    });
  } catch {
    // Fail closed: injection rejection is a silent no-op.
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
