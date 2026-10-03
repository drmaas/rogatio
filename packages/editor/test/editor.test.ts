// @vitest-environment happy-dom

import { LIMITS } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import {
  builtInRuleTypes,
  createEditor,
  queryRuleType,
  urlToExactRegex,
} from "../src/index.js";

const emptyProject = {
  version: 2,
  name: "Editor project",
  groups: [
    {
      id: "group-one",
      name: "One",
      rules: [
        {
          id: "rule-new",
          name: "New rule",
          source: { key: "url", operator: "regex", value: "" },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
      ],
    },
  ],
} as const;

function openListedGroup(root: ParentNode, groupId?: string): void {
  root
    .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const selector = groupId
    ? `[data-group-picker] button[data-group-id="${groupId}"]`
    : "[data-group-picker] button[data-route='group']";
  root
    .querySelector<HTMLButtonElement>(selector)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function createTestEditor(initialProject: unknown = emptyProject) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject,
    validate: () => [],
    save: () => ({ ok: true }),
  });
  openListedGroup(root);
  return { root, editor };
}

function headerProject(fields: Record<string, unknown>) {
  return {
    version: 2,
    name: "Editor project",
    groups: [
      {
        id: "group-one",
        name: "One",
        rules: [
          {
            id: "rule-header",
            name: "Header rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/",
            },
            resourceTypes: ["main_frame"],
            priority: 100,
            type: "header",
            ...fields,
          },
        ],
      },
    ],
  };
}

function headerOperationSelect(root: HTMLElement): HTMLSelectElement {
  const headerRoot = root.querySelector('[data-extension-fields="header"]');
  const select = headerRoot?.querySelectorAll("select")[1];
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error("header operation select not found");
  }
  return select;
}

function headerValueLabel(root: HTMLElement): HTMLLabelElement | undefined {
  const headerRoot = root.querySelector('[data-extension-fields="header"]');
  return Array.from(headerRoot?.querySelectorAll("label") ?? []).find((label) =>
    label.textContent?.startsWith("Header value"),
  );
}

