import type { QueryOperation, RedirectOperation } from "@rogatio/compiler";
import { queryActionToDNR } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  createDnrInstaller,
  translateQueryToDnr,
  translateRedirectToDnr,
} from "../src/dnr.js";

const queryOp: QueryOperation = {
  kind: "query",
  groupId: "g1",
  ruleId: "query-1",
  name: "query-1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 10,
  },
  action: { type: "query", params: [{ name: "a", value: "1" }] },
};

function storageLocal() {
  const store: Record<string, unknown> = {};
  return {
    get: async (key?: string) => {
      if (key === undefined) return { ...store };
      return { [key]: store[key] };
    },
    set: async (value: Record<string, unknown>) => {
      Object.assign(store, value);
    },
  };
}

const redirectOp: RedirectOperation = {
  kind: "redirect",
  groupId: "g1",
  ruleId: "r1",
  name: "r1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/(.*)$", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 5,
  },
  redirect: { destination: "https://other.com/\\1" },
};

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
        requestDomains: ["example.com"],
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
        requestDomains: ["example.com"],
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
        requestDomains: ["example.com"],
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
      diagnostics: [],
    });
  });
});

describe("P1 DNR remove via Chrome ∩ Rogatio ids", () => {
  const HEADER_BAND_ID = 2_000_001;
  const FOREIGN_ID = 1_500_000;

  function chromeHeldInstaller(initialIds: number[]) {
    let chromeIds = [...initialIds];
    const updateDynamicRules = vi.fn(
      async (payload: {
        removeRuleIds: number[];
        addRules: Array<{ id: number }>;
      }) => {
        const remove = new Set(payload.removeRuleIds);
        chromeIds = chromeIds.filter((id) => !remove.has(id));
        for (const rule of payload.addRules) {
          if (chromeIds.includes(rule.id)) {
            throw new Error(`Rule with id ${rule.id} already exists`);
          }
          chromeIds.push(rule.id);
        }
      },
    );
    const getDynamicRules = vi.fn(async () => chromeIds.map((id) => ({ id })));
    const api = {
      storage: { local: storageLocal() },
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;
    return {
      api,
      updateDynamicRules,
      getDynamicRules,
      chromeIds: () => chromeIds,
      setChromeIds: (ids: number[]) => {
        chromeIds = [...ids];
      },
    };
  }

  async function desiredNumericId(
    api: ChromeApi,
    operation: RedirectOperation | QueryOperation,
  ): Promise<number> {
    const probe = createDnrInstaller(api);
    const update = api.declarativeNetRequest?.updateDynamicRules as
      | ReturnType<typeof vi.fn>
      | undefined;
    await probe.install([operation]);
    const addCall = (update?.mock.calls ?? []).find(
      (call) =>
        Array.isArray((call[0] as { addRules?: unknown[] }).addRules) &&
        ((call[0] as { addRules: unknown[] }).addRules?.length ?? 0) > 0,
    )?.[0] as { addRules: Array<{ id: number }> } | undefined;
    const id = addCall?.addRules[0]?.id;
    if (id === undefined) throw new Error("probe install did not add a rule");
    return id;
  }

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

  it("drops Rogatio-owned orphans and leaves foreign / header-band ids alone", async () => {
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
    expect(orphanRemove?.removeRuleIds).toEqual([orphanId]);
    expect(orphanRemove?.removeRuleIds).not.toContain(HEADER_BAND_ID);
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
      expect.arrayContaining([desiredId, HEADER_BAND_ID, FOREIGN_ID]),
    );
    expect(harness.chromeIds()).not.toContain(orphanId);
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
      diagnostics: [],
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
      diagnostics: [],
    });
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it("empty desired drops owned Chrome ids and leaves foreign / header-band ids", async () => {
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
    expect(removeCall?.removeRuleIds).toContain(ownedId);
    expect(removeCall?.removeRuleIds).not.toContain(HEADER_BAND_ID);
    expect(removeCall?.removeRuleIds).not.toContain(FOREIGN_ID);
    expect(harness.chromeIds()).toEqual([HEADER_BAND_ID, FOREIGN_ID]);
  });
});
