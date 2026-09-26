import type {
  HeaderOperation,
  QueryOperation,
  RedirectOperation,
  ResponseBodyOperation,
} from "@rogatio/compiler";
import { queryActionToDNR } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  createDnrInstaller,
  translateQueryToDnr,
  translateRedirectToDnr,
} from "../src/dnr.js";
import {
  MATCH_LOGGING_INDEX_KEY,
  type MatchIndexEntry,
} from "../src/match-index.js";
import {
  chromeHeldInstaller,
  desiredNumericId,
  FOREIGN_ID,
  HEADER_BAND_ID,
  storageLocal,
} from "./dnr-harness.js";

const queryOp: QueryOperation = {
  kind: "query",
  groupId: "g1",
  ruleId: "query-1",
  name: "query-1",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
    resourceTypes: ["main_frame"],
    priority: 10,
  },
  action: { type: "query", params: [{ name: "a", value: "1" }] },
};

const redirectOp: RedirectOperation = {
  kind: "redirect",
  groupId: "g1",
  ruleId: "r1",
  name: "r1",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/(.*)$",
    },
    resourceTypes: ["main_frame"],
    priority: 5,
  },
  redirect: { destination: "https://other.com/\\1" },
};

const headerOp: HeaderOperation = {
  kind: "header",
  groupId: "g1",
  ruleId: "rule-header-set",
  name: "rule-header-set",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
    resourceTypes: ["main_frame"],
    priority: 100,
    method: "GET",
  },
  header: {
    direction: "request",
    operation: "set",
    name: "X-Custom-Header",
    value: "test-value",
  },
};

const bodyOp: ResponseBodyOperation = {
  kind: "response-body",
  groupId: "g1",
  ruleId: "rule-response-body",
  name: "rule-response-body",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/data$",
    },
    resourceTypes: ["xmlhttprequest"],
    priority: 100,
  },
  responseBody: {
    replacements: [{ pattern: "old", replacement: "new" }],
  },
};

function headerIndexEntry(operation: HeaderOperation): MatchIndexEntry {
  return {
    ruleId: operation.ruleId,
    name: operation.name,
    kind: "header",
    redactSensitiveInLogs: false,
    intent: {
      direction: operation.header.direction,
      operation: operation.header.operation,
      name: operation.header.name,
      ...(operation.header.value !== undefined
        ? { value: operation.header.value }
        : {}),
    },
  };
}

