import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { chromium } from "@playwright/test";

export interface ExtensionContext {
  readonly context: BrowserContext;
  readonly profile: string;
  readonly extensionId: string;
}

// Launches a persistent context with the built extension loaded. Callers own
// teardown: close the context and remove the profile directory.
export async function extensionContext(): Promise<ExtensionContext> {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-browser-"));
  const extensionPath = join(process.cwd(), "packages/extension/dist");
  const digest = createHash("sha256").update(extensionPath).digest();
  let extensionId = "";
  for (let i = 0; i < 16; i += 1) {
    extensionId += String.fromCharCode(97 + (digest[i] >> 4));
    extensionId += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  return { context, profile, extensionId };
}