function selectRuleType(root: HTMLElement, typeId: string): void {
  const select = root.querySelector(
    "select[data-rule-type-select]",
  ) as HTMLSelectElement | null;
  if (!select) throw new Error("rule type select not found");
  select.value = typeId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("@rogatio/editor URL conversion", () => {
  it("serializes and escapes an absolute URL as an exact source", () => {
    expect(urlToExactRegex("HTTPS://Example.COM:443/a.b?x=1&x=2")).toEqual({
      ok: true,
      source: "^https://example\\.com/a\\.b\\?x=1&x=2$",
    });
  });

  it("adds the URL serializer's empty path and preserves encoded query data", () => {
    expect(urlToExactRegex("https://example.com")).toEqual({
      ok: true,
      source: "^https://example\\.com/$",
    });
    expect(urlToExactRegex("https://example.com/a%2Fb?q=a%2Bb&q=a+b")).toEqual({
      ok: true,
      source: "^https://example\\.com/a%2Fb\\?q=a%2Bb&q=a\\+b$",
    });
  });

  it("rejects unsafe or non-request URL inputs without producing a source", () => {
    for (const value of [
      "https://user:pass@example.com/",
      "https://example.com/#fragment",
      " https://example.com/",
      "https://example.com/\n",
      "ftp://example.com/",
      "not a URL",
      "",
    ]) {
      expect(urlToExactRegex(value)).toMatchObject({
        ok: false,
        code: "editor.invalid-url",
      });
    }
  });

  it("rejects a generated source over the F2 regex bound", () => {
    const result = urlToExactRegex(
      `https://example.com/${"a".repeat(LIMITS.maxUrlRegexLength)}`,
    );

    expect(result).toEqual({ ok: false, code: "editor.url-too-long" });
  });

  it("does not treat URL text as a regex or add flags", () => {
    const result = urlToExactRegex("https://example.com/(a)+[b]|c");

    expect(result).toEqual({
      ok: true,
      source: "^https://example\\.com/\\(a\\)\\+\\[b\\]\\|c$",
    });
  });
});

describe("@rogatio/editor built-in rule types", () => {
  it("registers header, redirect, query, request-body, and response-body", () => {
    expect(builtInRuleTypes.map((extension) => extension.id)).toEqual([
      "header",
      "redirect",
      "query",
      "response-body",
      "request-body",
    ]);
  });
});

describe("@rogatio/editor rule type selection", () => {
  it("lists Header and Redirect in the built-in rule type select", () => {
    const { root } = createTestEditor();
    const select = root.querySelector(
      "select[data-rule-type-select]",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(
      Array.from(select?.options ?? []).map((option) => option.value),
    ).toEqual([
      "",
      "header",
      "redirect",
      "query",
      "response-body",
      "request-body",
    ]);
  });

  it("writes header defaultFields when Header is selected on a new rule", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "header");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("header");
    expect(rule.headerDirection).toBe("request");
    expect(rule.headerOperation).toBe("set");
    expect(rule.headerName).toBe("");
    expect(rule.headerValue).toBe("");
  });

  it("writes redirect.defaultAction when Redirect is selected on a new rule", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "redirect");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("redirect");
    expect(rule.redirect).toEqual({ destination: "" });
  });

  it("writes requestBody when Request body is selected on a new rule", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "request-body");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("request-body");
    expect(rule.requestBody).toEqual({ mode: "replace", body: "" });
  });

  it("writes responseBody when Response body is selected on a new rule", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "response-body");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("response-body");
    expect(rule.responseBody).toEqual({ mode: "replace", body: "" });
  });

  it("clears stale header fields when switching to query", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "header");
    selectRuleType(root, "query");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("query");
    expect(rule.headerDirection).toBeUndefined();
    expect(rule.headerOperation).toBeUndefined();
    expect(rule.headerName).toBeUndefined();
    expect(rule.headerValue).toBeUndefined();
    expect(rule.action).toEqual({
      type: "query",
      params: [{ name: "", operation: "set", value: "" }],
    });
  });

  it("clears requestBody and responseBody when switching type", () => {
    const { root, editor } = createTestEditor();
    selectRuleType(root, "request-body");
    selectRuleType(root, "response-body");
    let rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.requestBody).toBeUndefined();
    expect(rule.responseBody).toEqual({ mode: "replace", body: "" });
    selectRuleType(root, "header");
    rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.responseBody).toBeUndefined();
    expect(rule.requestBody).toBeUndefined();
    expect(rule.headerOperation).toBe("set");
  });

  it("shows header value for an existing set rule and hides it for remove", () => {
    const setEditor = createTestEditor(
      headerProject({
        headerDirection: "request",
        headerOperation: "set",
        headerName: "X-Rogatio-Sample",
        headerValue: "enabled",
      }),
    );
    expect(headerValueLabel(setEditor.root)?.hidden).toBe(false);
    expect(setEditor.editor.getDraft().groups[0]?.rules[0]?.headerValue).toBe(
      "enabled",
    );

    const removeEditor = createTestEditor(
      headerProject({
        headerDirection: "response",
        headerOperation: "remove",
        headerName: "X-Test-Header",
      }),
    );
    expect(headerValueLabel(removeEditor.root)?.hidden).toBe(true);
    expect(
      removeEditor.editor.getDraft().groups[0]?.rules[0]?.headerValue,
    ).toBeUndefined();
  });

  it("drops append from the operation select after the user switches away", () => {
    const { root } = createTestEditor(
      headerProject({
        headerDirection: "request",
        headerOperation: "append",
        headerName: "X-Test",
        headerValue: "1",
      }),
    );
    const operationSelect = headerOperationSelect(root);
    expect(
      Array.from(operationSelect.options).map((option) => option.value),
    ).toEqual(["set", "append", "remove"]);
    operationSelect.value = "set";
    operationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(
      Array.from(headerOperationSelect(root).options).map(
        (option) => option.value,
      ),
    ).toEqual(["set", "remove"]);
  });
});

