// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChromeApi, ChromeStorageChangedListener } from "../src/chrome.js";
import {
  appendMatchHistory,
  buildMatchHistoryRecord,
  CLEAR_MATCH_HISTORY_COMMAND,
  handleMatchHistoryMessage,
  isClearMatchHistoryMessage,
  MATCH_HISTORY_CAP,
  MATCH_HISTORY_ENTRIES_KEY,
  type MatchHistoryEntry,
  parseMatchHistoryEntries,
  readMatchHistory,
  recordMatchHistory,
  registerMatchHistory,
  whenMatchHistoryIdle,
} from "../src/match-history.js";
import {
  MATCH_LOGGING_INDEX_KEY,
  type MatchIndexEntry,
} from "../src/match-index.js";
import {
  handleRuleMatchedDebug,
  MATCH_LOGGING_ENABLED_KEY,
  registerMatchLogListener,
} from "../src/match-listener.js";
import { createMatchLoggingToggle } from "../src/match-logging-toggle.js";
import { MOCK_GUARD_ID } from "../src/mock-redirect-ids.js";

const HEADER_DNR_ID = 2_000_001;

function row(
  id: string,
  overrides: Partial<MatchHistoryEntry> = {},
): MatchHistoryEntry {
  return {
    id,
    at: 1_700_000_000_000,
    ruleId: "rule-1",
    name: "Rule",
    kind: "redirect",
    method: "GET",
    resourceType: "main_frame",
    url: `https://example.com/${id}`,
    initiator: "https://example.com/",
    action: "→ https://dest.example/path",
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
      value: "configured-value",
    },
    ...overrides,
  };
}

function requestBodyEntry(
  overrides: Partial<MatchIndexEntry> = {},
): MatchIndexEntry {
  return {
    ruleId: "body-1",
    name: "Body One",
    kind: "request-body",
    redactSensitiveInLogs: false,
    intent: { mode: "replace", rewrite: "configured-rewrite" },
    ...overrides,
  };
}

interface MemoryApi {
  readonly api: ChromeApi;
  readonly local: Record<string, unknown>;
  readonly session: Record<string, unknown>;
  readonly localSets: Record<string, unknown>[];
  readonly sessionSets: Record<string, unknown>[];
  readonly syncSets: Record<string, unknown>[];
  readonly sendMessage: ReturnType<typeof vi.fn>;
  readonly listeners: ChromeStorageChangedListener[];
}

function memoryApi(initial?: {
  readonly local?: Record<string, unknown>;
  readonly session?: Record<string, unknown>;
}): MemoryApi {
  const local: Record<string, unknown> = {
    rogatio: { version: 1, projects: { alpha: { name: "Alpha" } } },
    ...(initial?.local ?? {}),
  };
  const session: Record<string, unknown> = { ...(initial?.session ?? {}) };
  const localSets: Record<string, unknown>[] = [];
  const sessionSets: Record<string, unknown>[] = [];
  const syncSets: Record<string, unknown>[] = [];
  const listeners: ChromeStorageChangedListener[] = [];
  const sendMessage = vi.fn();

  const area = (
    store: Record<string, unknown>,
    sets: Record<string, unknown>[],
    areaName: string,
  ) => ({
    get: async (key?: string) => {
      if (key === undefined) return { ...store };
      return { [key]: store[key] };
    },
    set: async (value: Record<string, unknown>) => {
      const changes: Record<
        string,
        { oldValue?: unknown; newValue?: unknown }
      > = {};
      for (const [key, next] of Object.entries(value)) {
        changes[key] = { oldValue: store[key], newValue: next };
        store[key] = next;
      }
      sets.push(value);
      if (areaName === "local") {
        for (const listener of [...listeners]) listener(changes, areaName);
      }
    },
  });

  const api = {
    storage: {
      local: area(local, localSets, "local"),
      session: area(session, sessionSets, "session"),
      sync: area({}, syncSets, "sync"),
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
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    runtime: {
      sendMessage,
      connectNative: vi.fn(),
      onMessage: { addListener: () => {} },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      onRuleMatchedDebug: { addListener: () => {} },
    },
    scripting: { executeScript: async () => undefined },
  } as unknown as ChromeApi;

  return {
    api,
    local,
    session,
    localSets,
    sessionSets,
    syncSets,
    sendMessage,
    listeners,
  };
}

async function settleHistory(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await Promise.resolve();
    await whenMatchHistoryIdle();
  }
}

function storedEntries(session: Record<string, unknown>): MatchHistoryEntry[] {
  return parseMatchHistoryEntries(session[MATCH_HISTORY_ENTRIES_KEY]);
}

beforeEach(async () => {
  await settleHistory();
});

