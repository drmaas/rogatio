import type {
  HeaderOperation,
  QueryOperation,
  RedirectOperation,
} from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import { createDnrInstaller } from "../src/dnr.js";
import {
  lookupMatchIndexEntry,
  MATCH_LOGGING_INDEX_KEY,
  sanitizeMatchIndexEntry,
  writeMatchIndex,
} from "../src/match-index.js";
import { truncateLogString } from "../src/match-log-redaction.js";

function storageApi(initial: Record<string, unknown> = {}): {
  api: ChromeApi;
  store: Record<string, unknown>;
} {
  const store = { ...initial };
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
  } as unknown as ChromeApi;
  return { api, store };
}

function dnrApi(
  storage: ChromeApi["storage"],
  updateDynamicRules: (payload: {
    removeRuleIds: number[];
    addRules: unknown[];
  }) => Promise<void>,
  getDynamicRules: () => Promise<Array<{ id: number }>> = async () => [],
): ChromeApi {
  return {
    storage,
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
    declarativeNetRequest: { updateDynamicRules, getDynamicRules },
  } as unknown as ChromeApi;
}

const redirectOp: RedirectOperation = {
  kind: "redirect",
  groupId: "g1",
  ruleId: "r1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 5,
  },
  redirect: { destination: "https://other.com/path" },
};

const queryOp: QueryOperation = {
  kind: "query",
  groupId: "g1",
  ruleId: "query-1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 10,
  },
  action: {
    type: "query",
    params: [{ name: "a", operation: "set", value: "1" }],
  },
};

