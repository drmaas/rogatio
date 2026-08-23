export interface ChromeStorageArea {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<void>;
}

export interface ChromePermissions {
  contains(options: { origins: readonly string[] }): Promise<boolean>;
  request(options: { origins: readonly string[] }): Promise<boolean>;
  remove(options: { origins: readonly string[] }): Promise<boolean>;
}

export interface ChromeAction {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
}

export interface ChromeRuntime {
  lastError?: { readonly message?: string };
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined,
    ): void;
  };
}

export interface ChromeApi {
  storage: { local: ChromeStorageArea };
  permissions: ChromePermissions;
  action: ChromeAction;
  runtime: ChromeRuntime;
}

declare global {
  // Chrome injects this object in MV3 contexts; tests provide a fake adapter.
  var chrome: ChromeApi;
}

export function chromeApi(): ChromeApi {
  if (typeof chrome === "undefined")
    throw new Error("extension.chrome-unavailable");
  return chrome;
}

export function createStorageAdapter(api: ChromeApi = chromeApi()) {
  let mutationTail: Promise<void> = Promise.resolve();

  function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }

  return {
    async read(): Promise<unknown> {
      const result = await api.storage.local.get("rogatio");
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result)
      ) {
        throw new Error("extension.storage-failed");
      }
      return (result as Record<string, unknown>).rogatio;
    },
    compareAndSwap(previous: unknown, next: unknown): Promise<boolean> {
      return withMutationLock(async () => {
        const result = await api.storage.local.get("rogatio");
        if (
          result === null ||
          typeof result !== "object" ||
          Array.isArray(result)
        ) {
          throw new Error("extension.storage-failed");
        }
        const current = (result as Record<string, unknown>).rogatio;
        if (JSON.stringify(current) !== JSON.stringify(previous)) return false;
        await api.storage.local.set({ rogatio: next });
        return true;
      });
    },
  };
}

export function createPermissionAdapter(api: ChromeApi = chromeApi()) {
  return {
    contains(origins: readonly string[]): Promise<boolean> {
      return api.permissions.contains({ origins });
    },
    request(origins: readonly string[]): Promise<boolean> {
      return api.permissions.request({ origins });
    },
    remove(origins: readonly string[]): Promise<boolean> {
      return api.permissions.remove({ origins });
    },
  };
}

export async function setBadge(
  badge: { readonly text: string; readonly attention: boolean },
  api: ChromeApi = chromeApi(),
): Promise<void> {
  await api.action.setBadgeText({ text: badge.text });
  await api.action.setBadgeBackgroundColor({
    color: badge.attention ? "#b42318" : "#1559a6",
  });
}