describe("F9 DNR translation", () => {
  it("maps a redirect operation to a Chrome DNR rule", () => {
    const rule = translateRedirectToDnr(redirectOp, 42);
    expect(rule).toEqual({
      id: 42,
      priority: 5,
      action: { type: "redirect", redirect: { url: "https://other.com/\\1" } },
      condition: {
        regexFilter: "^https://example\\.com/(.*)$",
        resourceTypes: ["main_frame"],
      },
    });
  });

  it("installs redirect rules through the declarativeNetRequest API", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    let storedIds: number[] = [];
    const getDynamicRules = vi.fn(async () => storedIds.map((id) => ({ id })));
    const api = {
      storage: { local: storageLocal() },
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;
    const installer = createDnrInstaller(api);

    expect(await installer.current()).toEqual([]);

    const result = await installer.install([redirectOp]);
    expect(result).toEqual({ ok: true });
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const payload = updateDynamicRules.mock.calls[0][0] as {
      removeRuleIds: number[];
      addRules: unknown[];
    };
    expect(payload.addRules).toHaveLength(1);
    expect(payload.removeRuleIds).toEqual([
      (payload.addRules[0] as { id: number }).id,
    ]);

    storedIds = payload.addRules.map((rule) => (rule as { id: number }).id);
    const current = await installer.current();
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(redirectOp);
  });

  it("maps query operations to DNR redirect transforms", () => {
    expect(translateQueryToDnr(queryOp, 7)).toEqual({
      id: 7,
      priority: 10,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: queryActionToDNR(queryOp.action),
          },
        },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
      },
    });
  });

  it("maps remove query params to DNR removeParams", () => {
    const removeOp: QueryOperation = {
      ...queryOp,
      action: {
        type: "query",
        params: [{ name: "a", operation: "remove" }],
      },
    };
    expect(translateQueryToDnr(removeOp, 8)).toEqual({
      id: 8,
      priority: 10,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: { removeParams: ["a"] },
          },
        },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
      },
    });
  });

  it("installs query operations as DNR redirect transforms", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    const api = {
      storage: { local: storageLocal() },
      declarativeNetRequest: {
        updateDynamicRules,
        getDynamicRules: async () => [],
      },
    } as unknown as ChromeApi;
    const installer = createDnrInstaller(api);

    expect(await installer.install([queryOp])).toEqual({ ok: true });
    const addCall = updateDynamicRules.mock.calls.find(
      (call) =>
        Array.isArray((call[0] as { addRules?: unknown[] }).addRules) &&
        ((call[0] as { addRules: unknown[] }).addRules?.length ?? 0) > 0,
    )?.[0] as {
      addRules: Array<{
        action: { redirect: { transform: { queryTransform: unknown } } };
      }>;
    };
    expect(
      addCall.addRules[0]?.action.redirect.transform.queryTransform,
    ).toEqual(queryActionToDNR(queryOp.action));
  });

  it("does nothing when the declarativeNetRequest API is unavailable", async () => {
    const api = {
      storage: { local: storageLocal() },
    } as unknown as ChromeApi;
    const installer = createDnrInstaller(api);
    expect(await installer.current()).toEqual([]);
    expect(await installer.install([redirectOp])).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "core.install-failed" })],
    });
  });
});

