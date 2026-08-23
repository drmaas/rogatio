import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    editorController: {
      getDraft(): { name: string };
      destroy(): void;
    };
    editorModule: {
      createEditor(options: Record<string, unknown>): unknown;
    };
    editorTest: {
      saveCalls: unknown[];
      setSaveMode(mode: string): void;
      resolveSave(index: number, result: unknown): void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/editor-fixture.html");
});

test("mounts an accessible editor and edits detached project metadata", async ({
  page,
}) => {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Editor project" }),
  ).toBeVisible();
  await expect(page.getByLabel("Project name")).toHaveValue("Editor project");

  await page.getByLabel("Project name").fill("Changed project");

  await expect(page.getByText("Unsaved changes")).toBeVisible();
  expect(
    await page.evaluate(() => window.editorController.getDraft().name),
  ).toBe("Changed project");
  expect(await page.evaluate(() => window.editorTest.saveCalls)).toEqual([]);
});

test("supports search, routes, CRUD, source-order reordering, and confirmation", async ({
  page,
}) => {
  await page
    .locator("[data-desktop-route-rail]")
    .getByRole("button", { name: "One", exact: true })
    .click();
  await page.getByRole("button", { name: "Move rule First rule down" }).click();
  await expect(
    page.locator('[data-rule-list="group-one"] [data-rule-card]').first(),
  ).toHaveAttribute("data-rule-id", "rule-two");

  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("heading", { name: "New rule" })).toBeVisible();
  await page.getByLabel("Search project").fill("Second rule");
  const result = page.locator("[data-search-results] button").filter({
    hasText: "Second rule",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole("heading", { name: "One" })).toBeVisible();

  await page
    .locator("[data-desktop-route-rail]")
    .getByRole("button", { name: "Project", exact: true })
    .click();
  await page
    .locator("[data-desktop-route-rail]")
    .getByRole("button", { name: "Two", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove group Two", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Two");
  await dialog.getByRole("button", { name: "Cancel removal" }).click();
  await expect(
    page.getByRole("button", { name: "Two", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove group Two", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove group" })
    .click();
  await expect(page.getByRole("button", { name: "Two" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Project", exact: true }),
  ).toBeVisible();
});

test("renders validation errors and never saves an invalid draft", async ({
  page,
}) => {
  await page.getByLabel("Project name").fill("");
  await page.getByRole("button", { name: "Validate" }).click();

  await expect(page.getByRole("alert")).toContainText("Enter a project name.");
  await expect(page.getByLabel("Project name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => window.editorTest.saveCalls)).toHaveLength(
    0,
  );
});

test("supports keyboard commands and exposes screen-reader error associations", async ({
  page,
}) => {
  const projectName = page.getByLabel("Project name");
  await projectName.fill("");
  await page.getByRole("button", { name: "Validate" }).focus();
  await page.keyboard.press("Enter");

  await expect(projectName).toHaveAttribute("aria-invalid", "true");
  const describedBy = await projectName.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`).first()).toContainText(
    "Enter a project name.",
  );

  await page.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("converts URLs without executing or mutating on invalid input", async ({
  page,
}) => {
  await page
    .locator("[data-desktop-route-rail]")
    .getByRole("button", { name: "One", exact: true })
    .click();
  await page
    .getByLabel("URL to match exactly for First rule")
    .fill("https://example.com/a.b?x=1");
  await page
    .getByRole("button", { name: "Convert URL to exact regex for First rule" })
    .click();
  await expect(
    page.getByLabel("URL regular expression for First rule"),
  ).toHaveValue("^https://example\\.com/a\\.b\\?x=1$");

  await page
    .getByLabel("URL to match exactly for First rule")
    .fill("https://example.com/#fragment");
  await page
    .getByRole("button", { name: "Convert URL to exact regex for First rule" })
    .click();
  await expect(page.getByRole("alert")).toContainText("valid request URL");
  await expect(
    page.getByLabel("URL regular expression for First rule"),
  ).toHaveValue("^https://example\\.com/a\\.b\\?x=1$");
});

test("preserves draft on save failure and prevents pending-save races", async ({
  page,
}) => {
  await page.getByLabel("Project name").fill("Retry project");
  await page.evaluate(() => window.editorTest.setSaveMode("fail"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not save");
  await expect(page.getByLabel("Project name")).toHaveValue("Retry project");
  expect(await page.evaluate(() => window.editorTest.saveCalls)).toHaveLength(
    1,
  );

  await page.evaluate(() => window.editorTest.setSaveMode("pending"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await page.evaluate(() => window.editorTest.resolveSave(1, { ok: true }));
  await expect(page.getByText("Saved")).toBeVisible();
});

test("keeps route and mobile navigation accessible at narrow width and zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("[data-desktop-route-rail]")).toBeHidden();
  const mobileNavigation = page.locator("[data-mobile-route-nav] select");
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.selectOption({ label: "One" });
  await expect(page.getByRole("heading", { name: "One" })).toBeVisible();

  // Navigate back to project to test project-level fields
  await mobileNavigation.selectOption({ label: "Project" });
  await expect(
    page.getByRole("heading", { name: "Project", exact: true }),
  ).toBeVisible();

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Validate" })).toBeVisible();
  await page.getByLabel("Project name").focus();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("rejects accessor-backed initial data without reading the accessor", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const root = document.createElement("div");
    document.body.append(root);
    let read = false;
    const value = {
      version: 1,
      groups: [],
    };
    Object.defineProperty(value, "name", {
      enumerable: true,
      get() {
        read = true;
        return "hostile";
      },
    });
    try {
      window.editorModule.createEditor({
        root,
        initialProject: value,
        validate: () => [],
        save: () => ({ ok: true }),
      });
    } catch (error) {
      return {
        read,
        error: error instanceof Error ? error.name : "unknown",
        children: root.childElementCount,
      };
    }
    return { read, error: "none", children: root.childElementCount };
  });

  expect(result).toEqual({
    read: false,
    error: "EditorInitializationError",
    children: 0,
  });
});

test("rejects cyclic and sparse initial data without partially mounting", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const outcomes: Array<{ kind: string; mounted: number }> = [];
    for (const kind of ["cycle", "sparse"] as const) {
      const root = document.createElement("div");
      document.body.append(root);
      let value: Record<string, unknown>;
      if (kind === "cycle") {
        value = { version: 1, name: "cycle", groups: [] };
        value.self = value;
      } else {
        const groups: Array<Record<string, unknown>> = [];
        groups.length = 1;
        Object.setPrototypeOf(groups, {
          0: {
            id: "inherited",
            name: "Inherited",
            origins: ["https://example.com"],
            rules: [],
          },
        });
        value = { version: 1, name: "sparse", groups };
      }
      try {
        window.editorModule.createEditor({
          root,
          initialProject: value,
          validate: () => [],
          save: () => ({ ok: true }),
        });
        outcomes.push({ kind, mounted: root.childElementCount });
      } catch {
        outcomes.push({ kind, mounted: root.childElementCount });
      }
    }
    return outcomes;
  });

  expect(result).toEqual([
    { kind: "cycle", mounted: 0 },
    { kind: "sparse", mounted: 0 },
  ]);
});

test("isolates controlled rule-type extensions and rejects duplicate registrations", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const root = document.createElement("div");
    document.body.append(root);
    const project = {
      version: 1,
      name: "Extension project",
      groups: [
        {
          id: "extension-group",
          name: "Extension group",
          origins: ["https://example.com"],
          rules: [
            {
              id: "extension-rule",
              name: "Extension rule",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              extensionValue: "before",
            },
          ],
        },
      ],
    };
    const extension = {
      id: "fixture-extension",
      label: "Fixture extension",
      matches: (rule: Readonly<Record<string, unknown>>) =>
        rule.extensionValue !== undefined,
      mount: (context: {
        document: Document;
        container: HTMLElement;
        rulePath: string;
        getField: (name: string) => unknown;
        setField: (name: string, value: unknown) => void;
        deleteField: (name: string) => void;
        registerControl: (fieldPath: string, control: HTMLElement) => void;
      }) => {
        const label = context.document.createElement("label");
        label.textContent = "Extension value";
        const input = context.document.createElement("input");
        input.value = String(context.getField("extensionValue") ?? "");
        input.addEventListener("input", () =>
          context.setField("extensionValue", input.value),
        );
        label.append(input);
        context.container.append(label);
        context.registerControl("/extensionValue", input);
        return { destroy() {} };
      },
      validate: () => [],
    };
    const controller = window.editorModule.createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      ruleTypes: [extension],
    }) as {
      getDraft(): {
        groups: Array<{ rules: Array<Record<string, unknown>> }>;
      };
    };
    // Navigate to the group to render the rule card with extension
    const routeButtons = root.querySelectorAll<HTMLButtonElement>(
      '[data-desktop-route-rail] button[data-route="group"]',
    );
    for (const btn of routeButtons) {
      if (btn.textContent === "Extension group") {
        btn.click();
        break;
      }
    }
    const extensionInput = root.querySelector(
      '[data-extension-fields="fixture-extension"] input',
    ) as HTMLInputElement;
    if (!extensionInput) {
      return { extensionVisible: false, draft: null, duplicate: false };
    }
    extensionInput.value = "after";
    extensionInput.dispatchEvent(new Event("input", { bubbles: true }));
    const draft = controller.getDraft().groups[0]?.rules[0]?.extensionValue;
    let duplicate = false;
    try {
      window.editorModule.createEditor({
        root: document.createElement("div"),
        initialProject: project,
        validate: () => [],
        save: () => ({ ok: true }),
        ruleTypes: [extension, { ...extension }],
      });
    } catch {
      duplicate = true;
    }
    return {
      extensionVisible: Boolean(extensionInput),
      draft,
      duplicate,
    };
  });

  expect(result.extensionVisible).toBe(true);
  expect(result.draft).toBe("after");
  expect(result.duplicate).toBe(true);
});

test("ships a browser artifact without Node runtime leakage", async ({
  page,
  request,
}) => {
  const response = await request.get("/editor/index.js");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).not.toMatch(/node:|process\.|Buffer|fs\/|path\//);
  await expect(page.locator("[data-rogatio-editor]")).toBeVisible();
});
