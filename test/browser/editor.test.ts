import { expect, type Page, test } from "./fixtures.js";

async function openEditorGroup(page: Page, groupId: string): Promise<void> {
  await page.locator("[data-command='open-group-picker']").click();
  await page
    .locator(`[data-group-picker] [data-group-id="${groupId}"]`)
    .click();
}

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
      saveCalls: Array<{
        groups: Array<{
          rules: Array<{
            action?: {
              type: string;
              params: Array<{ name: string; value: string }>;
            };
          }>;
        }>;
      }>;
      setSaveMode(mode: string): void;
      resolveSave(index: number, result: unknown): void;
    };
    __promptValue?: string;
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
  await openEditorGroup(page, "group-one");
  await page
    .locator('[data-rule-card][data-rule-id="rule-one"]')
    .getByRole("button", { name: "Move rule down", exact: true })
    .click();
  await expect(
    page.locator('[data-rule-list="group-one"] [data-rule-card]').first(),
  ).toHaveAttribute("data-rule-id", "rule-two");
  await expect(
    page
      .locator('[data-rule-card][data-rule-id="rule-two"]')
      .getByRole("button", { name: "Move rule up", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-rule-card][data-rule-id="rule-two"]')
      .getByRole("button", { name: "Remove rule", exact: true }),
  ).toBeVisible();

  await page
    .locator('[data-rule-card][data-rule-id="rule-one"]')
    .getByRole("button", { name: "Copy rule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "First rule (copy)", exact: true }),
  ).toBeVisible();
  // The copy's id is derived from its copied name, not from a `rule-new` prefix.
  await expect(
    page.locator('[data-rule-card][data-rule-id^="FirstRule"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-rule-list="group-one"] [data-rule-card]'),
  ).toHaveCount(3);

  await page
    .locator("[data-section-heading]")
    .getByRole("button", { name: "Add rule" })
    .click();
  await expect(page.getByRole("heading", { name: "New rule" })).toBeVisible();
  await page.getByLabel("Search rules by name").fill("Second rule");
  const result = page.locator("[data-search-results] button").filter({
    hasText: "Second rule",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole("heading", { name: "One" })).toBeVisible();

  await page.locator("[data-route-breadcrumb] [data-route='project']").click();
  await openEditorGroup(page, "group-two");
  await expect(
    page.locator('[data-editor-command-bar] [data-command="move-group-up"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-editor-command-bar] [data-command="move-group-down"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-editor-command-bar] [data-command="add-rule"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-section-heading] [data-command="add-rule"]'),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-group-heading]")
      .getByRole("button", { name: "Copy group", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-group-heading]")
      .getByRole("button", { name: "Remove group", exact: true }),
  ).toBeVisible();
  await page
    .locator("[data-group-heading]")
    .locator('[data-command="copy-group"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "Two (copy)", exact: true }),
  ).toBeVisible();
  // Ids are no longer authored. What must still hold is that the copy is a
  // distinct entity whose id is derived from its own name, and is neither the
  // source group's id nor the source rule's id.
  const copiedRuleIds = await page
    .locator("[data-rule-card]")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-rule-id") ?? ""),
    );
  expect(copiedRuleIds).toHaveLength(1);
  expect(copiedRuleIds[0]).not.toBe("rule-three");
  expect(copiedRuleIds[0]).toMatch(/^ThirdRule/);
  // The copy's own names are distinct from the source's.
  await expect(page.locator("[data-group-heading] h2")).toHaveText(
    "Two (copy)",
  );

  await openEditorGroup(page, "group-two");
  await page
    .locator("[data-group-heading]")
    .locator('[data-command="remove-group"]')
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Two");
  await dialog.getByRole("button", { name: "Cancel removal" }).click();
  await expect(
    page.getByRole("button", { name: "Two", exact: true }),
  ).toBeVisible();
  await page
    .locator("[data-group-heading]")
    .locator('[data-command="remove-group"]')
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove group" })
    .click();
  await expect(
    page.locator("[data-group-list]").getByRole("button", {
      name: "Open group Two",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-group-list]").getByRole("button", {
      name: "Open group Two (copy)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Project", exact: true }),
  ).toBeVisible();
});