describe("P1 DNR remove via Chrome ∩ Rogatio ids", () => {
  it("removes Chrome-held desired ids when tracked is empty (SW restart)", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();
    harness.setChromeIds([desiredId]);

    const cold = createDnrInstaller(harness.api);
    const result = await cold.install([redirectOp]);

    expect(result).toEqual({ ok: true });
    const removeCall = harness.updateDynamicRules.mock.calls.find(
      (call) =>
        ((call[0] as { removeRuleIds: number[] }).removeRuleIds?.length ?? 0) >
        0,
    )?.[0] as { removeRuleIds: number[] } | undefined;
    expect(removeCall?.removeRuleIds).toContain(desiredId);
    expect(harness.chromeIds()).toContain(desiredId);
  });

  it("drops Rogatio-owned orphans and leaves foreign ids alone", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    const orphanId = desiredId === 42 ? 43 : 42;
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();
    harness.setChromeIds([desiredId, orphanId, HEADER_BAND_ID, FOREIGN_ID]);

    const cold = createDnrInstaller(harness.api);
    expect(await cold.install([redirectOp])).toEqual({ ok: true });

    const orphanRemove = harness.updateDynamicRules.mock.calls.find((call) => {
      const payload = call[0] as {
        removeRuleIds: number[];
        addRules: unknown[];
      };
      return (
        payload.addRules.length === 0 &&
        payload.removeRuleIds.includes(orphanId)
      );
    })?.[0] as { removeRuleIds: number[] } | undefined;
    expect(orphanRemove?.removeRuleIds).toEqual(
      expect.arrayContaining([orphanId, HEADER_BAND_ID]),
    );
    expect(orphanRemove?.removeRuleIds).not.toContain(FOREIGN_ID);

    const replaceCall = harness.updateDynamicRules.mock.calls.find((call) => {
      const payload = call[0] as {
        removeRuleIds: number[];
        addRules: Array<{ id: number }>;
      };
      return payload.addRules.some((rule) => rule.id === desiredId);
    })?.[0] as { removeRuleIds: number[]; addRules: unknown[] } | undefined;
    expect(replaceCall?.removeRuleIds).toEqual([desiredId]);

    expect(harness.chromeIds()).toEqual(
      expect.arrayContaining([desiredId, FOREIGN_ID]),
    );
    expect(harness.chromeIds()).not.toContain(orphanId);
    expect(harness.chromeIds()).not.toContain(HEADER_BAND_ID);
  });

  it("reinstalls desired ids when orphan bulk-remove fails (per-rule remove+add)", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    const orphanId = desiredId === 42 ? 43 : 42;
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();
    harness.setChromeIds([desiredId, orphanId]);

    harness.updateDynamicRules.mockImplementation(
      async (payload: {
        removeRuleIds: number[];
        addRules: Array<{ id: number }>;
      }) => {
        if (payload.addRules.length === 0) {
          throw new Error("bulk orphan remove failed");
        }
        const remove = new Set(payload.removeRuleIds);
        const next = harness.chromeIds().filter((id) => !remove.has(id));
        for (const rule of payload.addRules) {
          if (next.includes(rule.id)) {
            throw new Error(`Rule with id ${rule.id} already exists`);
          }
          next.push(rule.id);
        }
        harness.setChromeIds(next);
      },
    );

    const cold = createDnrInstaller(harness.api);
    expect(await cold.install([redirectOp])).toEqual({ ok: true });
    expect(harness.chromeIds()).toContain(desiredId);
    // Orphan may linger after failed bulk remove; desired must still land.
    expect(harness.chromeIds()).toContain(orphanId);
  });

  it("fails closed when getDynamicRules throws (no empty-remove then add)", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    const getDynamicRules = vi.fn(async () => {
      throw new Error("DNR unavailable");
    });
    const api = {
      storage: { local: storageLocal() },
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;

    const installer = createDnrInstaller(api);
    expect(await installer.install([redirectOp])).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "core.install-failed",
          params: { reason: "DNR unavailable" },
        }),
      ],
    });
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it("fails closed when getDynamicRules returns a non-array (unreadable live set)", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    const getDynamicRules = vi.fn(async () => undefined);
    const api = {
      storage: { local: storageLocal() },
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;

    const installer = createDnrInstaller(api);
    expect(await installer.install([redirectOp])).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "core.install-failed" })],
    });
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it("empty desired drops owned Chrome ids in both bands and leaves foreign ids", async () => {
    const harness = chromeHeldInstaller([]);
    const ownedId = await desiredNumericId(harness.api, queryOp);
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();
    harness.setChromeIds([ownedId, HEADER_BAND_ID, FOREIGN_ID]);

    const cold = createDnrInstaller(harness.api);
    expect(await cold.install([])).toEqual({ ok: true });

    const removeCall = harness.updateDynamicRules.mock.calls.find(
      (call) =>
        ((call[0] as { removeRuleIds: number[] }).removeRuleIds?.length ?? 0) >
        0,
    )?.[0] as { removeRuleIds: number[] } | undefined;
    expect(removeCall?.removeRuleIds).toEqual(
      expect.arrayContaining([ownedId, HEADER_BAND_ID]),
    );
    expect(removeCall?.removeRuleIds).not.toContain(FOREIGN_ID);
    expect(harness.chromeIds()).toEqual([FOREIGN_ID]);
  });
});

