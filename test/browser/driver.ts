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

export const CHROMEDRIVER_PATH_MARKER = join(
  process.cwd(),
  ".browser-cache",
  "chromedriver-path.txt",
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

function readMarker(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const marked = readFileSync(path, "utf8").trim();
  if (!marked) return undefined;
  accessSync(marked);
  return marked;
}

/**
 * Resolve Chrome for Testing (via `pnpm browser:install` / `@puppeteer/browsers`).
 * Prefer CfT over branded Google Chrome — branded builds dropped `--load-extension`.
 * Explicit `ROGATIO_CHROME_PATH` wins; `CHROME_BIN` is last so CI images that export
 * `/usr/bin/google-chrome` do not override the installed CfT binary.
 * @see https://developer.chrome.com/docs/automation-and-testing/download-test-binaries
 */
export function resolveChromeBinary(): string {
  const explicit =
    process.env.ROGATIO_CHROME_PATH ?? process.env.ROGATIO_CHROMIUM_PATH;
  if (explicit) {
    accessSync(explicit);
    return explicit;
  }

  const marked = readMarker(CHROME_PATH_MARKER);
  if (marked) return marked;

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

  const envPath = process.env.CHROME_BIN;
  if (envPath) {
    accessSync(envPath);
    return envPath;
  }

  throw new Error(
    "Chrome for Testing is required for browser e2e. Run `pnpm browser:install` (or set ROGATIO_CHROME_PATH).",
  );
}

export function resolveChromeDriverBinary(): string | undefined {
  const envPath =
    process.env.CHROMEDRIVER_PATH ?? process.env.ROGATIO_CHROMEDRIVER_PATH;
  if (envPath) {
    accessSync(envPath);
    return envPath;
  }
  return readMarker(CHROMEDRIVER_PATH_MARKER);
}

export async function createDriver(
  options: DriverOptions = {},
): Promise<WebDriver> {
  const chromeOptions = new chrome.Options();
  chromeOptions.setChromeBinaryPath(resolveChromeBinary());
  // Unpacked extensions are unreliable under headless=new on some CI images.
  const headless =
    options.extensionPath !== undefined
      ? false
      : (options.headless ?? defaultHeadless());
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

  const builder = new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(chromeOptions);

  const chromedriverPath = resolveChromeDriverBinary();
  if (chromedriverPath) {
    builder.setChromeService(new chrome.ServiceBuilder(chromedriverPath));
  }

  return builder.build();
}

export function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith("chrome-extension://")) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalized}`;
}
