import type { QueryOperation, RedirectOperation } from "@rogatio/compiler";
import { vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import { createDnrInstaller } from "../src/dnr.js";
import { BODY_MARKER_ID_MIN } from "../src/session-body-markers.js";

export const HEADER_BAND_ID = 2_000_001;
export const BODY_MARKER_BAND_ID = BODY_MARKER_ID_MIN;
export const FOREIGN_ID = 1_500_000;

export function storageLocal() {
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

/** In-memory Chrome DNR + storage for restart / hydrate tests. */
export function chromeHeldInstaller(initialIds: number[] = []) {
  let chromeIds = [...initialIds];
  let sessionIds: number[] = [];
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
  const updateSessionRules = vi.fn(
    async (payload: {
      removeRuleIds: number[];
      addRules: Array<{ id: number }>;
    }) => {
      const remove = new Set(payload.removeRuleIds);
      sessionIds = sessionIds.filter((id) => !remove.has(id));
      for (const rule of payload.addRules) {
        if (sessionIds.includes(rule.id)) {
          throw new Error(`Session rule with id ${rule.id} already exists`);
        }
        sessionIds.push(rule.id);
      }
    },
  );
  const getSessionRules = vi.fn(async () => sessionIds.map((id) => ({ id })));
  const storage = storageLocal();
  const api = {
    storage: { local: storage },
    declarativeNetRequest: {
      updateDynamicRules,
      getDynamicRules,
      updateSessionRules,
      getSessionRules,
    },
  } as unknown as ChromeApi;
  return {
    api,
    storage,
    updateDynamicRules,
    getDynamicRules,
    updateSessionRules,
    getSessionRules,
    chromeIds: () => chromeIds,
    setChromeIds: (ids: number[]) => {
      chromeIds = [...ids];
    },
    sessionIds: () => sessionIds,
    setSessionIds: (ids: number[]) => {
      sessionIds = [...ids];
    },
  };
}

export async function desiredNumericId(
  api: ChromeApi,
  operation: RedirectOperation | QueryOperation,
): Promise<number> {
  const probe = createDnrInstaller(api);
  const update = api.declarativeNetRequest?.updateDynamicRules as
    | ReturnType<typeof vi.fn>
    | undefined;
  update?.mockClear();
  await probe.install([operation]);
  const addCall = [...(update?.mock.calls ?? [])]
    .reverse()
    .find(
      (call) =>
        Array.isArray((call[0] as { addRules?: unknown[] }).addRules) &&
        ((call[0] as { addRules: unknown[] }).addRules?.length ?? 0) > 0,
    )?.[0] as { addRules: Array<{ id: number }> } | undefined;
  const id = addCall?.addRules[0]?.id;
  if (id === undefined) throw new Error("probe install did not add a rule");
  return id;
}