describe("P2 current() survives restart via Chrome ∩ index ∩ compiled", () => {
  function redirectIndexEntry(operation: RedirectOperation): MatchIndexEntry {
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: "redirect",
      redactSensitiveInLogs: false,
      intent: { destination: operation.redirect.destination },
    };
  }

  function queryIndexEntry(operation: QueryOperation): MatchIndexEntry {
    return {
      ruleId: operation.ruleId,
      name: operation.name,
      kind: "query",
      redactSensitiveInLogs: false,
      intent: {
        params: operation.action.params.map((param) => {
          const operationName = param.operation ?? "set";
          if (param.value === undefined) {
            return { name: param.name, operation: operationName };
          }
          return {
            name: param.name,
            operation: operationName,
            value: param.value,
          };
        }),
      },
    };
  }

  it("hydrates current() from Chrome ∩ index ∩ compiled when tracked is empty", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();
    harness.setChromeIds([desiredId]);
    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(desiredId)]: redirectIndexEntry(redirectOp),
      },
    });

    const cold = createDnrInstaller(harness.api);
    expect(await cold.current()).toEqual([]);

    await cold.hydrateInstalled([redirectOp, queryOp]);
    const current = await cold.current();
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(redirectOp);
    expect(current.map((op) => op.ruleId)).toEqual([redirectOp.ruleId]);
  });

  it("does not report Chrome-held ids when index is missing (no ruleIdHash guess)", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.setChromeIds([desiredId]);
    await harness.api.storage.local.set({ [MATCH_LOGGING_INDEX_KEY]: {} });

    const cold = createDnrInstaller(harness.api);
    await cold.hydrateInstalled([redirectOp]);
    expect(await cold.current()).toEqual([]);
  });

  it("does not report index-only ids missing from Chrome", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.setChromeIds([]);
    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(desiredId)]: redirectIndexEntry(redirectOp),
      },
    });

    const cold = createDnrInstaller(harness.api);
    await cold.hydrateInstalled([redirectOp]);
    expect(await cold.current()).toEqual([]);
  });

  it("does not report Chrome ∩ index when compiled ops omit the ruleId", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.setChromeIds([desiredId]);
    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(desiredId)]: redirectIndexEntry(redirectOp),
      },
    });

    const cold = createDnrInstaller(harness.api);
    await cold.hydrateInstalled([queryOp]);
    expect(await cold.current()).toEqual([]);
  });

  it("ignores malformed index entries and still hydrates valid siblings", async () => {
    const harness = chromeHeldInstaller([]);
    // Discover numeric ids on a separate store so harness index stays intentional.
    const probeHarness = chromeHeldInstaller([]);
    const redirectId = await desiredNumericId(probeHarness.api, redirectOp);
    const queryId = await desiredNumericId(probeHarness.api, queryOp);
    expect(redirectId).not.toBe(queryId);
    harness.setChromeIds([redirectId, queryId]);
    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(redirectId)]: { not: "an-entry" },
        [String(queryId)]: queryIndexEntry(queryOp),
      },
    });

    const cold = createDnrInstaller(harness.api);
    await cold.hydrateInstalled([redirectOp, queryOp]);
    const current = await cold.current();
    expect(current.map((op) => op.ruleId)).toEqual([queryOp.ruleId]);
    expect(current[0]).toBe(queryOp);
  });

  it("does not wipe warm tracked when compiled this turn omits a live rule", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    expect(await installer.install([redirectOp])).toEqual({ ok: true });
    expect(await installer.current()).toEqual([redirectOp]);

    await installer.hydrateInstalled([queryOp]);
    const current = await installer.current();
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(redirectOp);
  });

  it("does not hydrate when index kind disagrees with compiled kind", async () => {
    const harness = chromeHeldInstaller([]);
    const desiredId = await desiredNumericId(harness.api, redirectOp);
    harness.setChromeIds([desiredId]);
    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(desiredId)]: {
          ...redirectIndexEntry(redirectOp),
          ruleId: queryOp.ruleId,
          kind: "query",
        },
      },
    });

    const cold = createDnrInstaller(harness.api);
    await cold.hydrateInstalled([redirectOp, queryOp]);
    expect(await cold.current()).toEqual([]);
  });

  it("writes durable match-index identity on successful redirect/query install", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    expect(await installer.install([redirectOp, queryOp])).toEqual({
      ok: true,
    });

    const stored = (await harness.api.storage.local.get(
      MATCH_LOGGING_INDEX_KEY,
    )) as Record<string, unknown>;
    const index = stored[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      MatchIndexEntry
    >;
    const ruleIds = Object.values(index).map((entry) => entry.ruleId);
    expect(ruleIds).toEqual(
      expect.arrayContaining([redirectOp.ruleId, queryOp.ruleId]),
    );
  });
});

