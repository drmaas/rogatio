import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WebDriver } from "selenium-webdriver";
import { createDriver } from "./driver.js";
import { Page } from "./page.js";

export interface ExtensionContext {
  readonly driver: WebDriver;
  readonly page: Page;
  readonly profile: string;
  readonly extensionId: string;
  close(): Promise<void>;
}

export interface ExtensionContextOptions {
  /** Optional host patterns (e.g. `http://127.0.0.1:4173/*`) seeded before relaunch. */
  readonly grantOrigins?: readonly string[];
}

type ExtensionSetting = {
  path?: string;
  active_permissions?: {
    api?: string[];
    explicit_host?: string[];
    manifest_permissions?: string[];
    scriptable_host?: string[];
  };
  granted_permissions?: {
    api?: string[];
    explicit_host?: string[];
    manifest_permissions?: string[];
    scriptable_host?: string[];
  };
  withheld_permissions?: {
    api?: string[];
    explicit_host?: string[];
    manifest_permissions?: string[];
    scriptable_host?: string[];
  };
};

type PreferencesFile = {
  extensions?: {
    settings?: Record<string, ExtensionSetting>;
  };
};

const NATIVE_HOST_NAME = "com.rogatio.runtime";

type NativeHostManifest = {
  name?: string;
  description?: string;
  path?: string;
  type?: string;
  allowed_origins?: string[];
};

/** Directories `rogatio runtime install` writes the host manifest to per platform. */
function installedManifestDirs(): string[] {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return [
        join(
          home,
          "Library",
          "Application Support",
          "Google",
          "Chrome",
          "NativeMessagingHosts",
        ),
      ];
    case "win32": {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return [join(appData, "Google", "Chrome", "NativeMessagingHosts")];
    }
    default:
      return [join(home, ".config", "google-chrome", "NativeMessagingHosts")];
  }
}

/**
 * Mirror the native-messaging host manifest registered by `rogatio runtime
 * install` into the test profile. Since Chrome 146, Google Chrome for Testing
 * resolves user-level hosts in NativeMessagingHosts/ under the user profile
 * directory — the harness passes a temp `--user-data-dir` — so the manifest
 * Chrome stable finds in ~/.config/google-chrome is invisible to the test
 * browser. Chrome reads manifests at connectNative() time, so seeding after
 * launch is fine.
 */