describe("@rogatio/editor query rule type", () => {
  const rulePath = "/groups/0/rules/0";

  it("registers the query rule type as a built-in extension", () => {
    expect(builtInRuleTypes.map((e) => e.id)).toContain("query");
  });

  it("matches only rules whose type is query", () => {
    expect(
      queryRuleType.matches({
        type: "query",
        action: { type: "query", params: [{ name: "a", value: "1" }] },
      }),
    ).toBe(true);
    expect(
      queryRuleType.matches({
        type: "redirect",
        action: { type: "query", params: [{ name: "a", value: "1" }] },
      }),
    ).toBe(false);
    expect(queryRuleType.matches({})).toBe(false);
  });

  it("validates query params and rejects empty or duplicate names", () => {
    const ok = queryRuleType.validate(
      { action: { type: "query", params: [{ name: "a", value: "1" }] } },
      rulePath,
    );
    expect(ok).toHaveLength(0);

    const empty = queryRuleType.validate(
      { action: { type: "query", params: [{ name: "", value: "1" }] } },
      rulePath,
    );
    expect(
      empty.some((d) => d.code === "editor.query-param-name-required"),
    ).toBe(true);

    const dup = queryRuleType.validate(
      {
        action: {
          type: "query",
          params: [
            { name: "a", value: "1" },
            { name: "a", value: "2" },
          ],
        },
      },
      rulePath,
    );
    expect(dup.some((d) => d.code === "editor.query-duplicate-param")).toBe(
      true,
    );
  });
});

describe("@rogatio/editor resource type hints", () => {
  it("shows glosses and groups for resource type checkboxes", () => {
    const { root } = createTestEditor();
    const fieldset = Array.from(root.querySelectorAll("fieldset")).find(
      (el) => el.querySelector("legend")?.textContent === "Resource types",
    );
    expect(fieldset).toBeTruthy();
    expect(fieldset?.querySelector("[data-editor-hint]")?.textContent).toBe(
      "Chrome request categories this rule can match.",
    );

    const groupLabels = Array.from(
      fieldset?.querySelectorAll("[data-editor-check-group-label]") ?? [],
    ).map((el) => el.textContent);
    expect(groupLabels).toEqual(["Page", "Assets", "Network", "Other"]);
    expect(fieldset?.querySelectorAll("[data-editor-check-group]").length).toBe(
      4,
    );
    const pageGroup = fieldset
      ?.querySelectorAll("[data-editor-check-group]")
      .item(0);
    expect(
      Array.from(
        pageGroup?.querySelectorAll("input[data-resource-type]") ?? [],
      ).map((el) => el.getAttribute("data-resource-type")),
    ).toEqual(["main_frame", "sub_frame"]);

    const mainFrame = fieldset?.querySelector(
      'input[data-resource-type="main_frame"]',
    ) as HTMLInputElement | null;
    expect(mainFrame).toBeTruthy();
    expect(mainFrame?.checked).toBe(true);
    expect(mainFrame?.title).toBe("Top-level page navigation");
    const mainLabel = mainFrame?.closest("label");
    expect(
      mainLabel?.querySelector("[data-editor-check-id]")?.textContent,
    ).toBe("main_frame");
    expect(mainLabel?.querySelector("small")?.textContent).toBe(
      "Top-level page navigation",
    );

    const xhr = fieldset?.querySelector(
      'input[data-resource-type="xmlhttprequest"]',
    ) as HTMLInputElement | null;
    expect(xhr?.closest("label")?.querySelector("small")?.textContent).toBe(
      "XHR and fetch",
    );

    const checkboxes = fieldset?.querySelectorAll("input[data-resource-type]");
    expect(checkboxes?.length).toBe(15);
  });
});

