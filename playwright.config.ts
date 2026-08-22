import { accessSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

if (!process.env.ROGATIO_SKIP_BROWSER_CHECK) {
  try {
    accessSync(chromium.executablePath());
  } catch {
    throw new Error(
      "Chromium is required for the F1 browser smoke test. Run `pnpm exec playwright install chromium`.",
    );
  }
}

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node scripts/serve-smoke.ts",
    url: "http://127.0.0.1:4173/browser-fixture.html",
    reuseExistingServer: !process.env.CI,
  },
});
