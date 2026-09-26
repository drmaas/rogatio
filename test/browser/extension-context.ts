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
  /** Extra Chrome arguments for this profile (for example a proxy bypass override). */
  readonly chromeArgs?: readonly string[];
}

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
  chromeArgs: readonly string[] = [],
): Promise<WebDriver> {
  return createDriver({
    userDataDir: profile,
    extensionPath,
    args: [...chromeArgs],
  });
}

// Launches Chrome with the built extension loaded. Callers own teardown via close().
export async function extensionContext(
  options: ExtensionContextOptions = {},
): Promise<ExtensionContext> {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-browser-"));
  const extensionPath = resolveExtensionPath();
  let extensionId = computeExtensionId(extensionPath);

  const driver = await launchExtensionDriver(
    profile,
    extensionPath,
    options.chromeArgs,
  );
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