describe("P3a headers share unified reconciler authority", () => {
  it("installs and removes header+redirect/query through one install path", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);

    expect(await installer.install([redirectOp, headerOp])).toEqual({
      ok: true,
    });

    const current = await installer.current();
    expect(current.map((op) => op.ruleId).sort()).toEqual(
      [redirectOp.ruleId, headerOp.ruleId].sort(),
    );
    expect(current.find((op) => op.ruleId === headerOp.ruleId)).toBe(headerOp);
    expect(harness.chromeIds()).toEqual(
      expect.arrayContaining([HEADER_BAND_ID]),
    );

    const addCalls = harness.updateDynamicRules.mock.calls.filter((call) => {
      const payload = call[0] as { addRules: Array<{ id: number }> };
      return payload.addRules.length > 0;
    });
    const headerAdd = addCalls.find((call) =>
      (call[0] as { addRules: Array<{ id: number }> }).addRules.some(
        (rule) => rule.id === HEADER_BAND_ID,
      ),
    )?.[0] as
      | {
          removeRuleIds: number[];
          addRules: Array<{
            id: number;
            action: { type: string };
          }>;
        }
      | undefined;
    expect(headerAdd?.removeRuleIds).toEqual([HEADER_BAND_ID]);
    expect(headerAdd?.addRules[0]?.action.type).toBe("modifyHeaders");

    harness.updateDynamicRules.mockClear();
    expect(await installer.install([redirectOp])).toEqual({ ok: true });
    expect(harness.chromeIds()).not.toContain(HEADER_BAND_ID);
    expect((await installer.current()).map((op) => op.ruleId)).toEqual([
      redirectOp.ruleId,
    ]);
  });

  it("empty tracked + Chrome-held header ids use same remove/installed authority", async () => {
    const harness = chromeHeldInstaller([]);
    const warm = createDnrInstaller(harness.api);
    expect(await warm.install([headerOp])).toEqual({ ok: true });
    expect(harness.chromeIds()).toEqual([HEADER_BAND_ID]);

    await harness.api.storage.local.set({
      [MATCH_LOGGING_INDEX_KEY]: {
        [String(HEADER_BAND_ID)]: headerIndexEntry(headerOp),
      },
    });
    harness.updateDynamicRules.mockClear();
    harness.getDynamicRules.mockClear();

    const cold = createDnrInstaller(harness.api);
    expect(await cold.current()).toEqual([]);

    await cold.hydrateInstalled([headerOp, redirectOp]);
    const hydrated = await cold.current();
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]).toBe(headerOp);

    expect(await cold.install([headerOp])).toEqual({ ok: true });
    const removeCall = harness.updateDynamicRules.mock.calls.find(
      (call) =>
        ((call[0] as { removeRuleIds: number[] }).removeRuleIds?.length ?? 0) >
        0,
    )?.[0] as { removeRuleIds: number[] } | undefined;
    expect(removeCall?.removeRuleIds).toContain(HEADER_BAND_ID);
    expect(harness.chromeIds()).toContain(HEADER_BAND_ID);
    expect((await cold.current())[0]).toBe(headerOp);
  });

  it("writes durable header identity on successful install (same index key)", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    expect(await installer.install([headerOp, redirectOp])).toEqual({
      ok: true,
    });

    const stored = (await harness.api.storage.local.get(
      MATCH_LOGGING_INDEX_KEY,
    )) as Record<string, unknown>;
    const index = stored[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      MatchIndexEntry
    >;
    expect(index[String(HEADER_BAND_ID)]).toMatchObject({
      ruleId: headerOp.ruleId,
      kind: "header",
    });
    expect(
      Object.values(index).some((entry) => entry.ruleId === redirectOp.ruleId),
    ).toBe(true);
  });

  it("clears header index identity when unified install drops headers", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    expect(await installer.install([headerOp, redirectOp])).toEqual({
      ok: true,
    });

    expect(await installer.install([redirectOp])).toEqual({ ok: true });
    expect(harness.chromeIds()).not.toContain(HEADER_BAND_ID);

    const stored = (await harness.api.storage.local.get(
      MATCH_LOGGING_INDEX_KEY,
    )) as Record<string, unknown>;
    const index = stored[MATCH_LOGGING_INDEX_KEY] as Record<
      string,
      MatchIndexEntry
    >;
    expect(index[String(HEADER_BAND_ID)]).toBeUndefined();
    expect(Object.values(index).some((entry) => entry.kind === "header")).toBe(
      false,
    );
    expect(
      Object.values(index).some((entry) => entry.ruleId === redirectOp.ruleId),
    ).toBe(true);
  });

  it("ignores body ops on the DNR installer path", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    expect(await installer.install([bodyOp, headerOp])).toEqual({ ok: true });
    expect(harness.chromeIds()).toEqual([HEADER_BAND_ID]);
    expect((await installer.current()).map((op) => op.kind)).toEqual([
      "header",
    ]);
  });
});

