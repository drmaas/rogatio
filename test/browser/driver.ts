import { accessSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Builder, type WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

export const BASE_URL = "http://127.0.0.1:4173";

export type DriverOptions = {
  readonly headless?: boolean;
  readonly userDataDir?: string;
  readonly extensionPath?: string;
  readonly args?: string[];
};

/**
 * Resolve Chrome for Testing (via `pnpm browser:install` / `@puppeteer/browsers`).
 * Prefer CfT over branded Google Chrome — branded builds dropped `--load-extension`.
 * @see https://developer.chrome.com/docs/automation-and-testing/download-test-binaries
 */
export function resolveChromeBinary(): string {
  if (process.env.ROGATIO_CHROME_PATH) {
    accessSync(process.env.ROGATIO_CHROME_PATH);
    return process.env.ROGATIO_CHROME_PATH;
  }
  // Legacy env alias.
  if (process.env.ROGATIO_CHROMIUM_PATH) {
    accessSync(process.env.ROGATIO_CHROMIUM_PATH);
    return process.env.ROGATIO_CHROMIUM_PATH;
  }

  const cacheRoot = join(process.cwd(), ".browser-cache");
  // Prefer Chrome for Testing; fall back to Chromium cache if present.
  for (const browser of ["chrome", "chromium"] as const) {
    const root = join(cacheRoot, browser);
    let builds: string[];
    try {
      builds = readdirSync(root).filter((name) => !name.startsWith("."));
    } catch {
      continue;
    }
    builds.sort();
    const latest = builds.at(-1);
    if (!latest) continue;
    const candidates =
      browser === "chrome"
        ? [join(root, latest, "chrome-linux64", "chrome")]
        : [join(root, latest, "chrome-linux", "chrome")];
    for (const binary of candidates) {
      try {
        accessSync(binary);
        return binary;
      } catch {
        // try next
      }
    }
  }

  throw new Error(
    "Chrome for Testing is required for browser e2e. Run `pnpm browser:install`.",
  );
}

export async function createDriver(
  options: DriverOptions = {},
): Promise<WebDriver> {
  const chromeOptions = new chrome.Options();
  chromeOptions.setChromeBinaryPath(resolveChromeBinary());
  const headless = options.headless !== false;
  if (headless) {
    chromeOptions.addArguments("--headless=new");
  }
  chromeOptions.addArguments(
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
    ...(options.args ?? []),
  );
  if (options.userDataDir) {
    chromeOptions.addArguments(`--user-data-dir=${options.userDataDir}`);
  }
  if (options.extensionPath) {
    chromeOptions.addArguments(
      `--disable-extensions-except=${options.extensionPath}`,
      `--load-extension=${options.extensionPath}`,
    );
  }
  return new Builder()
    .forBrowser("chrome")
    .setChromeOptions(chromeOptions)
    .build();
}

export function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith("chrome-extension://")) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalized}`;
}