describe("@rogatio/editor source controls", () => {
  it("renders source key select and regex value field", () => {
    const hostProject = {
      version: 2,
      name: "Host project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-host",
              name: "Host rule",
              source: {
                key: "host",
                operator: "regex",
                value: "^example\\.com$",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
            },
          ],
        },
      ],
    };
    const { root, editor } = createTestEditor(hostProject);
    const keySelect = root.querySelector(
      'select[data-path="/groups/0/rules/0/source/key"]',
    ) as HTMLSelectElement | null;
    const valueField = root.querySelector(
      'textarea[data-path="/groups/0/rules/0/source/value"]',
    ) as HTMLTextAreaElement | null;
    expect(keySelect?.value).toBe("host");
    expect(valueField?.value).toBe("^example\\.com$");
    editor.destroy();
  });

  it("shows migration notices once until dismissed", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    let dismissed = false;
    const editor = createEditor({
      root,
      initialProject: structuredClone(emptyProject),
      validate: () => [],
      save: () => ({ ok: true }),
      migrationNotices: [
        {
          code: "migration.possible-scope-widen",
          path: "/groups/0/rules/0",
          message: "Rule scope may have widened during migration.",
        },
      ],
      onDismissMigrationNotices: () => {
        dismissed = true;
      },
    });
    openListedGroup(root);
    expect(root.querySelector("[data-migration-notices]")).not.toBeNull();
    root
      .querySelector('[data-command="dismiss-migration-notices"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(dismissed).toBe(true);
    expect(root.querySelector("[data-migration-notices]")).toBeNull();
    editor.destroy();
  });
});

describe("@rogatio/editor initial host validation", () => {
  it("mounts a structurally valid draft that fails host validation", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: { version: 2, name: "", groups: [] },
      validate: () => [
        {
          code: "schema.minLength",
          severity: "error",
          path: "/name",
          message: "Enter a project name.",
        },
      ],
      save: () => ({ ok: true }),
    });
    expect(root.querySelector("[data-rogatio-editor]")).not.toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a project name.",
    );
    expect(
      root.querySelector('[data-path="/name"]')?.getAttribute("aria-invalid"),
    ).toBe("true");
    editor.destroy();
  });
});

describe("group enablement heading button", () => {
  it("omits the button when the host supplies no enablement port", () => {
    const { root, editor } = createTestEditor();
    expect(
      root.querySelector("[data-group-heading] [data-group-enable]"),
    ).toBeNull();
    editor.destroy();
  });

  it("shows Enable or Disable, calls the host, and leaves the draft clean", () => {
    const calls: Array<{ groupId: string; enabled: boolean }> = [];
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => false,
        setEnabled(groupId, enabled) {
          calls.push({ groupId, enabled });
        },
      },
    });
    openListedGroup(root);
    const button = root.querySelector<HTMLButtonElement>(
      "[data-group-heading] [data-group-enable]",
    );
    expect(button?.textContent).toBe("Enable");
    expect(button?.getAttribute("aria-label")).toBe("Enable group One");
    expect(button?.dataset.btn).toBe("primary");
    button?.click();
    expect(calls).toEqual([{ groupId: "group-one", enabled: true }]);
    expect(editor.isDirty()).toBe(false);
    editor.syncGroupEnablement(["group-one"]);
    expect(button?.textContent).toBe("Disable");
    expect(button?.getAttribute("aria-label")).toBe("Disable group One");
    editor.syncGroupEnablement([]);
    expect(button?.textContent).toBe("Enable");
    editor.destroy();
  });

  it("enables the saved group id, not a draft-only group", () => {
    // Ids are no longer authored, so the only way a draft id can differ from the
    // committed one is the id-repair path, covered in identity-surface.test.ts.
    // What must hold everywhere is that the heading control targets the
    // committed group, which a copy makes observable: a copied group exists only
    // in the draft, so it must have no enable control at all, and the original
    // must still target its own committed id.
    const calls: Array<{ groupId: string; enabled: boolean }> = [];
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => false,
        setEnabled(groupId, enabled) {
          calls.push({ groupId, enabled });
        },
      },
    });
    openListedGroup(root);
    const button = root.querySelector<HTMLButtonElement>(
      "[data-group-heading] [data-group-enable]",
    );
    expect(button?.dataset.groupId).toBe("group-one");
    button?.click();
    expect(calls).toEqual([{ groupId: "group-one", enabled: true }]);
    editor.destroy();
  });

  it("omits Enable on a copied group that has not been saved", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: {
        version: 2,
        name: "Editor project",
        groups: [
          emptyProject.groups[0],
          {
            id: "group-two",
            name: "Two",
            rules: emptyProject.groups[0].rules,
          },
        ],
      },
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => false,
        setEnabled() {},
      },
    });
    openListedGroup(root, "group-one");
    root
      .querySelector('[data-group-heading] button[data-command="copy-group"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      root.querySelector("[data-group-heading] [data-group-enable]"),
    ).toBeNull();
    openListedGroup(root, "group-two");
    expect(
      root.querySelector<HTMLButtonElement>(
        "[data-group-heading] [data-group-enable]",
      )?.dataset.groupId,
    ).toBe("group-two");
    editor.destroy();
  });
});

