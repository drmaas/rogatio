import { describe, expect, it, vi } from "vitest";
import type {
  ChromeApi,
  ChromeRuleMatchedDebugInfo,
  ChromeScripting,
} from "../src/chrome.js";
import {
  MATCH_LOGGING_INDEX_KEY,
  type MatchIndexEntry,
} from "../src/match-index.js";
import {
  injectMatchLogLine,
  MATCH_LOGGING_ENABLED_KEY,
  registerMatchLogListener,
} from "../src/match-listener.js";

const HEADER_DNR_ID = 2_000_001;

function redirectEntry(
  overrides: Partial<MatchIndexEntry> = {},
): MatchIndexEntry {
  return {
    ruleId: "redirect-1",
    name: "Redirect One",
    kind: "redirect",
    redactSensitiveInLogs: false,
    intent: { destination: "https://dest.example/path" },
    ...overrides,
  };
}

function headerEntry(
  overrides: Partial<MatchIndexEntry> = {},
): MatchIndexEntry {
  return {
    ruleId: "header-1",
    name: "Header One",
    kind: "header",
    redactSensitiveInLogs: false,
    intent: {
      direction: "request",
      operation: "set",
      name: "X-Custom-Header",
      value: "test-value",
    },
    ...overrides,
  };
}

function queryEntry(overrides: Partial<MatchIndexEntry> = {}): MatchIndexEntry {
  return {
    ruleId: "query-1",
    name: "Query One",
    kind: "query",
    redactSensitiveInLogs: false,
    intent: {
      params: [
        { name: "a", operation: "set", value: "1" },
        { name: "b", operation: "remove" },
      ],
    },
    ...overrides,
  };
}

function createHarness(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {
    rogatio: { version: 1 },
    ...initial,
  };
  let listener: ((info: ChromeRuleMatchedDebugInfo) => void) | undefined;
  const executeScript = vi.fn<ChromeScripting["executeScript"]>(
    async () => undefined,
  );
  const addListener = vi.fn(
    (next: (info: ChromeRuleMatchedDebugInfo) => void) => {
      listener = next;
    },
  );

  const api = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (key === undefined) return { ...store };
          return { [key]: store[key] };
        },
        set: async (value: Record<string, unknown>) => {
          Object.assign(store, value);
        },
      },
    },
    permissions: {
      contains: async () => false,
      request: async () => true,
      remove: async () => true,
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      onRuleMatchedDebug: { addListener },
    },
    scripting: { executeScript },
  } as unknown as ChromeApi;

  registerMatchLogListener(api);

  async function flushAsyncWork(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return {
    api,
    store,
    executeScript,
    addListener,
    async fireMatch(info: ChromeRuleMatchedDebugInfo) {
      if (listener === undefined) throw new Error("listener not registered");
      listener(info);
      await flushAsyncWork();
    },
  };
}

