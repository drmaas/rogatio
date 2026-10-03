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
  const extensionless = join(profile, "checkout-mocks");
  const invalidFile = join(profile, "package.json");
  await writeFile(projectFile, JSON.stringify(project));
  await writeFile(extensionless, JSON.stringify(project));
  await writeFile(
    invalidFile,
    JSON.stringify({ name: "pkg", version: "1.0.0" }),
  );
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  const importInput = page.locator('[data-import-input="true"]');
  await importInput.setInputFiles(invalidFile);
  await expect(page.getByText(/^not a Rogatio project:/)).toBeVisible();
  await importInput.setInputFiles(extensionless);
  await expect(page.getByText("Project imported.")).toBeVisible();
  await importInput.setInputFiles(projectFile);
  await expect(page.getByText("Project imported.")).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  await page
    .locator('[data-desktop-route-rail] [data-group-id="group-real"]')
    .click();
  const enable = page.locator("[data-group-heading] [data-group-enable]");
  await expect(enable).toHaveText("Enable");
  await enable.click();
  await expect(enable).toHaveText("Disable");
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
