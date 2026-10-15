export interface ChromeStorageArea {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<void>;
}

interface ChromeStorageChange {
  readonly newValue?: unknown;
  readonly oldValue?: unknown;
}

export type ChromeStorageChangedListener = (
  changes: Readonly<Record<string, ChromeStorageChange>>,
  areaName: string,
) => void;

interface ChromeStorageOnChanged {
  addListener(listener: ChromeStorageChangedListener): void;
  removeListener?(listener: ChromeStorageChangedListener): void;
}

export interface ChromeAction {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
}

export interface ChromePort {
  postMessage(message: unknown): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
}

export interface ChromeRuntime {
  lastError?: { readonly message?: string };
  id?: string;
  getManifest?(): { readonly version?: string };
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
  connectNative?(name: string): ChromePort;
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

interface ChromeDynamicRule {
  readonly id: number;
}

export interface ChromeRuleMatchedDebugInfo {
  rule: { ruleId: number };
  request: {
    url?: string;
    tabId: number;
    method?: string;
    initiator?: string;
    type?: string;
  };
}

interface ChromeDeclarativeNetRequest {
  getDynamicRules(): Promise<Array<ChromeDynamicRule>>;
  updateDynamicRules(details: {
    removeRuleIds: number[];
    addRules: unknown[];
  }): Promise<void>;
  getSessionRules?(): Promise<Array<ChromeDynamicRule>>;
  updateSessionRules?(details: {
    removeRuleIds: number[];
    addRules: unknown[];
  }): Promise<void>;
  onRuleMatchedDebug?: {
    addListener(listener: (info: ChromeRuleMatchedDebugInfo) => void): void;
  };
}

export interface ChromeScripting {
  executeScript(details: {
    target: { tabId: number };
    world?: "ISOLATED";
    func?: (...args: unknown[]) => void;
    args?: unknown[];
  }): Promise<unknown>;
}

interface ChromeProxySettings {
  get(
    details: { incognito?: boolean },
    callback: (config: {
      value: unknown;
      levelOfControl:
        | "not_controllable"
        | "controlled_by_other_extensions"
        | "controllable_by_this_extension"
        | "controlled_by_this_extension";
    }) => void,
  ): void;
  set(
    details: {
      value: {
        mode:
          | "pac_script"
          | "direct"
          | "auto_detect"
          | "fixed_servers"
          | "system";
        pacScript?: { data?: string; url?: string };
      };
      scope?: "regular" | "incognito_persistent" | "incognito_session_only";
    },
    callback?: () => void,
  ): void;
  clear(
    details: {
      scope?: "regular" | "incognito_persistent" | "incognito_session_only";
    },
    callback?: () => void,
  ): void;
}

interface ChromePermissions {
  contains(
    permission: { origins?: string[] },
    callback: (result: boolean) => void,
  ): void;
}

interface ChromeExtensionInfo {
  isAllowedIncognitoAccess(callback: (allowed: boolean) => void): void;
}

interface ChromeTabs {
  query(
    queryInfo: { active?: boolean; currentWindow?: boolean },
    callback: (tabs: { url?: string }[]) => void,
  ): void;
}

export interface ChromeApi {
  storage: {
    local: ChromeStorageArea;
    session?: ChromeStorageArea;
    onChanged?: ChromeStorageOnChanged;
  };
  action: ChromeAction;
  runtime: ChromeRuntime;
  declarativeNetRequest?: ChromeDeclarativeNetRequest;
  scripting?: ChromeScripting;
  proxy?: { settings: ChromeProxySettings };
  permissions?: ChromePermissions;
  extension?: ChromeExtensionInfo;
  tabs?: ChromeTabs;
}

declare global {
  // Chrome injects this object in MV3 contexts; tests provide a fake adapter.
  var chrome: ChromeApi;
}

function chromeApi(): ChromeApi {
  if (typeof chrome === "undefined")
    throw new Error("extension.chrome-unavailable");
  return chrome;
}

export function createStorageAdapter(
  api: Pick<ChromeApi, "storage"> = chromeApi(),
) {
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

export async function setBadge(
  badge: { readonly text: string; readonly attention: boolean },
  api: Pick<ChromeApi, "action"> = chromeApi(),
): Promise<void> {
  await api.action.setBadgeText({ text: badge.text });
  await api.action.setBadgeBackgroundColor({
    color: badge.attention ? "#b42318" : "#1559a6",
  });
}

type ProxyCollisionReason =
  | "controlling-proxy"
  | "controlling-pac"
  | "controlled_by_other"
  | "not_controllable"
  | "proxy-unavailable";

export interface ProxyAdapter {
  installPac(script: string): Promise<void>;
  clearPac(): Promise<void>;
  detectCollision(): Promise<ProxyCollisionReason | null>;
}

function proxyLastError(api: Pick<ChromeApi, "runtime">): string | undefined {
  return api.runtime.lastError?.message;
}

/**
 * chrome.proxy.settings adapter for PAC install/clear and collision detection.
 */
export function createProxyAdapter(
  api: Pick<ChromeApi, "proxy" | "runtime"> = chromeApi(),
): ProxyAdapter {
  const settings = api.proxy?.settings;
  return {
    async detectCollision() {
      if (!settings) return "proxy-unavailable";
      return new Promise((resolve) => {
        settings.get({}, (config) => {
          const err = proxyLastError(api);
          if (err) {
            resolve("proxy-unavailable");
            return;
          }
          if (config.levelOfControl === "controlled_by_other_extensions") {
            resolve("controlled_by_other");
            return;
          }
          if (config.levelOfControl === "not_controllable") {
            resolve("not_controllable");
            return;
          }
          resolve(null);
        });
      });
    },
    async installPac(script: string) {
      if (!settings) throw new Error("proxy-unavailable");
      const collision = await this.detectCollision();
      if (collision) throw new Error(collision);
      return new Promise<void>((resolve, reject) => {
        settings.set(
          {
            value: { mode: "pac_script", pacScript: { data: script } },
            scope: "regular",
          },
          () => {
            const err = proxyLastError(api);
            if (err) reject(new Error(err));
            else resolve();
          },
        );
      });
    },
    async clearPac() {
      if (!settings) return;
      return new Promise<void>((resolve) => {
        settings.clear({ scope: "regular" }, () => resolve());
      });
    },
  };
}
