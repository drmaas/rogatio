/**
 * Install Chrome for Testing + matching ChromeDriver for Selenium browser e2e.
 * https://developer.chrome.com/docs/automation-and-testing/download-test-binaries
 * Usage: node scripts/install-browser.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Browser,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";

const cacheDir = resolve(import.meta.dirname, "../.browser-cache");
const chromePathMarker = resolve(cacheDir, "chrome-path.txt");
const chromedriverPathMarker = resolve(cacheDir, "chromedriver-path.txt");
// Channel tag per Chrome for Testing docs (`stable` | `beta` | `dev` | `canary`)
// or an exact build id. Override with ROGATIO_CHROME_TAG.
const tag = process.env.ROGATIO_CHROME_TAG ?? "stable";

const platform = detectBrowserPlatform();
if (!platform) {
  throw new Error("Unsupported platform for Chrome for Testing download");
}

const buildId = await resolveBuildId(Browser.CHROME, platform, tag);
const chrome = await install({
  browser: Browser.CHROME,
  buildId,
  platform,
  cacheDir,
});
const chromedriver = await install({
  browser: Browser.CHROMEDRIVER,
  buildId,
  platform,
  cacheDir,
});
mkdirSync(dirname(chromePathMarker), { recursive: true });
writeFileSync(chromePathMarker, `${chrome.executablePath}\n`, "utf8");
writeFileSync(
  chromedriverPathMarker,
  `${chromedriver.executablePath}\n`,
  "utf8",
);
console.log(`Installed ${chrome.browser}@${chrome.buildId}`);
console.log(chrome.executablePath);
console.log(`Installed ${chromedriver.browser}@${chromedriver.buildId}`);
console.log(chromedriver.executablePath);
