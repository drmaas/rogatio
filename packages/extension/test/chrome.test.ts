import { describe, expect, it, vi } from "vitest";
import {
  type ChromeApi,
  createPermissionAdapter,
  createProxyAdapter,
  createStorageAdapter,
} from "../src/chrome.js";
import { createDnrInstaller } from "../src/dnr.js";

function apiFor(storage: {
  get: () => Promise<unknown>;
  set: (value: Record<string, unknown>) => Promise<void>;
}): ChromeApi {
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
  it("converts exact origins to Chrome match patterns", async () => {
    const contains = vi.fn(async () => true);
    const request = vi.fn(async () => true);
    const remove = vi.fn(async () => true);
    const api = {
      ...apiFor({ get: async () => ({}), set: async () => {} }),
      permissions: { contains, request, remove },
    };
    const adapter = createPermissionAdapter(api);
    await adapter.contains(["https://example.com", "https://example.org/"]);
    await adapter.request(["https://example.com", "https://example.org/"]);
    await adapter.remove(["https://example.com", "https://example.org/"]);
    expect(contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*", "https://example.org/*"],
    });
    expect(request).toHaveBeenCalledWith({
      origins: ["https://example.com/*", "https://example.org/*"],
    });
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://example.com/*", "https://example.org/*"],
    });
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

  it("constructs adapters when match-logging ports are omitted", () => {
    const api = apiFor({ get: async () => ({}), set: async () => {} });
    expect(() => createStorageAdapter(api)).not.toThrow();
    expect(() => createPermissionAdapter(api)).not.toThrow();
    expect(() => createDnrInstaller(api)).not.toThrow();
  });

  it("reads and writes only the rogatio storage key", async () => {
    const get = vi.fn(async () => ({ rogatio: { version: 1 } }));
    const set = vi.fn(async () => {});
    const storage = createStorageAdapter(apiFor({ get, set }));
    await storage.read();
    expect(get).toHaveBeenCalledWith("rogatio");
    await storage.compareAndSwap({ version: 1 }, { version: 2 });
    expect(set).toHaveBeenCalledWith({ rogatio: { version: 2 } });
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

describe("chrome proxy adapter", () => {
  it("sets PAC script and clears it", async () => {
    const set = vi.fn((_d: unknown, cb?: () => void) => cb?.());
    const clear = vi.fn((_d: unknown, cb?: () => void) => cb?.());
    const get = vi.fn(
      (
        _d: unknown,
        cb: (c: { value: unknown; levelOfControl: string }) => void,
      ) =>
        cb({
          value: {},
          levelOfControl: "controllable_by_this_extension",
        }),
    );
    const adapter = createProxyAdapter({
      ...apiFor({ get: async () => ({}), set: async () => {} }),
      proxy: { settings: { get, set, clear } },
    } as never);
    await adapter.installPac('function FindProxyForURL(){ return "DIRECT"; }');
    expect(set).toHaveBeenCalledOnce();
    await adapter.clearPac();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("detects controlled_by_other collision", async () => {
    const get = vi.fn(
      (
        _d: unknown,
        cb: (c: { value: unknown; levelOfControl: string }) => void,
      ) =>
        cb({
          value: {},
          levelOfControl: "controlled_by_other_extensions",
        }),
    );
    const adapter = createProxyAdapter({
      ...apiFor({ get: async () => ({}), set: async () => {} }),
      proxy: {
        settings: {
          get,
          set: vi.fn(),
          clear: vi.fn(),
        },
      },
    } as never);
    await expect(
      adapter.installPac('function FindProxyForURL(){ return "DIRECT"; }'),
    ).rejects.toThrow("controlled_by_other");
  });
});