describe("workspace action layout", () => {
  function openGroup(root: HTMLElement): void {
    openListedGroup(root);
  }

  it("clusters group actions beside the name and repeats them under the rules", () => {
    const { root, editor } = createTestEditor();
    openGroup(root);
    const headingActions = root.querySelector(
      "[data-group-heading] [data-group-actions]",
    );
    expect(
      headingActions?.querySelector('[data-command="copy-group"]'),
    ).not.toBeNull();
    expect(
      headingActions?.querySelector('[data-command="remove-group"]'),
    ).not.toBeNull();
    expect(headingActions?.querySelector("[data-group-enable]")).toBeNull();
    expect(
      root.querySelector(
        "[data-editor-command-bar] [data-action-cluster='commit'] [data-command='save']",
      ),
    ).not.toBeNull();

    const dock = root.querySelector("[data-action-dock]");
    expect(dock?.textContent).toContain("Rules");
    expect(dock?.textContent).toContain("Group");
    expect(dock?.textContent).toContain("Project");
    expect(dock?.querySelector('[data-command="add-rule"]')).not.toBeNull();
    expect(dock?.querySelector('[data-command="copy-group"]')).not.toBeNull();
    expect(dock?.querySelector('[data-command="remove-group"]')).not.toBeNull();
    expect(dock?.querySelector('[data-command="validate"]')).not.toBeNull();
    expect(dock?.querySelector('[data-command="save"]')).not.toBeNull();
    expect(dock?.querySelector('[data-command="cancel"]')).not.toBeNull();

    const before = root.querySelectorAll("[data-rule-card]").length;
    dock
      ?.querySelector<HTMLButtonElement>('[data-command="add-rule"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll("[data-rule-card]").length).toBe(before + 1);
    expect(
      root.querySelector("[data-action-dock] [data-command='add-rule']"),
    ).not.toBeNull();
    editor.destroy();
  });

  it("puts Add group on the project heading and omits the action dock", () => {
    const { root, editor } = createTestEditor();
    root
      .querySelector('[data-desktop-route-rail] button[data-route="project"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-action-dock]")).toBeNull();
    expect(
      root.querySelector(
        '[data-editor-command-bar] [data-command="add-group"]',
      ),
    ).toBeNull();
    const addGroup = root.querySelector(
      '[data-group-list-section] [data-section-heading] [data-command="add-group"]',
    );
    expect(addGroup?.textContent).toBe("Add group");
    const open = root.querySelector<HTMLButtonElement>(
      '[data-group-list] button[data-route="group"]',
    );
    expect(open?.textContent).toBe("One");
    expect(open?.getAttribute("aria-label")).toBe("Open group One");
    expect(
      root.querySelector('[data-group-list] [data-command="copy-group"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-group-list] [data-command="remove-group"]'),
    ).not.toBeNull();
    open?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-group-heading]")).not.toBeNull();
    expect(root.querySelector("[data-action-dock]")).not.toBeNull();
    editor.destroy();
  });

  it("keeps the dock enable control on the saved group id", () => {
    const calls: Array<{ groupId: string; enabled: boolean }> = [];
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => true,
        setEnabled(groupId, enabled) {
          calls.push({ groupId, enabled });
        },
      },
    });
    openListedGroup(root);
    const button = root.querySelector<HTMLButtonElement>(
      "[data-action-dock] [data-group-enable]",
    );
    expect(button?.textContent).toBe("Disable");
    expect(button?.getAttribute("aria-label")).toBe("Disable group One");
    button?.click();
    expect(calls).toEqual([{ groupId: "group-one", enabled: false }]);
    editor.destroy();
  });
});

