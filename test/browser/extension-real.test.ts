import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";

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
  const { page, profile, extensionId, close } = await extensionContext();
  const projectFile = join(profile, "project.json");
  await writeFile(projectFile, JSON.stringify(project));
  try {
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

    await page.locator('[data-import-input="true"]').setInputFiles(projectFile);
    await expect(page.getByText("Project imported.")).toBeVisible();
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Review permissions" }).click();
    await expect(page.locator("[data-permission-summary]")).toContainText(
      "http://127.0.0.1:4173",
    );

    await page.locator('[data-group-toggle="true"]').check();
    await expect(page.locator('[data-group-toggle="true"]')).toBeChecked();
    await expect(page.locator("[data-rule-statuses] li")).toContainText(
      "needs permission",
    );
    // The editor lives on the Workspace view (Dashboard is the landing page).
    await page.getByRole("button", { name: "Workspace" }).click();
    await expect(
      page.locator("[data-editor-root] [data-rogatio-editor]"),
    ).toBeVisible();

    // The optional-host-permission prompt is intentionally not automated. The
    // real API is inspected to prove the current state is not falsely granted.
    const permissionState = await page.evaluate(async () =>
      chrome.permissions.contains({ origins: ["http://127.0.0.1:4173/*"] }),
    );
    expect(permissionState).toBe(false);

    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.locator('[data-command="create"]').click();
    try {
      const alert = await page.driver.switchTo().alert();
      await alert.dismiss();
    } catch {
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  } finally {
    await close();
  }
});