describe("P3b DNR install diagnostics", () => {
  it("returns core.install-failed with Chrome reason on total redirect fail", async () => {
    const harness = chromeHeldInstaller([]);
    harness.updateDynamicRules.mockImplementation(async () => {
      throw new Error("Rule with id 1: invalid regexFilter");
    });
    const installer = createDnrInstaller(harness.api);
    const result = await installer.install([redirectOp]);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "core.install-failed",
          params: { reason: "Rule with id 1: invalid regexFilter" },
        },
      ],
    });
    expect(installer.takeInstallErrors()).toEqual([
      {
        ruleId: redirectOp.ruleId,
        message: "Rule with id 1: invalid regexFilter",
      },
    ]);
  });

  it("returns core.install-failed with Chrome reason on total header fail", async () => {
    const harness = chromeHeldInstaller([]);
    harness.updateDynamicRules.mockImplementation(async () => {
      throw new Error("Rule with id 2000001 cannot have an empty list");
    });
    const installer = createDnrInstaller(harness.api);
    const result = await installer.install([headerOp]);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "core.install-failed",
          params: {
            reason: "Rule with id 2000001 cannot have an empty list",
          },
        },
      ],
    });
    expect(installer.takeInstallErrors()).toEqual([
      {
        ruleId: headerOp.ruleId,
        message: "Rule with id 2000001 cannot have an empty list",
      },
    ]);
  });

  it("keeps ok: true on partial success and records failed sibling reason", async () => {
    const harness = chromeHeldInstaller([]);
    let adds = 0;
    harness.updateDynamicRules.mockImplementation(
      async (payload: {
        removeRuleIds: number[];
        addRules: Array<{ id: number }>;
      }) => {
        if ((payload.addRules?.length ?? 0) > 0) {
          adds += 1;
          if (adds > 1) {
            throw new Error("Chrome rejected second rule");
          }
        }
        const remove = new Set(payload.removeRuleIds);
        let chromeIds = harness.chromeIds().filter((id) => !remove.has(id));
        for (const rule of payload.addRules) {
          chromeIds = [...chromeIds, rule.id];
        }
        harness.setChromeIds(chromeIds);
      },
    );
    const installer = createDnrInstaller(harness.api);
    const result = await installer.install([redirectOp, queryOp]);
    expect(result).toEqual({ ok: true });
    expect(installer.takeInstallErrors()).toEqual([
      {
        ruleId: queryOp.ruleId,
        message: "Chrome rejected second rule",
      },
    ]);
    expect((await installer.current()).map((op) => op.ruleId)).toEqual([
      redirectOp.ruleId,
    ]);
  });
});
