// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeApi, ChromeStorageChangedListener } from "../src/chrome.js";
import {
  buildMatchHistoryRecord,
  MATCH_HISTORY_ENTRIES_KEY,
  type MatchHistoryEntry,
} from "../src/match-history.js";
import {
  bindMatchHistoryFeed,
  createMatchHistoryPanel,
} from "../src/match-history-view.js";
import { MATCH_LOGGING_ENABLED_KEY } from "../src/match-logging-enabled.js";

function row(
  id: string,
  overrides: Partial<MatchHistoryEntry> = {},
): MatchHistoryEntry {
  return {
    id,
    at: Date.UTC(2026, 0, 2, 3, 4, 5),
    ruleId: `rule-${id}`,
    name: `Name ${id}`,
    kind: "header",
    method: "GET",
    resourceType: "script",
    url: `https://example.com/${id}`,
    initiator: "https://app.example/",
    action: "request set X-Custom-Header=configured-value",
    ...overrides,
  };
}

function feedApi(): {
  api: ChromeApi;
  listeners: ChromeStorageChangedListener[];
} {
  const listeners: ChromeStorageChangedListener[] = [];
  const api = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
      onChanged: {
        addListener(listener: ChromeStorageChangedListener) {
          listeners.push(listener);
        },
        removeListener(listener: ChromeStorageChangedListener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    },
  } as unknown as ChromeApi;
  return { api, listeners };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("match history feed", () => {
  it("shows an empty state when logging is off and when nothing has matched", () => {
    const off = createMatchHistoryPanel({
      loggingEnabled: false,
      entries: [row("hidden")],
      onClear: () => {},
    });
    expect(
      off
        .querySelector("[data-match-history-empty]")
        ?.getAttribute("data-match-history-empty"),
    ).toBe("off");
    expect(off.textContent).toContain("Match logging is off");
    expect(off.querySelector("[data-match-history-entry]")).toBeNull();
    expect(
      off.querySelector("[data-match-history-url]")?.textContent,
    ).toBeUndefined();

    const none = createMatchHistoryPanel({
      loggingEnabled: true,
      entries: [],
      onClear: () => {},
    });
    expect(
      none
        .querySelector("[data-match-history-empty]")
        ?.getAttribute("data-match-history-empty"),
    ).toBe("none");
    expect(none.textContent).toContain("No matches yet");
    expect(none.querySelector("[data-match-history-count]")?.textContent).toBe(
      "0 matches",
    );
  });

  it("renders a newest-first feed and a Clear button", () => {
    const onClear = vi.fn();
    const panel = createMatchHistoryPanel({
      loggingEnabled: true,
      entries: [row("older"), row("newer")],
      onClear,
    });
    document.body.append(panel);
    const urls = [...panel.querySelectorAll("[data-match-history-url]")].map(
      (node) => node.textContent,
    );
    expect(urls).toEqual([
      "https://example.com/newer",
      "https://example.com/older",
    ]);
    expect(panel.querySelector("[data-match-history-count]")?.textContent).toBe(
      "2 matches",
    );
    expect(panel.textContent).toContain("rule-newer");
    expect(panel.textContent).toContain(
      "request set X-Custom-Header=configured-value",
    );
    const clear = panel.querySelector("[data-command='clear-match-history']");
    if (!(clear instanceof HTMLButtonElement)) throw new Error("missing Clear");
    expect(clear.textContent).toBe("Clear");
    clear.click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows redacted fields as text", () => {
    const record = buildMatchHistoryRecord(
      {
        ruleId: "redirect-1",
        name: "Redirect",
        kind: "redirect",
        redactSensitiveInLogs: true,
        intent: { destination: "https://user:pass@dest.example/?token=abc" },
      },
      {
        url: "https://user:pass@example.com/path?token=super-secret#frag",
        method: "GET",
        resourceType: "main_frame",
      },
      Date.UTC(2026, 0, 2, 3, 4, 5),
      "id-1",
    );
    if (record === undefined) throw new Error("expected a record");
    const markupUrl = row("markup", {
      url: "<img src=x>",
      action: "",
      initiator: "",
    });
    const panel = createMatchHistoryPanel({
      loggingEnabled: true,
      entries: [record, markupUrl],
      onClear: () => {},
    });
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.textContent).toContain("<img src=x>");
    expect(panel.textContent).not.toContain("user:pass");
    expect(panel.textContent).not.toContain("super-secret");
    expect(panel.textContent).toContain("token=[redacted]");
  });

  it("updates the open feed when session history or the toggle changes", () => {
    const { api, listeners } = feedApi();
    const state: {
      entries: readonly MatchHistoryEntry[];
      loggingEnabled: boolean;
    } = { entries: [], loggingEnabled: true };
    document.body.append(
      createMatchHistoryPanel({
        loggingEnabled: true,
        entries: [],
        onClear: () => {},
      }),
    );
    const unbind = bindMatchHistoryFeed({
      api,
      getHost: () =>
        document.querySelector<HTMLElement>("[data-match-history-root]"),
      getLoggingEnabled: () => state.loggingEnabled,
      setLoggingEnabled: (enabled) => {
        state.loggingEnabled = enabled;
      },
      getEntries: () => state.entries,
      setEntries: (entries) => {
        state.entries = entries;
      },
      onClear: () => {},
    });
    try {
      for (const listener of listeners) {
        listener(
          { [MATCH_HISTORY_ENTRIES_KEY]: { newValue: [row("live")] } },
          "session",
        );
      }
      expect(
        document.querySelectorAll("[data-match-history-entry]"),
      ).toHaveLength(1);
      expect(
        document.querySelector("[data-match-history-url]")?.textContent,
      ).toBe("https://example.com/live");

      for (const listener of listeners) {
        listener({ [MATCH_LOGGING_ENABLED_KEY]: { newValue: false } }, "local");
      }
      expect(
        document
          .querySelector("[data-match-history-empty]")
          ?.getAttribute("data-match-history-empty"),
      ).toBe("off");
      expect(document.querySelector("[data-match-history-entry]")).toBeNull();
      expect(state.loggingEnabled).toBe(false);
    } finally {
      unbind();
    }
  });
});
