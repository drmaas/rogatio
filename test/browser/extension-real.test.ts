import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";

const project = {
  version: 2,
  name: "Real extension project",
  groups: [
    {
      id: "group-real",
      name: "Real group",
      rules: [
        {
          id: "rule-real",
          name: "Real rule",
          source: {
            key: "url",
            operator: "regex",
            value: "^http://127\\.0\\.0\\.1:4173/real$",
          },
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "redirect",
          redirect: { destination: "http://127.0.0.1:4173/redirected" },
        },
      ],
    },
  ],
};

test("drives the real extension page lifecycle and mounts the editor", async ({
  registerDriver,
}) => {
  const { page, profile, extensionId, driver, close } =
    await extensionContext();
  registerDriver(driver, close);
  const projectFile = join(profile, "project.json");
  await writeFile(projectFile, JSON.stringify(project));
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  await page.locator('[data-import-input="true"]').setInputFiles(projectFile);
  await expect(page.getByText("Project imported.")).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  await page.locator('[data-group-toggle="true"]').check();
  await expect(page.locator('[data-group-toggle="true"]')).toBeChecked();
  await expect(page.locator("[data-rule-statuses] li")).toContainText("active");
  await expect(
    page.locator("[data-editor-root] [data-rogatio-editor]"),
  ).toBeVisible();

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
});