describe("match history ring", () => {
  it("keeps at most 100 rows and drops the oldest", () => {
    let entries: MatchHistoryEntry[] = [];
    for (let index = 0; index < MATCH_HISTORY_CAP + 1; index += 1) {
      entries = appendMatchHistory(entries, row(String(index)));
    }
    expect(entries).toHaveLength(MATCH_HISTORY_CAP);
    expect(entries[0]?.id).toBe("1");
    expect(entries.at(-1)?.id).toBe(String(MATCH_HISTORY_CAP));
    expect(entries.some((entry) => entry.id === "0")).toBe(false);
  });

  it("drops malformed rows and a throwing iterator still accepts the new row", () => {
    const inherited = Object.create({
      id: "inherited",
      at: 1,
      ruleId: "rule",
      name: "n",
      kind: "redirect",
      method: "GET",
      resourceType: "main_frame",
      url: "https://example.com/inherited",
      initiator: "",
      action: "",
    }) as MatchHistoryEntry;
    const hostile = new Proxy([row("keep")], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator boom");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      appendMatchHistory([inherited, row("own")], row("next")).map(
        (entry) => entry.id,
      ),
    ).toEqual(["own", "next"]);
    expect(
      appendMatchHistory(hostile, row("fresh")).map((entry) => entry.id),
    ).toEqual(["fresh"]);
  });

  it("parses only own fields and ignores a throwing accessor", () => {
    const throwing: Record<string, unknown> = {
      id: "bad",
      at: 1,
      ruleId: "rule",
      name: "n",
      kind: "redirect",
      method: "GET",
      resourceType: "main_frame",
      initiator: "",
      action: "",
    };
    Object.defineProperty(throwing, "url", {
      get() {
        throw new Error("url boom");
      },
    });
    expect(parseMatchHistoryEntries([throwing, row("ok")])).toEqual([
      row("ok"),
    ]);
    expect(parseMatchHistoryEntries({ notHistory: [row("nope")] })).toEqual([]);
    expect(
      parseMatchHistoryEntries({
        [MATCH_HISTORY_ENTRIES_KEY]: [row("stored"), "nope", null],
      }),
    ).toEqual([row("stored")]);
  });
});

describe("match history redaction", () => {
  const secretUrl =
    "https://user:pass@example.com/path?token=super-secret&ok=1#frag";

  it("strips userinfo and fragment and redacts sensitive query values", () => {
    const record = buildMatchHistoryRecord(
      {
        ruleId: "redirect-1",
        name: "Redirect",
        kind: "redirect",
        redactSensitiveInLogs: true,
        intent: { destination: secretUrl },
      },
      {
        url: secretUrl,
        method: "GET",
        initiator: "https://user:pw@init.example/app?token=init-secret#hash",
        resourceType: "main_frame",
      },
      1_700_000_000_000,
      "id-1",
    );
    expect(record).toBeDefined();
    const encoded = JSON.stringify(record);
    expect(encoded).not.toContain("user:pass");
    expect(encoded).not.toContain("super-secret");
    expect(encoded).not.toContain("init-secret");
    expect(encoded).not.toContain("#frag");
    expect(encoded).not.toContain("#hash");
    expect(record?.url).toContain("token=[redacted]");
    expect(record?.url).toContain("ok=1");
    expect(record?.initiator).toContain("[redacted]");
    expect(record?.action).toContain("[redacted]");
    expect(record?.action).not.toContain("super-secret");
  });

  it("stores intended action only and drops live body bytes and wire header values", () => {
    const live = {
      url: "https://example.com/api",
      method: "POST",
      resourceType: "xmlhttprequest",
      body: "LIVE_BODY_BYTES",
      headers: { authorization: "Bearer wire-secret" },
    };
    const open = buildMatchHistoryRecord(
      requestBodyEntry(),
      live,
      10,
      "body-open",
    );
    expect(open?.action).toContain("replace");
    expect(open?.action).toContain("configured-rewrite");
    expect(JSON.stringify(open)).not.toContain("LIVE_BODY_BYTES");
    expect(JSON.stringify(open)).not.toContain("wire-secret");
    expect(open && "body" in open).toBe(false);

    const hidden = buildMatchHistoryRecord(
      requestBodyEntry({ redactSensitiveInLogs: true }),
      live,
      11,
      "body-hidden",
    );
    expect(hidden?.action).toContain("[redacted]");
    expect(hidden?.action).not.toContain("configured-rewrite");

    const header = buildMatchHistoryRecord(
      headerEntry({
        redactSensitiveInLogs: true,
        intent: {
          direction: "request",
          operation: "set",
          name: "authorization",
          value: "Bearer configured-secret",
        },
      }),
      live,
      12,
      "header-hidden",
    );
    expect(header?.action).toContain("[redacted]");
    expect(JSON.stringify(header)).not.toContain("configured-secret");
    expect(JSON.stringify(header)).not.toContain("wire-secret");
  });

  it("rejects kinds the match pipeline does not log", () => {
    expect(
      buildMatchHistoryRecord(
        {
          ruleId: "matcher-1",
          name: "Matcher",
          kind: "matcher" as MatchIndexEntry["kind"],
          redactSensitiveInLogs: false,
          intent: { destination: "https://example.com/" },
        },
        { url: "https://example.com/" },
        1,
        "id",
      ),
    ).toBeUndefined();
  });

  it("fails closed when an entry field throws", () => {
    const entry = headerEntry();
    Object.defineProperty(entry, "kind", {
      get() {
        throw new Error("kind boom");
      },
    });
    expect(
      buildMatchHistoryRecord(entry, { url: "https://example.com/" }, 1, "id"),
    ).toBeUndefined();
  });
});

