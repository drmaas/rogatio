import { describe, expect, it, vi } from "vitest";
import {
  createPermissionAdapter,
  createStorageAdapter,
} from "../src/chrome.js";

function apiFor(storage: {
  get: () => Promise<unknown>;
  set: (value: Record<string, unknown>) => Promise<void>;
}) {
  return {
    storage: { local: storage },
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
  };
}

describe("F7 Chrome adapters", () => {
  it("passes exact origin arrays to permission APIs", async () => {
    const request = vi.fn(async () => true);
    const api = {
      ...apiFor({ get: async () => ({}), set: async () => {} }),
      permissions: {
        contains: async () => false,
        request,
        remove: async () => true,
      },
    };
    await createPermissionAdapter(api).request(["https://example.com"]);
    expect(request).toHaveBeenCalledWith({ origins: ["https://example.com"] });
  });

  it("uses compare-and-swap to protect stored state", async () => {
    let value: unknown;
    const set = vi.fn(async (next: Record<string, unknown>) => {
      value = next.rogatio;
    });
    const storage = createStorageAdapter(
      apiFor({ get: async () => ({ rogatio: value }), set }),
    );
    expect(await storage.compareAndSwap(undefined, { version: 1 })).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    expect(await storage.compareAndSwap({ version: 0 }, { version: 2 })).toBe(
      false,
    );
  });

  it("serializes concurrent compare-and-swap mutations", async () => {
    let value: unknown;
    let releaseSet!: () => void;
    const setReady = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const set = vi.fn(async (next: Record<string, unknown>) => {
      await setReady;
      value = next.rogatio;
    });
    const storage = createStorageAdapter(
      apiFor({ get: async () => ({ rogatio: value }), set }),
    );
    const first = storage.compareAndSwap(undefined, { version: 1 });
    const second = storage.compareAndSwap(undefined, { version: 2 });
    releaseSet();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(value).toEqual({ version: 1 });
    expect(set).toHaveBeenCalledTimes(1);
  });
});
