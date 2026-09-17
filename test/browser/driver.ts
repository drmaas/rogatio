import { accessSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Browser, Builder, type WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

export const BASE_URL = "http://127.0.0.1:4173";

/** Written by `scripts/install-browser.ts` for cross-platform binary resolution. */
export const CHROME_PATH_MARKER = join(
  process.cwd(),
  ".browser-cache",
  "chrome-path.txt",
);

export type DriverOptions = {
  readonly headless?: boolean;
  readonly userDataDir?: string;
  readonly extensionPath?: string;
  readonly args?: string[];
};

function inContainerOrCi(): boolean {
  return Boolean(process.env.CI) || Boolean(process.env.SELENIUM_IN_DOCKER);
}

function defaultHeadless(): boolean {
  if (process.env.SELENIUM_HEADED === "1") return false;
  if (process.env.SELENIUM_HEADLESS === "0") return false;
  return true;
}

/**
 * Resolve Chrome for Testing (via `pnpm browser:install` / `@puppeteer/browsers`).
 * Prefer CfT over branded Google Chrome — branded builds dropped `--load-extension`.
 * @see https://developer.chrome.com/docs/automation-and-testing/download-test-binaries
 */
export function resolveChromeBinary(): string {
  const envPath =
    process.env.CHROME_BIN ??
    process.env.ROGATIO_CHROME_PATH ??
    process.env.ROGATIO_CHROMIUM_PATH;
  if (envPath) {
    accessSync(envPath);
    return envPath;
  }

  if (existsSync(CHROME_PATH_MARKER)) {
    const marked = readFileSync(CHROME_PATH_MARKER, "utf8").trim();
    if (marked) {
      accessSync(marked);
      return marked;
    }
  }

  const cacheRoot = join(process.cwd(), ".browser-cache");
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
    // Platform layouts from @puppeteer/browsers (linux / mac / win).
    const candidates =
      browser === "chrome"
        ? [
            join(root, latest, "chrome-linux64", "chrome"),
            join(
              root,
              latest,
              "chrome-mac-x64",
              "Google Chrome for Testing.app",
              "Contents",
              "MacOS",
              "Google Chrome for Testing",
            ),
            join(
              root,
              latest,
              "chrome-mac-arm64",
              "Google Chrome for Testing.app",
              "Contents",
              "MacOS",
              "Google Chrome for Testing",
            ),
            join(root, latest, "chrome-win64", "chrome.exe"),
            join(root, latest, "chrome-win32", "chrome.exe"),
          ]
        : [
            join(root, latest, "chrome-linux", "chrome"),
            join(
              root,
              latest,
              "chrome-mac",
              "Chromium.app",
              "Contents",
              "MacOS",
              "Chromium",
            ),
            join(root, latest, "chrome-win", "chrome.exe"),
          ];
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
    "Chrome for Testing is required for browser e2e. Run `pnpm browser:install` (or set CHROME_BIN).",
  );
}

export async function createDriver(
  options: DriverOptions = {},
): Promise<WebDriver> {
  const chromeOptions = new chrome.Options();
  chromeOptions.setChromeBinaryPath(resolveChromeBinary());
  const headless = options.headless ?? defaultHeadless();
  if (headless) {
    chromeOptions.addArguments("--headless=new");
  }
  chromeOptions.addArguments("--window-size=1280,800", ...(options.args ?? []));
  // Keep --load-extension working on Chromium builds that gate the switch.
  chromeOptions.addArguments(
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  );
  if (inContainerOrCi()) {
    chromeOptions.addArguments("--no-sandbox", "--disable-dev-shm-usage");
  }
  if (options.userDataDir) {
    chromeOptions.addArguments(`--user-data-dir=${options.userDataDir}`);
  }
  if (options.extensionPath) {
    // Absolute path — Chrome hashes this for the unpacked extension id.
    const extensionPath = resolve(options.extensionPath);
    chromeOptions.addArguments(
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    );
  }
  return new Builder()
    .forBrowser(Browser.CHROME)
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