test("renders validation errors and never saves an invalid draft", async ({
  page,
}) => {
  await page.getByLabel("Project name").fill("");
  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Validate" })
    .click();

  await expect(page.getByRole("alert")).toContainText("Enter a project name.");
  await expect(page.getByLabel("Project name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  expect(await page.evaluate(() => window.editorTest.saveCalls)).toHaveLength(
    0,
  );
});

test("Enter in a heading's inline editor never saves the project", async ({
  page,
}) => {
  // Adding a group lands on an empty group page with the inline name editor
  // focused, which makes that input the form's only field. Every button in the
  // editor is `type="button"`, so the form has no submit button and the browser
  // applies implicit submission here. This journey is the only place that
  // behaviour is observable: the unit suite's DOM does not implement it.
  await page
    .locator('[data-section-heading] [data-command="add-group"]')
    .click();

  const nameEditor = page.locator("[data-group-heading] [data-rename-input]");
  await expect(nameEditor).toBeVisible();
  await expect(nameEditor).toBeFocused();
  // The trap state: no rules, so the inline editor is the only field on the page.
  await expect(page.locator("[data-rule-card]")).toHaveCount(0);

  await nameEditor.fill("Enter must not save");
  await page.keyboard.press("Enter");

  expect(await page.evaluate(() => window.editorTest.saveCalls)).toHaveLength(
    0,
  );
  // The name was committed instead, and the editor closed.
  await expect(page.locator("[data-group-heading] h2")).toHaveText(
    "Enter must not save",
  );
  await expect(page.locator("[data-rename-input]")).toHaveCount(0);
  await expect(page.locator("[data-dirty-state]")).toHaveText(
    "Unsaved changes",
  );
});

test("supports keyboard commands and exposes screen-reader error associations", async ({
  page,
}) => {
  const projectName = page.getByLabel("Project name");
  await projectName.fill("");
  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Validate" })
    .focus();
  await page.keyboard.press("Enter");

  await expect(projectName).toHaveAttribute("aria-invalid", "true");
  const describedBy = await projectName.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`).first()).toContainText(
    "Enter a project name.",
  );

  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Cancel" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("converts URLs without executing or mutating on invalid input", async ({
  page,
}) => {
  await openEditorGroup(page, "group-one");
  await page.evaluate(() => {
    window.__promptValue = "https://example.com/a.b?x=1";
    Object.defineProperty(window, "prompt", {
      value: () => window.__promptValue ?? null,
      writable: true,
      configurable: true,
    });
  });
  await page
    .locator('[data-rule-id="rule-one"][data-command="convert-url"]')
    .click();
  await expect(
    page
      .locator('[data-rule-card][data-rule-id="rule-one"]')
      .getByLabel("Regular expression", { exact: true }),
  ).toHaveValue("^https://example\\.com/a\\.b\\?x=1$");

  await page.evaluate(() => {
    window.__promptValue = "https://example.com/#fragment";
  });
  await page
    .locator('[data-rule-id="rule-one"][data-command="convert-url"]')
    .click();
  await expect(page.getByRole("alert")).toContainText("valid request URL");
  await expect(
    page
      .locator('[data-rule-card][data-rule-id="rule-one"]')
      .getByLabel("Regular expression", { exact: true }),
  ).toHaveValue("^https://example\\.com/a\\.b\\?x=1$");
});

test("aborts URL conversion when prompt is cancelled", async ({ page }) => {
  await openEditorGroup(page, "group-one");
  await page.evaluate(() => {
    Object.defineProperty(window, "prompt", {
      value: () => null,
      writable: true,
      configurable: true,
    });
  });
  const before = await page.evaluate(
    () => window.editorController.getDraft().name,
  );
  await page
    .locator('[data-rule-id="rule-one"][data-command="convert-url"]')
    .click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  const after = await page.evaluate(
    () => window.editorController.getDraft().name,
  );
  expect(before).toBe(after);
});

test("preserves draft on save failure and prevents pending-save races", async ({
  page,
}) => {
  await page.getByLabel("Project name").fill("Retry project");
  await page.evaluate(() => window.editorTest.setSaveMode("fail"));
  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not save");
  await expect(page.getByLabel("Project name")).toHaveValue("Retry project");
  expect(await page.evaluate(() => window.editorTest.saveCalls)).toHaveLength(
    1,
  );

  await page.evaluate(() => window.editorTest.setSaveMode("pending"));
  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page
      .locator("[data-editor-command-bar]")
      .getByRole("button", { name: "Cancel" }),
  ).toBeDisabled();
  await expect(page.locator("[data-action-dock]")).toHaveCount(0);
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await page.evaluate(() => window.editorTest.resolveSave(0, { ok: true }));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("keeps route and mobile navigation accessible at narrow width and zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("[data-desktop-route-rail]")).toBeVisible();
  await expect(page.locator("[data-mobile-route-nav]")).toHaveCount(0);
  await openEditorGroup(page, "group-one");
  await expect(page.getByRole("heading", { name: "One" })).toBeVisible();

  await page.locator("[data-route-breadcrumb] [data-route='project']").click();
  await expect(
    page.getByRole("heading", { name: "Project", exact: true }),
  ).toBeVisible();

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await expect(
    page
      .locator("[data-editor-command-bar]")
      .getByRole("button", { name: "Validate" }),
  ).toBeVisible();
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
    const picker = root.querySelector<HTMLButtonElement>(
      "[data-command='open-group-picker']",
    );
    picker?.click();
    const routeButtons = root.querySelectorAll<HTMLButtonElement>(
      "[data-group-picker] button[data-route='group']",
    );
    for (const btn of routeButtons) {
      if (
        btn.querySelector("[data-group-picker-name]")?.textContent ===
        "Extension group"
      ) {
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

test("selects the Query parameters rule type and round-trips the action through save", async ({
  page,
}) => {
  await openEditorGroup(page, "group-one");
  const card = page
    .locator("[data-rule-card]")
    .filter({ hasText: "First rule" })
    .first();

  const select = card.locator('[data-rule-type-select="true"]');
  await expect(select).toBeVisible();
  await select.selectOption({ label: "Query parameters" });

  const nameInput = page
    .locator('[data-path$="/action/params/0/name"]')
    .first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill("utm_source");
  const valueInput = page
    .locator('[data-path$="/action/params/0/value"]')
    .first();
  await valueInput.fill("rogatio");

  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Validate" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const saved = await page.evaluate(() => window.editorTest.saveCalls.at(-1));
  expect(saved?.groups?.[0]?.rules?.[0]?.action).toEqual({
    type: "query",
    params: [{ name: "utm_source", operation: "set", value: "rogatio" }],
  });
});

test("runs one test, keeps misses collapsed, opens the named rule, and labels a disabled group", async ({
  page,
}) => {
  await page.evaluate(() => {
    const draft = window.editorController.getDraft();
    window.editorController.destroy();
    const root = document.querySelector("#editor-root");
    if (!root) throw new Error("missing editor root");
    const dimension = (state: string, detail: string) => ({ state, detail });
    window.editorController = window.editorModule.createEditor({
      root,
      initialProject: draft,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: (groupId: string) => groupId !== "group-two",
        setEnabled: () => undefined,
      },
      dryRun: () => ({
        summary: {
          caseCount: 1,
          urlCount: 1,
          matchedUrlCount: 1,
          matchedRuleTotal: 2,
        },
        errors: [],
        results: [
          {
            url: "https://one.example/first",
            rules: [
              {
                groupId: "group-one",
                ruleId: "rule-one",
                matched: true,
                source: dimension("matched", "url"),
                method: dimension("matched", "GET"),
                resourceType: dimension("matched", "main_frame"),
                actionPreview: null,
              },
              {
                groupId: "group-one",
                ruleId: "rule-two",
                matched: false,
                source: dimension("unmatched", "miss"),
                method: dimension("matched", "GET"),
                resourceType: dimension("unmatched", "script"),
                actionPreview: null,
              },
              {
                groupId: "group-two",
                ruleId: "rule-three",
                matched: true,
                source: dimension("matched", "url"),
                method: dimension("matched", "GET"),
                resourceType: dimension("matched", "main_frame"),
                actionPreview: {
                  kind: "redirect",
                  summary: "https://two.example/elsewhere",
                },
              },
            ],
          },
        ],
      }),
    }) as Window["editorController"];
  });

  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Test console", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run test", exact: true }),
  ).toHaveCount(1);

  await page.locator("[data-test-urls]").fill("https://one.example/first");
  await page.getByRole("button", { name: "Run test", exact: true }).click();

  const misses = page.locator("details[data-test-misses]");
  await expect(misses).toHaveCount(1);
  await expect(misses).not.toHaveAttribute("open");
  await expect(misses.locator("summary")).toHaveText("1 rule did not match");
  await expect(
    misses.getByRole("button", { name: "Second rule", exact: true }),
  ).toBeHidden();

  await page
    .locator("[data-test-outcome]")
    .getByRole("button", { name: "First rule", exact: true })
    .click();
  await expect(
    page.locator('[data-rule-card][data-rule-id="rule-one"]'),
  ).toBeVisible();

  await page
    .locator("[data-editor-command-bar]")
    .getByRole("button", { name: "Test console", exact: true })
    .click();
  await expect(
    page.getByText(
      "This group is off in Chrome, so the browser will not apply this rule.",
    ),
  ).toBeVisible();
});