describe("match history storage", () => {
  it("writes only the session entries key", async () => {
    const memory = memoryApi();
    const project = structuredClone(memory.local.rogatio);
    await recordMatchHistory(
      memory.api,
      headerEntry({ redactSensitiveInLogs: true }),
      {
        url: "https://user:pass@example.com/hit?token=super-secret#frag",
        method: "GET",
        resourceType: "xmlhttprequest",
      },
      50,
    );
    expect(Object.keys(memory.session)).toEqual([MATCH_HISTORY_ENTRIES_KEY]);
    expect(memory.localSets).toEqual([]);
    expect(memory.syncSets).toEqual([]);
    expect(memory.local.rogatio).toEqual(project);
    expect(memory.sendMessage).not.toHaveBeenCalled();
    const entries = storedEntries(memory.session);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain("user:pass");
    expect(JSON.stringify(entries)).not.toContain("super-secret");
    expect(JSON.stringify(entries)).not.toContain("#frag");
    expect(await readMatchHistory(memory.api)).toEqual(entries);
  });

  it("drops the oldest session row after 100 appends", async () => {
    const memory = memoryApi();
    for (let index = 0; index <= MATCH_HISTORY_CAP; index += 1) {
      await recordMatchHistory(
        memory.api,
        headerEntry({ ruleId: `rule-${index}` }),
        { url: `https://example.com/${index}`, method: "GET" },
        index,
      );
    }
    const entries = storedEntries(memory.session);
    expect(entries).toHaveLength(MATCH_HISTORY_CAP);
    expect(entries[0]?.url).toBe("https://example.com/1");
    expect(entries.at(-1)?.url).toBe(
      `https://example.com/${MATCH_HISTORY_CAP}`,
    );
    expect(entries.some((entry) => entry.url === "https://example.com/0")).toBe(
      false,
    );
    expect(memory.localSets).toEqual([]);
  });

  it("does not write when session storage is missing", async () => {
    const memory = memoryApi();
    const api = {
      ...memory.api,
      storage: { local: memory.api.storage.local },
    } as ChromeApi;
    await expect(
      recordMatchHistory(
        api,
        headerEntry(),
        { url: "https://example.com/" },
        1,
      ),
    ).resolves.toBeUndefined();
    expect(memory.localSets).toEqual([]);
    expect(memory.sessionSets).toEqual([]);
  });
});

