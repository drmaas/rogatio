import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";

async function extensionContext() {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-f18-browser-"));
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

const project = {
  version: 1,
  name: "Real extension project",
  groups: [
    {
      id: "group-real",
      name: "Real group",
      origins: ["http://127.0.0.1:4173"],
      rules: [
        {
          id: "rule-real",
          name: "Real rule",
          urlRegex: "^http://127\\.0\\.0\\.1:4173/real$",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "redirect",
          redirect: { destination: "http://127.0.0.1:4173/redirected" },
        },
      ],
    },
  ],
};

test("drives the real extension page lifecycle and mounts the editor", async () => {
  const { context, profile, extensionId } = await extensionContext();
  const projectFile = join(profile, "project.json");
  await writeFile(projectFile, JSON.stringify(project));
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

    await page.setInputFiles('[data-import-input="true"]', projectFile);
    await expect(page.getByText("Project imported.")).toBeVisible();
    await page.getByRole("button", { name: "Review permissions" }).click();
    await expect(page.locator("[data-permission-summary]")).toContainText(
      "http://127.0.0.1:4173",
    );

    await page.locator('[data-group-toggle="true"]').check();
    await expect(page.locator('[data-group-toggle="true"]')).toBeChecked();
    await expect(page.locator("[data-rule-statuses] li")).toContainText(
      "needs permission",
    );
    await expect(
      page.locator("[data-editor-root] [data-rogatio-editor]"),
    ).toBeVisible();

    // The optional-host-permission prompt is intentionally not automated. The
    // real API is inspected to prove the current state is not falsely granted.
    const permissionState = await page.evaluate(async () =>
      chrome.permissions.contains({ origins: ["http://127.0.0.1:4173/*"] }),
    );
    expect(permissionState).toBe(false);

    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForTimeout(100);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