describe("match log listener", () => {
  it("injects one isolated executeScript per redirect and query match", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        "100": redirectEntry(),
        "200": queryEntry(),
      },
    });

    await fireMatch({
      rule: { ruleId: 100 },
      request: {
        tabId: 42,
        url: "https://example.com/page",
        method: "GET",
        initiator: "https://init.example/",
        type: "main_frame",
      },
    });
    await fireMatch({
      rule: { ruleId: 200 },
      request: {
        tabId: 43,
        url: "https://example.com/other",
        method: "POST",
        initiator: "https://init.example/app",
        type: "xmlhttprequest",
      },
    });

    expect(executeScript).toHaveBeenCalledTimes(2);

    const redirectCall = executeScript.mock.calls[0]?.[0];
    expect(redirectCall?.target).toEqual({ tabId: 42 });
    expect(redirectCall?.world).toBe("ISOLATED");
    expect(
      (redirectCall as { allFrames?: unknown } | undefined)?.allFrames,
    ).toBeUndefined();
    expect(redirectCall?.func).toBe(injectMatchLogLine);
    const redirectLine = redirectCall?.args?.[0];
    expect(typeof redirectLine).toBe("string");
    expect(redirectLine).toContain("https://dest.example/path");
    expect(redirectLine).toContain("GET");
    expect(redirectLine).toContain("main_frame");
    expect(redirectLine).toContain("initiator=https://init.example/");

    const queryCall = executeScript.mock.calls[1]?.[0];
    expect(queryCall?.target).toEqual({ tabId: 43 });
    expect(queryCall?.world).toBe("ISOLATED");
    expect(
      (queryCall as { allFrames?: unknown } | undefined)?.allFrames,
    ).toBeUndefined();
    const queryLine = queryCall?.args?.[0];
    expect(typeof queryLine).toBe("string");
    expect(queryLine).toContain("set a=1");
    expect(queryLine).toContain("remove b");
    expect(queryLine).toContain("POST");
    expect(queryLine).toContain("xmlhttprequest");
    expect(queryLine).toContain("initiator=https://init.example/app");
  });

  it("omits placeholders when method, initiator, and resource type are absent", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });

    await fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 7, url: "https://example.com/page" },
    });

    const line = executeScript.mock.calls[0]?.[0]?.args?.[0] as string;
    expect(line).not.toContain("initiator=");
    expect(line).not.toMatch(/\bGET\b/);
    expect(line).not.toContain("main_frame");
  });

  it("respects redactSensitiveInLogs on the index entry", async () => {
    const sensitive = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        "100": queryEntry({
          redactSensitiveInLogs: true,
          intent: {
            params: [
              { name: "access_token", operation: "set", value: "plain-secret" },
            ],
          },
        }),
      },
    });
    await sensitive.fireMatch({
      rule: { ruleId: 100 },
      request: {
        tabId: 1,
        url: "https://example.com/?access_token=live-secret",
      },
    });
    const sensitiveLine = sensitive.executeScript.mock.calls[0]?.[0]
      ?.args?.[0] as string;
    expect(sensitiveLine).toContain("[redacted]");
    expect(sensitiveLine).not.toContain("plain-secret");
    expect(sensitiveLine).not.toContain("live-secret");

    const plain = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        "100": queryEntry({
          redactSensitiveInLogs: false,
          intent: {
            params: [
              { name: "access_token", operation: "set", value: "plain-secret" },
            ],
          },
        }),
      },
    });
    await plain.fireMatch({
      rule: { ruleId: 100 },
      request: {
        tabId: 1,
        url: "https://example.com/?access_token=live-secret",
      },
    });
    const plainLine = plain.executeScript.mock.calls[0]?.[0]
      ?.args?.[0] as string;
    expect(plainLine).toContain("access_token=plain-secret");
    expect(plainLine).toContain("access_token=live-secret");
    expect(plainLine).not.toContain("[redacted]");
  });

  it("ignores extra body fields on the index entry", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        "100": {
          ...redirectEntry(),
          body: "BODY-SENTINEL-IGNORED",
        },
      },
    });

    await fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 3, url: "https://example.com/" },
    });

    const line = executeScript.mock.calls[0]?.[0]?.args?.[0] as string;
    expect(line).not.toContain("BODY-SENTINEL-IGNORED");
    expect(line).not.toMatch(/\bbody\b/i);
  });

  it("does not dedupe consecutive matches", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    const event = {
      rule: { ruleId: 100 },
      request: { tabId: 5, url: "https://example.com/" },
    };
    await fireMatch(event);
    await fireMatch(event);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("honors the enabled toggle with default on", async () => {
    const off = createHarness({
      [MATCH_LOGGING_ENABLED_KEY]: false,
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    await off.fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 1, url: "https://example.com/" },
    });
    expect(off.executeScript).not.toHaveBeenCalled();

    const garbageString = createHarness({
      [MATCH_LOGGING_ENABLED_KEY]: "true",
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    await garbageString.fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 1, url: "https://example.com/" },
    });
    expect(garbageString.executeScript).not.toHaveBeenCalled();

    const garbageNumber = createHarness({
      [MATCH_LOGGING_ENABLED_KEY]: 1,
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    await garbageNumber.fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 1, url: "https://example.com/" },
    });
    expect(garbageNumber.executeScript).not.toHaveBeenCalled();

    const missing = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    await missing.fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 1, url: "https://example.com/" },
    });
    expect(missing.executeScript).toHaveBeenCalledTimes(1);
  });

  it("no-ops for tabId -1, unknown id, malformed index entry, and unindexed header id", async () => {
    const harness = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        "100": redirectEntry(),
        "200": {
          ruleId: "bad",
          kind: "redirect",
          redactSensitiveInLogs: "yes",
          intent: { destination: "https://dest.example/" },
        },
      },
    });

    await expect(
      harness.fireMatch({
        rule: { ruleId: 100 },
        request: { tabId: -1, url: "https://example.com/" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      harness.fireMatch({
        rule: { ruleId: 999 },
        request: { tabId: 1, url: "https://example.com/" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      harness.fireMatch({
        rule: { ruleId: 200 },
        request: { tabId: 1, url: "https://example.com/" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      harness.fireMatch({
        rule: { ruleId: HEADER_DNR_ID },
        request: { tabId: 1, url: "https://example.com/" },
      }),
    ).resolves.toBeUndefined();
    expect(harness.executeScript).not.toHaveBeenCalled();
  });

  it("injects header intent fields for indexed header id 2_000_001", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(HEADER_DNR_ID)]: headerEntry(),
      },
    });
    await fireMatch({
      rule: { ruleId: HEADER_DNR_ID },
      request: {
        tabId: 1,
        url: "https://example.com/api",
        method: "GET",
        type: "xmlhttprequest",
      },
    });
    const line = executeScript.mock.calls[0]?.[0]?.args?.[0] as string;
    expect(line).toContain("request set X-Custom-Header=test-value");
    expect(line).toContain("header-1");
  });

  it("redacts deny-listed header values only when sensitive is true", async () => {
    const sensitive = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(HEADER_DNR_ID)]: headerEntry({
          redactSensitiveInLogs: true,
          intent: {
            direction: "request",
            operation: "set",
            name: "cookie",
            value: "session=secret",
          },
        }),
      },
    });
    await sensitive.fireMatch({
      rule: { ruleId: HEADER_DNR_ID },
      request: { tabId: 1, url: "https://example.com/" },
    });
    const sensitiveLine = sensitive.executeScript.mock.calls[0]?.[0]
      ?.args?.[0] as string;
    expect(sensitiveLine).toContain("cookie=[redacted]");

    const plain = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(HEADER_DNR_ID)]: headerEntry({
          redactSensitiveInLogs: false,
          intent: {
            direction: "request",
            operation: "set",
            name: "cookie",
            value: "c".repeat(250),
          },
        }),
      },
    });
    await plain.fireMatch({
      rule: { ruleId: HEADER_DNR_ID },
      request: { tabId: 1, url: "https://example.com/" },
    });
    const plainLine = plain.executeScript.mock.calls[0]?.[0]
      ?.args?.[0] as string;
    expect(plainLine).toContain("cookie=");
    expect(plainLine).not.toContain("[redacted]");
    expect(plainLine.length).toBeLessThanOrEqual(500);
  });

  it("swallows executeScript rejections without retrying", async () => {
    const { executeScript, fireMatch } = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    executeScript.mockRejectedValueOnce(new Error("injection failed"));
    await expect(
      fireMatch({
        rule: { ruleId: 100 },
        request: { tabId: 2, url: "https://example.com/" },
      }),
    ).resolves.toBeUndefined();
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when onRuleMatchedDebug is absent", () => {
    const addListener = vi.fn();
    const api = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
      permissions: {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules: async () => {},
      },
      scripting: {
        executeScript: vi.fn(async () => undefined),
      },
    } as unknown as ChromeApi;

    expect(() => registerMatchLogListener(api)).not.toThrow();
    expect(addListener).not.toHaveBeenCalled();
  });

  it("does not inject when scripting is absent even if a listener could fire", async () => {
    let listener: ((info: ChromeRuleMatchedDebugInfo) => void) | undefined;
    const addListener = vi.fn(
      (next: (info: ChromeRuleMatchedDebugInfo) => void) => {
        listener = next;
      },
    );
    const api = {
      storage: {
        local: {
          get: async (key?: string) => {
            if (key === MATCH_LOGGING_INDEX_KEY) {
              return { [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() } };
            }
            return {};
          },
          set: async () => {},
        },
      },
      permissions: {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules: async () => {},
        onRuleMatchedDebug: { addListener },
      },
    } as unknown as ChromeApi;

    expect(() => registerMatchLogListener(api)).not.toThrow();
    expect(addListener).not.toHaveBeenCalled();
    expect(listener).toBeUndefined();
  });

  it("does not mutate storage keys or persist event URLs after a match", async () => {
    const indexSnapshot = {
      "100": redirectEntry(),
    };
    const { store, fireMatch } = createHarness({
      rogatio: { version: 1, projects: [] },
      [MATCH_LOGGING_INDEX_KEY]: indexSnapshot,
    });

    await fireMatch({
      rule: { ruleId: 100 },
      request: {
        tabId: 9,
        url: "https://example.com/secret-event-url",
      },
    });

    expect(Object.keys(store).sort()).toEqual([
      "rogatio",
      MATCH_LOGGING_INDEX_KEY,
    ]);
    expect(JSON.stringify(store[MATCH_LOGGING_INDEX_KEY])).not.toContain(
      "secret-event-url",
    );
    expect(store[MATCH_LOGGING_INDEX_KEY]).toEqual(indexSnapshot);
  });

  it("ignores an inherited toggle key and a malformed event payload", async () => {
    const inherited = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    const poisoned = Object.create({
      [MATCH_LOGGING_ENABLED_KEY]: false,
    }) as Record<string, unknown>;
    inherited.api.storage.local.get = async (key?: string) => {
      if (key === MATCH_LOGGING_ENABLED_KEY) return poisoned;
      return { [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() } };
    };
    await inherited.fireMatch({
      rule: { ruleId: 100 },
      request: { tabId: 4, url: "https://example.com/" },
    });
    expect(inherited.executeScript).toHaveBeenCalledTimes(1);

    const malformed = createHarness({
      [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() },
    });
    await expect(
      malformed.fireMatch({
        rule: { ruleId: 100 },
      } as ChromeRuleMatchedDebugInfo),
    ).resolves.toBeUndefined();
    expect(malformed.executeScript).not.toHaveBeenCalled();
  });

  it("calls the chrome event and scripting APIs with their own receivers", async () => {
    // Chrome's real event and scripting objects throw `Illegal invocation`
    // when their methods are detached from the receiver.
    let listener: ((info: ChromeRuleMatchedDebugInfo) => void) | undefined;
    const matchedEvent = {
      receiverMarker: true,
      addListener(
        this: { receiverMarker?: boolean } | undefined,
        next: (info: ChromeRuleMatchedDebugInfo) => void,
      ): void {
        if (this?.receiverMarker !== true) {
          throw new TypeError("Illegal invocation");
        }
        listener = next;
      },
    };
    const injected: unknown[] = [];
    const scripting = {
      receiverMarker: true,
      async executeScript(
        this: { receiverMarker?: boolean } | undefined,
        details: { args?: unknown[] },
      ): Promise<unknown> {
        if (this?.receiverMarker !== true) {
          throw new TypeError("Illegal invocation");
        }
        injected.push(details.args?.[0]);
        return undefined;
      },
    };

    const api = {
      storage: {
        local: {
          get: async (key?: string) => {
            if (key === MATCH_LOGGING_INDEX_KEY) {
              return { [MATCH_LOGGING_INDEX_KEY]: { "100": redirectEntry() } };
            }
            return {};
          },
          set: async () => {},
        },
      },
      permissions: {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules: async () => {},
        onRuleMatchedDebug: matchedEvent,
      },
      scripting,
    } as unknown as ChromeApi;

    expect(() => registerMatchLogListener(api)).not.toThrow();
    expect(listener).toBeDefined();

    listener?.({
      rule: { ruleId: 100 },
      request: { tabId: 11, url: "https://example.com/" },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(injected).toHaveLength(1);
    expect(String(injected[0])).toContain("https://dest.example/path");
  });

  it("logs through the injected func with a fixed %s format", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const line = "line with %s and %c markers";
    injectMatchLogLine(line);
    expect(log).toHaveBeenCalledWith("%s", line);
    log.mockRestore();
  });
});