describe("match logging toggle clears history", () => {
  it("clears session history when the toggle is turned off", async () => {
    const memory = memoryApi({
      session: { [MATCH_HISTORY_ENTRIES_KEY]: [row("keep"), row("also")] },
    });
    const unregister = registerMatchHistory(memory.api);
    try {
      await settleHistory();
      expect(storedEntries(memory.session)).toHaveLength(2);
      const persisted = vi.fn();
      const label = createMatchLoggingToggle({
        api: memory.api,
        enabled: true,
        onPersisted: persisted,
      });
      document.body.append(label);
      const input = label.querySelector("input");
      if (!(input instanceof HTMLInputElement))
        throw new Error("missing toggle");
      input.checked = false;
      input.dispatchEvent(new Event("change"));
      await settleHistory();
      expect(memory.local[MATCH_LOGGING_ENABLED_KEY]).toBe(false);
      expect(storedEntries(memory.session)).toEqual([]);
      expect(persisted).toHaveBeenCalledWith(false);
      expect(memory.syncSets).toEqual([]);
      expect(memory.sendMessage).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("clears on startup when logging is already off and keeps rows when turned back on", async () => {
    const memory = memoryApi({
      local: { [MATCH_LOGGING_ENABLED_KEY]: false },
      session: { [MATCH_HISTORY_ENTRIES_KEY]: [row("stale")] },
    });
    const unregister = registerMatchHistory(memory.api);
    try {
      await settleHistory();
      expect(storedEntries(memory.session)).toEqual([]);
      memory.session[MATCH_HISTORY_ENTRIES_KEY] = [row("manual")];
      for (const listener of memory.listeners) {
        listener({ [MATCH_LOGGING_ENABLED_KEY]: { newValue: true } }, "local");
      }
      await settleHistory();
      expect(storedEntries(memory.session)).toEqual([row("manual")]);
      for (const listener of memory.listeners) {
        listener(
          { [MATCH_LOGGING_INDEX_KEY]: { newValue: { "1": headerEntry() } } },
          "local",
        );
      }
      await settleHistory();
      expect(storedEntries(memory.session)).toEqual([row("manual")]);
    } finally {
      unregister();
    }
  });

  it("clears through the Clear message and ignores other messages", async () => {
    const memory = memoryApi({
      session: { [MATCH_HISTORY_ENTRIES_KEY]: [row("gone")] },
    });
    const sendResponse = vi.fn();
    expect(isClearMatchHistoryMessage(["not", "a", "message"])).toBe(false);
    expect(
      isClearMatchHistoryMessage(
        Object.create({ version: 1, command: CLEAR_MATCH_HISTORY_COMMAND }),
      ),
    ).toBe(false);
    expect(
      handleMatchHistoryMessage(
        memory.api,
        { version: 1, command: "refresh" },
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(
      handleMatchHistoryMessage(
        memory.api,
        { version: 1, command: CLEAR_MATCH_HISTORY_COMMAND },
        sendResponse,
      ),
    ).toBe(true);
    await settleHistory();
    expect(storedEntries(memory.session)).toEqual([]);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(memory.localSets).toEqual([]);
  });
});

describe("match history uses the console match pipeline", () => {
  it("records header and body matches in session storage only", async () => {
    const memory = memoryApi({
      local: {
        [MATCH_LOGGING_INDEX_KEY]: {
          [String(HEADER_DNR_ID)]: headerEntry(),
          "3000001": requestBodyEntry(),
        },
      },
    });
    const project = structuredClone(memory.local.rogatio);
    const unregister = registerMatchHistory(memory.api);
    registerMatchLogListener(memory.api);
    try {
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: HEADER_DNR_ID },
        request: {
          tabId: 4,
          url: "https://user:pass@example.com/header#x",
          method: "GET",
          type: "xmlhttprequest",
          initiator: "https://example.com/",
        },
      });
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: 3_000_001 },
        request: {
          tabId: 5,
          url: "https://example.com/body",
          method: "POST",
          type: "xmlhttprequest",
        },
      });
      await settleHistory();
      const entries = storedEntries(memory.session);
      expect(entries.map((entry) => entry.kind)).toEqual([
        "header",
        "request-body",
      ]);
      expect(entries[1]?.action).toContain("configured-rewrite");
      expect(JSON.stringify(entries)).not.toContain("user:pass");
      expect(JSON.stringify(entries)).not.toContain("#x");
      expect(entries[0]?.url).toContain("https://example.com/header");
      expect(memory.local.rogatio).toEqual(project);
      expect(Object.keys(memory.session)).toEqual([MATCH_HISTORY_ENTRIES_KEY]);
      expect(memory.syncSets).toEqual([]);
      expect(memory.sendMessage).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("stays silent for the same fail-closed gates as console logging", async () => {
    const memory = memoryApi({
      local: {
        [MATCH_LOGGING_ENABLED_KEY]: false,
        [MATCH_LOGGING_INDEX_KEY]: {
          [String(HEADER_DNR_ID)]: headerEntry(),
          [String(MOCK_GUARD_ID)]: headerEntry({ ruleId: "guard" }),
        },
      },
    });
    const unregister = registerMatchHistory(memory.api);
    registerMatchLogListener(memory.api);
    try {
      await settleHistory();
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: HEADER_DNR_ID },
        request: { tabId: 1, url: "https://example.com/off" },
      });
      memory.local[MATCH_LOGGING_ENABLED_KEY] = true;
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: HEADER_DNR_ID },
        request: { tabId: -1, url: "https://example.com/worker" },
      });
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: 999 },
        request: { tabId: 2, url: "https://example.com/unknown" },
      });
      await handleRuleMatchedDebug(memory.api, {
        rule: { ruleId: MOCK_GUARD_ID },
        request: { tabId: 3, url: "https://example.com/guard" },
      });
      await settleHistory();
      expect(memory.session[MATCH_HISTORY_ENTRIES_KEY] ?? []).toEqual([]);
      expect(JSON.stringify(memory.session)).not.toContain("example.com/off");
      expect(JSON.stringify(memory.session)).not.toContain(
        "example.com/worker",
      );
      expect(JSON.stringify(memory.session)).not.toContain(
        "example.com/unknown",
      );
      expect(JSON.stringify(memory.session)).not.toContain("example.com/guard");
    } finally {
      unregister();
    }
  });
});