describe("match index", () => {
  it("install writes redirect and query intent under collision-probed ids", async () => {
    const { api, store } = storageApi({ rogatio: { version: 1 } });
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    const chrome = dnrApi(api.storage, updateDynamicRules);
    const installer = createDnrInstaller(chrome);

    const sensitiveRedirect: RedirectOperation = {
      ...redirectOp,
      ruleId: "r-sensitive",
      redactSensitiveInLogs: true,
      redirect: {
        destination: "https://other.com/?token=secret-value",
      },
    };
    const absentFlagQuery: QueryOperation = {
      ...queryOp,
      ruleId: "q-absent",
      redactSensitiveInLogs: false,
    };
    delete (absentFlagQuery as { redactSensitiveInLogs?: boolean })
      .redactSensitiveInLogs;

    await installer.install([sensitiveRedirect, absentFlagQuery, queryOp]);

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<string, unknown>;
    expect(index).toBeDefined();
    expect(Object.keys(index).length).toBe(3);

    const ids = Object.keys(index).map(Number);
    for (const id of ids) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(1_000_000);
    }

    const payload = updateDynamicRules.mock.calls[0][0] as {
      addRules: Array<{ id: number }>;
    };
    for (const rule of payload.addRules) {
      const entry = index[String(rule.id)] as Record<string, unknown>;
      expect(entry).toBeDefined();
      expect(entry.redactBodiesInLogs).toBeUndefined();
    }

    const sensitiveEntry = Object.values(index).find(
      (entry) => (entry as { ruleId?: string }).ruleId === "r-sensitive",
    ) as {
      ruleId: string;
      kind: string;
      redactSensitiveInLogs: boolean;
      intent: { destination: string };
    };
    expect(sensitiveEntry.kind).toBe("redirect");
    expect(sensitiveEntry.redactSensitiveInLogs).toBe(true);
    expect(sensitiveEntry.intent.destination).toContain("[redacted]");

    const absentEntry = Object.values(index).find(
      (entry) => (entry as { ruleId?: string }).ruleId === "q-absent",
    ) as { redactSensitiveInLogs: boolean; kind: string };
    expect(absentEntry.kind).toBe("query");
    expect(absentEntry.redactSensitiveInLogs).toBe(false);
  });

  it("lookup survives a new installer instance after storage persist", async () => {
    const { api, store } = storageApi();
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    const chrome = dnrApi(api.storage, updateDynamicRules);
    await createDnrInstaller(chrome).install([redirectOp]);

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<string, unknown>;
    const [idString] = Object.keys(index);
    const numericId = Number(idString);

    const entry = await lookupMatchIndexEntry(api, numericId);
    expect(entry).toEqual({
      ruleId: "r1",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: "https://other.com/path" },
    });
  });

  it("lookup works after JSON round-trip with string object keys", async () => {
    const { api, store } = storageApi();
    await createDnrInstaller(
      dnrApi(
        api.storage,
        vi.fn(async () => {}),
      ),
    ).install([queryOp]);

    store[MATCH_LOGGING_INDEX_KEY] = JSON.parse(
      JSON.stringify(store[MATCH_LOGGING_INDEX_KEY]),
    );

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<string, unknown>;
    const numericId = Number(Object.keys(index)[0]);
    const entry = await lookupMatchIndexEntry(api, numericId);
    expect(entry?.kind).toBe("query");
    expect(entry?.intent).toEqual({
      params: [{ name: "a", operation: "set", value: "1" }],
    });
  });

  it("failed install keeps the previous index; empty success writes {}", async () => {
    const { api, store } = storageApi({
      [MATCH_LOGGING_INDEX_KEY]: {
        "42": {
          ruleId: "old",
          kind: "redirect",
          redactSensitiveInLogs: false,
          intent: { destination: "https://old.example/" },
        },
      },
    });
    const failingUpdate = vi.fn(async () => {
      throw new Error("dnr-failed");
    });
    const installer = createDnrInstaller(dnrApi(api.storage, failingUpdate));

    expect(await installer.install([redirectOp])).toEqual({
      ok: false,
      diagnostics: [],
    });
    expect(store[MATCH_LOGGING_INDEX_KEY]).toEqual({
      "42": {
        ruleId: "old",
        kind: "redirect",
        redactSensitiveInLogs: false,
        intent: { destination: "https://old.example/" },
      },
    });

    const successUpdate = vi.fn(async () => {});
    const emptyInstaller = createDnrInstaller(
      dnrApi(api.storage, successUpdate),
    );
    expect(await emptyInstaller.install([])).toEqual({ ok: true });
    expect(store[MATCH_LOGGING_INDEX_KEY]).toEqual({});
  });

  it("returns undefined for unknown ids and ignores malformed storage", async () => {
    const { api } = storageApi();
    expect(await lookupMatchIndexEntry(api, 999_999)).toBeUndefined();

    await writeMatchIndex(api, {
      "1": {
        ruleId: "ok",
        kind: "redirect",
        redactSensitiveInLogs: false,
        intent: { destination: "https://example.com/" },
      },
    });

    const protoPoison = Object.create(null) as Record<string, unknown>;
    protoPoison["1"] = {
      ruleId: "ok",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: "https://example.com/" },
    };
    Object.defineProperty(protoPoison, "__proto__", {
      get() {
        return {
          ruleId: "proto",
          kind: "redirect",
          redactSensitiveInLogs: false,
          intent: { destination: "https://proto.example/" },
        };
      },
      enumerable: true,
      configurable: true,
    });

    await api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: protoPoison });
    expect(await lookupMatchIndexEntry(api, 1)).toEqual({
      ruleId: "ok",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: "https://example.com/" },
    });

    const inheritedOnly = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(inheritedOnly, "__proto__", {
      get() {
        return {
          ruleId: "proto",
          kind: "redirect",
          redactSensitiveInLogs: false,
          intent: { destination: "https://proto.example/" },
        };
      },
      enumerable: true,
      configurable: true,
    });
    await api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: inheritedOnly,
    });
    expect(await lookupMatchIndexEntry(api, 1)).toBeUndefined();

    await api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: [] });
    expect(await lookupMatchIndexEntry(api, 1)).toBeUndefined();

    await api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: "garbage" });
    expect(await lookupMatchIndexEntry(api, 1)).toBeUndefined();

    await api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        "2": {
          ruleId: 123,
          kind: "redirect",
          redactSensitiveInLogs: false,
          intent: { destination: "https://example.com/" },
        },
      },
    });
    expect(await lookupMatchIndexEntry(api, 2)).toBeUndefined();
  });

  it("keeps install successful when the index write fails", async () => {
    const chrome = {
      storage: {
        local: {
          get: async (key?: string) => (key === undefined ? {} : { [key]: {} }),
          set: async () => {
            throw new Error("QUOTA_BYTES exceeded");
          },
        },
      },
      declarativeNetRequest: {
        updateDynamicRules: vi.fn(async () => {}),
        getDynamicRules: async () => [],
      },
    } as unknown as ChromeApi;

    expect(await createDnrInstaller(chrome).install([redirectOp])).toEqual({
      ok: true,
    });
  });

  it("lookup never throws on a rejected read or a throwing accessor", async () => {
    const rejecting = {
      storage: {
        local: {
          get: async () => {
            throw new Error("storage unavailable");
          },
          set: async () => {},
        },
      },
    } as unknown as ChromeApi;
    expect(await lookupMatchIndexEntry(rejecting, 1)).toBeUndefined();

    const { api } = storageApi();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "1", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
      configurable: true,
    });
    await api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: hostile });
    expect(await lookupMatchIndexEntry(api, 1)).toBeUndefined();
  });

  it("ignores entry fields that are only inherited", async () => {
    const { api } = storageApi();
    const inherited = Object.create({
      ruleId: "inherited",
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: "https://inherited.example/" },
    }) as Record<string, unknown>;

    await api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: { "7": inherited },
    });
    expect(await lookupMatchIndexEntry(api, 7)).toBeUndefined();

    await api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        "8": {
          ruleId: "own",
          kind: "redirect",
          redactSensitiveInLogs: false,
          intent: Object.create({ destination: "https://inherited.example/" }),
        },
      },
    });
    expect(await lookupMatchIndexEntry(api, 8)).toBeUndefined();
  });

  it("truncates without splitting a surrogate pair", () => {
    const value = `${"a".repeat(196)}😀${"b".repeat(50)}`;
    const truncated = truncateLogString(value);
    expect(truncated.length).toBeLessThanOrEqual(200);
    expect(truncated.endsWith("...")).toBe(true);
    expect(/[\uD800-\uDFFF]/.test(truncated)).toBe(false);
  });

  it("stores only log-intent fields and truncates strings when sensitive is false", async () => {
    const longDestination = `https://example.com/${"x".repeat(250)}`;
    const op: RedirectOperation = {
      ...redirectOp,
      redirect: { destination: longDestination },
    };
    const { api, store } = storageApi({
      rogatio: { version: 1, projects: [] },
    });
    await createDnrInstaller(
      dnrApi(
        api.storage,
        vi.fn(async () => {}),
      ),
    ).install([op]);

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      Record<string, unknown>
    >;
    const entry = Object.values(index)[0];
    expect(entry.matcher).toBeUndefined();
    expect(entry.origins).toBeUndefined();
    expect(entry.body).toBeUndefined();
    expect(entry.eventUrl).toBeUndefined();
    expect(entry.redactBodiesInLogs).toBeUndefined();
    expect(store.rogatio).toEqual({ version: 1, projects: [] });

    const destination = (entry.intent as { destination: string }).destination;
    expect(destination.length).toBeLessThanOrEqual(200);
    expect(destination.endsWith("...")).toBe(true);
  });

  it("redacts deny-listed query values when sensitive is true and keeps plaintext when false", async () => {
    const sensitiveQuery: QueryOperation = {
      ...queryOp,
      ruleId: "q-sensitive",
      redactSensitiveInLogs: true,
      action: {
        type: "query",
        params: [
          { name: "access_token", operation: "set", value: "plain-secret" },
        ],
      },
    };
    const plainQuery: QueryOperation = {
      ...queryOp,
      ruleId: "q-plain",
      redactSensitiveInLogs: false,
      action: {
        type: "query",
        params: [
          { name: "access_token", operation: "set", value: "plain-secret" },
        ],
      },
    };

    const { api, store } = storageApi();
    await createDnrInstaller(
      dnrApi(
        api.storage,
        vi.fn(async () => {}),
      ),
    ).install([sensitiveQuery, plainQuery]);

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      { ruleId: string; intent: { params: Array<{ value?: string }> } }
    >;
    const sensitive = Object.values(index).find(
      (entry) => entry.ruleId === "q-sensitive",
    );
    const plain = Object.values(index).find(
      (entry) => entry.ruleId === "q-plain",
    );
    expect(sensitive?.intent.params[0]?.value).toBe("[redacted]");
    expect(plain?.intent.params[0]?.value).toBe("plain-secret");
  });

  it("sanitize helper redacts header values by deny-listed name and truncates", () => {
    const sanitized = sanitizeMatchIndexEntry({
      ruleId: "h1",
      kind: "header",
      redactSensitiveInLogs: true,
      intent: {
        direction: "request",
        operation: "set",
        name: "x-api-key",
        value: "super-secret-key-material",
      },
    });
    expect(sanitized.intent).toEqual({
      direction: "request",
      operation: "set",
      name: "x-api-key",
      value: "[redacted]",
    });
    expect((sanitized as { body?: unknown }).body).toBeUndefined();
    expect(
      (sanitized as { redactBodiesInLogs?: unknown }).redactBodiesInLogs,
    ).toBeUndefined();

    const plain = sanitizeMatchIndexEntry({
      ruleId: "h2",
      kind: "header",
      redactSensitiveInLogs: false,
      intent: {
        direction: "request",
        operation: "set",
        name: "x-api-key",
        value: "super-secret-key-material",
      },
    });
    expect((plain.intent as { value?: string }).value).toBe(
      "super-secret-key-material",
    );

    const longValue = "y".repeat(250);
    const truncated = sanitizeMatchIndexEntry({
      ruleId: "h3",
      kind: "header",
      redactSensitiveInLogs: false,
      intent: {
        direction: "response",
        operation: "remove",
        name: "x-custom",
        value: longValue,
      },
    });
    expect(
      (truncated.intent as { value?: string }).value?.length,
    ).toBeLessThanOrEqual(200);
    expect(
      (truncated.intent as { value?: string }).value?.endsWith("..."),
    ).toBe(true);
  });

  it("writes header ids and intent through the wholesale installer snapshot", async () => {
    const headerOp: HeaderOperation = {
      kind: "header",
      groupId: "g1",
      ruleId: "rule-header-set",
      redactSensitiveInLogs: true,
      matcher: {
        urlRegex: { source: "^https://example\\.com/", flags: "" },
        origins: ["https://example.com"],
        resourceTypes: ["main_frame"],
        priority: 100,
      },
      header: {
        direction: "request",
        operation: "set",
        name: "authorization",
        value: "Bearer secret-token",
      },
    };
    const { api, store } = storageApi();
    const installer = createDnrInstaller(
      dnrApi(
        api.storage,
        vi.fn(async () => {}),
      ),
    );
    await installer.syncHeaderMatchIndex([
      { ruleId: 2_000_001, operation: headerOp },
    ]);
    expect(store[MATCH_LOGGING_INDEX_KEY]).toEqual({
      "2000001": {
        ruleId: "rule-header-set",
        kind: "header",
        redactSensitiveInLogs: true,
        intent: {
          direction: "request",
          operation: "set",
          name: "authorization",
          value: "[redacted]",
        },
      },
    });
  });

  it("keeps stored header intent when a redirect install rewrites the index", async () => {
    const headerOp: HeaderOperation = {
      kind: "header",
      groupId: "g1",
      ruleId: "rule-header-set",
      redactSensitiveInLogs: false,
      matcher: {
        urlRegex: { source: "^https://example\\.com/", flags: "" },
        origins: ["https://example.com"],
        resourceTypes: ["main_frame"],
        priority: 100,
      },
      header: {
        direction: "request",
        operation: "set",
        name: "x-trace",
        value: "on",
      },
    };
    const { api, store } = storageApi();
    const installer = createDnrInstaller(
      dnrApi(
        api.storage,
        vi.fn(async () => {}),
      ),
    );
    await installer.syncHeaderMatchIndex([
      { ruleId: 2_000_001, operation: headerOp },
    ]);

    // The redirect/query install never touches installed header rules, so it
    // must not invalidate their index entries.
    expect(await installer.install([redirectOp])).toEqual({ ok: true });

    const index = store[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      { ruleId: string; kind: string }
    >;
    expect(index["2000001"]).toEqual({
      ruleId: "rule-header-set",
      kind: "header",
      redactSensitiveInLogs: false,
      intent: {
        direction: "request",
        operation: "set",
        name: "x-trace",
        value: "on",
      },
    });
    expect(
      Object.values(index).some((entry) => entry.kind === "redirect"),
    ).toBe(true);
  });
});
