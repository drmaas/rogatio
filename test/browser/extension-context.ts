import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function computeExtensionId(extensionPath: string): string {
  const digest = createHash("sha256").update(extensionPath).digest();
  let extensionId = "";
  for (let i = 0; i < 16; i += 1) {
    extensionId += String.fromCharCode(97 + (digest[i] >> 4));
    extensionId += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  return extensionId;
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

async function seedGrantedOrigins(
  profile: string,
  extensionId: string,
  grantOrigins: readonly string[],
): Promise<void> {
  const prefsPath = join(profile, "Default", "Preferences");
  const prefs = JSON.parse(await readFile(prefsPath, "utf8")) as {
    extensions?: {
      settings?: Record<
        string,
        {
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
        }
      >;
    };
  };
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
  const extensionPath = join(process.cwd(), "packages/extension/dist");
  const extensionId = computeExtensionId(extensionPath);

  if (options.grantOrigins !== undefined && options.grantOrigins.length > 0) {
    const bootstrap = await launchExtensionDriver(profile, extensionPath);
    await bootstrap.quit();
    await seedGrantedOrigins(profile, extensionId, options.grantOrigins);
  }

  const driver = await launchExtensionDriver(profile, extensionPath);
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