describe("workspace breadcrumb and group picker", () => {
  it("shows the project name and Groups, and opens a group from the picker", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => true,
        setEnabled() {},
      },
    });
    const project = root.querySelector<HTMLButtonElement>(
      "[data-route-breadcrumb] [data-route='project']",
    );
    expect(project?.textContent).toBe("Editor project");
    expect(project?.getAttribute("aria-current")).toBe("page");
    const groups = root.querySelector<HTMLButtonElement>(
      "[data-command='open-group-picker']",
    );
    expect(groups?.textContent).toBe("Groups");
    expect(groups?.getAttribute("aria-current")).toBeNull();
    expect(
      root.querySelector("[data-editor-command-bar] [data-route='test']"),
    ).not.toBeNull();
    expect(
      root.querySelector("[data-desktop-route-rail] [data-route='test']"),
    ).toBeNull();

    groups?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = root.querySelector("[data-group-picker] [role='dialog']");
    expect(dialog?.textContent).toContain("One");
    expect(dialog?.textContent).toContain("1 rule");
    expect(dialog?.textContent).toContain("Enabled");
    root
      .querySelector<HTMLButtonElement>(
        "[data-group-picker] button[data-group-id='group-one']",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-group-picker]")).toBeNull();
    expect(root.querySelector("[data-group-heading]")).not.toBeNull();
    expect(
      root.querySelector("[data-command='open-group-picker']")?.textContent,
    ).toBe("One");
    expect(
      root
        .querySelector("[data-command='open-group-picker']")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(document.activeElement).toBe(
      root.querySelector("[data-editor-key='route:groups']"),
    );
    expect(root.querySelector("[data-project-actions]")).toBeNull();
    editor.destroy();
  });

  it("closes the picker without changing route", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
    });
    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(
      root.querySelector("[data-editor-key='group-picker-first']"),
    );
    root
      .querySelector<HTMLButtonElement>("[data-command='close-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-group-picker]")).toBeNull();
    expect(root.querySelector("[data-group-heading]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-editor-key='route:groups']"),
    );

    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root
      .querySelector<HTMLElement>("[data-group-picker]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-group-picker]")).toBeNull();
    expect(root.querySelector("[data-group-heading]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-editor-key='route:groups']"),
    );

    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector("[data-group-picker]")).toBeNull();
    expect(root.querySelector("[data-group-heading]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-editor-key='route:groups']"),
    );
    editor.destroy();
  });

  it("shows an empty picker and host project actions", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: { version: 2, name: "Empty", groups: [] },
      validate: () => [],
      save: () => ({ ok: true }),
      projectActions: [
        { command: "refresh", label: "Refresh" },
        { command: "export", label: "Export project" },
        { command: "remove", label: "Remove project", tone: "danger" },
        { command: "", label: "Skip" },
      ],
    });
    expect(root.querySelector("[data-project-actions]")?.textContent).toContain(
      "Refresh",
    );
    expect(
      root.querySelector("[data-command='remove']")?.getAttribute("data-btn"),
    ).toBe("danger");
    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-group-picker]")?.textContent).toContain(
      "No groups yet.",
    );
    const name = root.querySelector<HTMLInputElement>("[data-path='/name']");
    if (name) {
      name.value = "Renamed";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(
      root.querySelector("[data-project-actions] [data-command='refresh']"),
    ).not.toBeNull();
    expect(
      root.querySelector("[data-route-breadcrumb] [data-route='project']")
        ?.textContent,
    ).toBe("Renamed");
    editor.destroy();
  });

  it("marks Test console current and describes picker rows", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: {
        version: 2,
        name: "Editor project",
        groups: [
          {
            id: "group-one",
            name: "One",
            rules: [
              {
                id: "rule-new",
                name: "New rule",
                source: { key: "url", operator: "regex", value: "" },
                resourceTypes: ["main_frame"],
                priority: 100,
              },
            ],
          },
          {
            id: "group-two",
            name: "Two",
            rules: [],
          },
        ],
      },
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: (groupId: string) => groupId !== "group-two",
        setEnabled() {},
      },
    });
    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const one = root.querySelector(
      "[data-group-picker] button[data-group-id='group-one']",
    );
    const two = root.querySelector(
      "[data-group-picker] button[data-group-id='group-two']",
    );
    expect(one?.textContent).toContain("Enabled");
    expect(one?.textContent).toContain("1 rule");
    expect(two?.textContent).toContain("Disabled");
    expect(two?.textContent).toContain("No rules");

    root
      .querySelector<HTMLButtonElement>(
        "[data-editor-command-bar] [data-route='test']",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      root
        .querySelector("[data-editor-command-bar] [data-route='test']")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    root
      .querySelector<HTMLButtonElement>(
        "[data-route-breadcrumb] [data-route='project']",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root
      .querySelector<HTMLButtonElement>("[data-command='add-group']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const added = Array.from(
      root.querySelectorAll("[data-group-picker] button[data-route='group']"),
    ).find((button) => button.textContent?.includes("New group"));
    expect(added?.querySelector("[data-group-picker-state]")).toBeNull();
    editor.destroy();

    const plain = document.createElement("div");
    document.body.append(plain);
    const plainEditor = createEditor({
      root: plain,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
    });
    plain
      .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(plain.querySelector("[data-group-picker-state]")).toBeNull();
    plainEditor.destroy();
  });

  it("drops malformed project actions", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const sparse: unknown[] = [];
    sparse[1] = { command: "refresh", label: "Refresh" };
    sparse[2] = null;
    sparse[3] = "nope";
    sparse[4] = { command: "export", label: "" };
    sparse[5] = { command: "remove", label: "Remove project", tone: "danger" };
    const editor = createEditor({
      root,
      initialProject: { version: 2, name: "Empty", groups: [] },
      validate: () => [],
      save: () => ({ ok: true }),
      projectActions: sparse as never,
    });
    const commands = Array.from(
      root.querySelectorAll("[data-project-actions] button"),
    ).map((button) => button.getAttribute("data-command"));
    expect(commands).toEqual(["refresh", "remove"]);
    editor.destroy();

    const ignored = document.createElement("div");
    document.body.append(ignored);
    const ignoredEditor = createEditor({
      root: ignored,
      initialProject: { version: 2, name: "Empty", groups: [] },
      validate: () => [],
      save: () => ({ ok: true }),
      projectActions: { command: "refresh", label: "Refresh" } as never,
    });
    expect(ignored.querySelector("[data-project-actions]")).toBeNull();
    ignoredEditor.destroy();
  });
});
