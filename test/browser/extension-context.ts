import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { chromium } from "@playwright/test";

export interface ExtensionContext {
  readonly context: BrowserContext;
  readonly profile: string;
  readonly extensionId: string;
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

async function launchExtensionContext(
  profile: string,
  extensionPath: string,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
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

// Launches a persistent context with the built extension loaded. Callers own
// teardown: close the context and remove the profile directory.
export async function extensionContext(
  options: ExtensionContextOptions = {},
): Promise<ExtensionContext> {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-browser-"));
  const extensionPath = join(process.cwd(), "packages/extension/dist");
  const extensionId = computeExtensionId(extensionPath);

  if (options.grantOrigins !== undefined && options.grantOrigins.length > 0) {
    const bootstrap = await launchExtensionContext(profile, extensionPath);
    await bootstrap.close();
    await seedGrantedOrigins(profile, extensionId, options.grantOrigins);
  }

  const context = await launchExtensionContext(profile, extensionPath);
  return { context, profile, extensionId };
}
