import type { ChromeApi } from "./chrome.js";
import { MATCH_LOGGING_ENABLED_KEY } from "./match-logging-enabled.js";

/** Accessible name shared by the popup and the management sidebar. */
export const MATCH_LOGGING_LABEL = "Match logging";

/**
 * Labelled checkbox for the console match-logging flag. Both surfaces build the
 * control here so the accessible name, storage key, and failure behaviour stay
 * identical. Persistence is the only side effect; no protocol command is sent.
 */
export function createMatchLoggingToggle(options: {
  readonly api: ChromeApi;
  readonly enabled: boolean;
  readonly onPersisted: (enabled: boolean) => void;
}): HTMLLabelElement {
  const label = document.createElement("label");
  label.dataset.matchLoggingToggle = "true";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = options.enabled;
  input.addEventListener("change", () => {
    void (async () => {
      const next = input.checked;
      try {
        await options.api.storage.local.set({
          [MATCH_LOGGING_ENABLED_KEY]: next,
        });
      } catch {
        // The stored value is what the listener reads, so a failed write must
        // not leave the control claiming a state that was never persisted.
        input.checked = !next;
        return;
      }
      options.onPersisted(next);
    })();
  });
  label.append(input, document.createTextNode(` ${MATCH_LOGGING_LABEL}`));
  return label;
}