export async function seedNativeHostManifest(
  profile: string,
  extensionIds: readonly string[],
): Promise<void> {
  const dirs = installedManifestDirs();
  const source = dirs
    .map((dir) => join(dir, `${NATIVE_HOST_NAME}.json`))
    .find((candidate) => existsSync(candidate));
  if (source === undefined) {
    throw new Error(
      `native messaging host manifest ${NATIVE_HOST_NAME}.json not found in ${dirs.join(
        ", ",
      )}. Install it first: sudo rogatio runtime install --extension-id ${
        extensionIds[0] ?? "<extension-id>"
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(source, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `native messaging host manifest ${source} is not valid JSON: ${String(error)}`,
    );
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as NativeHostManifest).name !== "string" ||
    typeof (parsed as NativeHostManifest).path !== "string"
  ) {
    throw new Error(
      `native messaging host manifest ${source} is not a native messaging host manifest object`,
    );
  }
  const manifest = structuredClone(parsed) as NativeHostManifest;
  const origins = new Set(
    Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [],
  );
  for (const id of extensionIds) origins.add(`chrome-extension://${id}/`);
  manifest.allowed_origins = [...origins];
  const dir = join(profile, "NativeMessagingHosts");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${NATIVE_HOST_NAME}.json`),
    JSON.stringify(manifest, null, 2),
  );
}

function computeExtensionId(extensionPath: string): string {
  const digest = createHash("sha256").update(extensionPath).digest();
  let extensionId = "";
  for (let i = 0; i < 16; i += 1) {
    extensionId += String.fromCharCode(97 + (digest[i] >> 4));
    extensionId += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  return extensionId;
}

function resolveExtensionPath(): string {
  const candidate = resolve(process.cwd(), "packages/extension/dist");
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function cdpGetTargets(
  driver: WebDriver,
): Promise<Array<{ type?: string; url?: string }>> {
  const chromium = driver as WebDriver & {
    sendDevToolsCommand(
      cmd: string,
      parameters: Record<string, unknown>,
    ): Promise<unknown>;
  };
  const result = (await chromium.sendDevToolsCommand(
    "Target.getTargets",
    {},
  )) as {
    targetInfos?: Array<{ type?: string; url?: string }>;
  };
  return result.targetInfos ?? [];
}

/** Prefer the live service-worker URL over path-hash when Chrome disagrees. */
async function discoverExtensionId(
  driver: WebDriver,
  timeoutMs = 15_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await cdpGetTargets(driver);
      for (const target of targets) {
        if (
          target.type === "service_worker" &&
          typeof target.url === "string" &&
          target.url.startsWith("chrome-extension://")
        ) {
          return new URL(target.url).hostname;
        }
      }
    } catch {
      // Chrome may not accept CDP yet.
    }
    await sleep(100);
  }
  return null;
}

async function launchExtensionDriver(
  profile: string,
  extensionPath: string,
): Promise<WebDriver> {
  return createDriver({
    userDataDir: profile,
    extensionPath,
  });
}

async function waitForProfileUnlocked(
  profile: string,
  timeoutMs = 10_000,
): Promise<void> {
  const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket"].map(
    (name) => join(profile, name),
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!locks.some((path) => existsSync(path))) return;
    await sleep(50);
  }
}

async function readPreferences(profile: string): Promise<PreferencesFile> {
  const prefsPath = join(profile, "Default", "Preferences");
  return JSON.parse(await readFile(prefsPath, "utf8")) as PreferencesFile;
}

async function waitForExtensionSettings(
  profile: string,
  extensionPath: string,
  preferredId: string,
  timeoutMs = 15_000,
): Promise<{ extensionId: string; prefs: PreferencesFile }> {
  const prefsPath = join(profile, "Default", "Preferences");
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const prefs = await readPreferences(profile);
      const settings = prefs.extensions?.settings ?? {};
      const preferred = settings[preferredId];
      if (preferred?.active_permissions !== undefined) {
        return { extensionId: preferredId, prefs };
      }
      for (const [id, setting] of Object.entries(settings)) {
        if (
          setting.active_permissions !== undefined &&
          typeof setting.path === "string" &&
          (setting.path === extensionPath ||
            setting.path.includes("packages/extension/dist"))
        ) {
          return { extensionId: id, prefs };
        }
      }
      for (const [id, setting] of Object.entries(settings)) {
        if (setting.active_permissions !== undefined && id.length === 32) {
          return { extensionId: id, prefs };
        }
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `extension settings missing under ${prefsPath}${
      lastError ? ` (${String(lastError)})` : ""
    }`,
  );
}

async function seedGrantedOrigins(
  profile: string,
  extensionId: string,
  grantOrigins: readonly string[],
  prefs: PreferencesFile,
): Promise<void> {
  const prefsPath = join(profile, "Default", "Preferences");
  const setting = prefs.extensions?.settings?.[extensionId];
  if (setting?.active_permissions === undefined) {
    throw new Error(`extension settings missing for ${extensionId}`);
  }
  setting.active_permissions.explicit_host = [...grantOrigins];
  setting.granted_permissions = structuredClone(setting.active_permissions);
  setting.withheld_permissions = {
    api: [],
    explicit_host: [],
    manifest_permissions: [],
    scriptable_host: [],
  };
  await writeFile(prefsPath, JSON.stringify(prefs));
}

// Launches Chrome with the built extension loaded. Callers own teardown via close().
export async function extensionContext(
  options: ExtensionContextOptions = {},
): Promise<ExtensionContext> {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-browser-"));
  const extensionPath = resolveExtensionPath();
  let extensionId = computeExtensionId(extensionPath);

  if (options.grantOrigins !== undefined && options.grantOrigins.length > 0) {
    const bootstrap = await launchExtensionDriver(profile, extensionPath);
    try {
      const liveId = await discoverExtensionId(bootstrap);
      if (liveId) extensionId = liveId;
    } finally {
      await bootstrap.quit().catch(() => undefined);
    }
    await waitForProfileUnlocked(profile);
    const waited = await waitForExtensionSettings(
      profile,
      extensionPath,
      extensionId,
    );
    extensionId = waited.extensionId;
    await seedGrantedOrigins(
      profile,
      extensionId,
      options.grantOrigins,
      waited.prefs,
    );
  }

  const driver = await launchExtensionDriver(profile, extensionPath);
  const liveId = await discoverExtensionId(driver);
  if (liveId) extensionId = liveId;
  const page = new Page(driver);
  return {
    driver,
    page,
    profile,
    extensionId,
    async close() {
      try {
        await driver.quit();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    },
  };
}
