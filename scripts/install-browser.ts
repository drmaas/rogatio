/**
 * Install Chrome for Testing for Selenium browser e2e.
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
const pathMarker = resolve(cacheDir, "chrome-path.txt");
// Channel tag per Chrome for Testing docs (`stable` | `beta` | `dev` | `canary`)
// or an exact build id. Override with ROGATIO_CHROME_TAG.
const tag = process.env.ROGATIO_CHROME_TAG ?? "stable";

const platform = detectBrowserPlatform();
if (!platform) {
  throw new Error("Unsupported platform for Chrome for Testing download");
}

const buildId = await resolveBuildId(Browser.CHROME, platform, tag);
const installed = await install({
  browser: Browser.CHROME,
  buildId,
  platform,
  cacheDir,
});
mkdirSync(dirname(pathMarker), { recursive: true });
writeFileSync(pathMarker, `${installed.executablePath}\n`, "utf8");
console.log(`Installed ${installed.browser}@${installed.buildId}`);
console.log(installed.executablePath);
