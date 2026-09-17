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
        initiatorDomains: ["example.com"],
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
    expect(payload.removeRuleIds).toEqual([]);
    expect(payload.addRules).toHaveLength(1);

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
            query: queryActionToDNR(queryOp.action),
          },
        },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
        initiatorDomains: ["example.com"],
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
            query: { removeParams: ["a"] },
          },
        },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
        initiatorDomains: ["example.com"],
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
    const payload = updateDynamicRules.mock.calls[0][0] as {
      addRules: Array<{
        action: { redirect: { transform: { query: unknown } } };
      }>;
    };
    expect(payload.addRules[0]?.action.redirect.transform.query).toEqual(
      queryActionToDNR(queryOp.action),
    );
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
