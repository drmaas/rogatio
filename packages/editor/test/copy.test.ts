// @vitest-environment happy-dom

import { LIMITS } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/index.js";

function createTestEditor(initialProject: unknown) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject,
    validate: () => [],
    save: () => ({ ok: true }),
  });
  return { root, editor };
}

function openGroup(root: HTMLElement, groupName = "One"): void {
  root
    .querySelectorAll("[data-desktop-route-rail] button[data-route='group']")
    .forEach((button) => {
      if (button.textContent === groupName) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
}

function openProject(root: HTMLElement): void {
  root
    .querySelector('[data-desktop-route-rail] button[data-route="project"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickCommand(
  root: HTMLElement,
  command: string,
  dataset: Record<string, string> = {},
): void {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      `button[data-command="${command}"]`,
    ),
  );
  const match = buttons.find((button) =>
    Object.entries(dataset).every(
      ([key, value]) => button.dataset[key] === value,
    ),
  );
  if (!match) {
    throw new Error(
      `command button not found: ${command} ${JSON.stringify(dataset)}`,
    );
  }
  match.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function allDraftIds(draft: {
  groups: Array<{ id: unknown; rules: Array<{ id: unknown }> }>;
}): string[] {
  const ids: string[] = [];
  for (const group of draft.groups) {
    ids.push(String(group.id));
    for (const rule of group.rules) ids.push(String(rule.id));
  }
  return ids;
}

function projectWithNestedRule() {
  return {
    version: 2,
    name: "Editor project",
    groups: [
      {
        id: "group-one",
        name: "One",
        rules: [
          {
            id: "rule-source",
            name: "Source rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://source\\.example/",
            },
            resourceTypes: ["main_frame"],
            priority: 100,
            type: "redirect",
            redirect: { destination: "https://dest.example/" },
          },
          {
            id: "rule-other",
            name: "Other rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://other\\.example/",
            },
            resourceTypes: ["script"],
            priority: 200,
          },
        ],
      },
      {
        id: "group-two",
        name: "Two",
        rules: [
          {
            id: "rule-three",
            name: "Third",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://three\\.example/",
            },
            resourceTypes: ["image"],
            priority: 300,
          },
        ],
      },
    ],
  };
}

function sourceValue(rule: unknown): string {
  const source = (rule as { source?: { value?: string } }).source;
  return source?.value ?? "";
}

describe("@rogatio/editor copy rule / copy group", () => {
  it("copies a rule after the source with a new id and independent nested data (AC-196-01, AC-196-04)", () => {
    const { root, editor } = createTestEditor(projectWithNestedRule());
    openGroup(root);
    clickCommand(root, "copy-rule", {
      groupId: "group-one",
      ruleId: "rule-source",
    });

    const draft = editor.getDraft();
    const group = draft.groups[0];
    expect(group?.rules.map((rule) => rule.id)).toEqual([
      "rule-source",
      "rule-new",
      "rule-other",
    ]);
    const copy = group?.rules[1] as unknown as
      | Record<string, unknown>
      | undefined;
    expect(copy?.name).toBe("Source rule (copy)");
    expect(sourceValue(copy)).toBe("^https://source\\.example/");
    expect(copy?.redirect).toEqual({ destination: "https://dest.example/" });
    expect(editor.isDirty()).toBe(true);

    const sourceInput = root.querySelector(
      '[data-rule-card][data-rule-id="rule-new"] textarea[data-path$="/source/value"]',
    );
    if (!(sourceInput instanceof HTMLTextAreaElement)) {
      throw new Error("copy source input not found");
    }
    sourceInput.value = "^https://copy-only\\.example/";
    sourceInput.dispatchEvent(new Event("input", { bubbles: true }));

    const after = editor.getDraft();
    expect(sourceValue(after.groups[0]?.rules[0])).toBe(
      "^https://source\\.example/",
    );
    expect(sourceValue(after.groups[0]?.rules[1])).toBe(
      "^https://copy-only\\.example/",
    );
    expect(
      (after.groups[0]?.rules[0] as unknown as Record<string, unknown>)
        ?.redirect,
    ).toEqual({ destination: "https://dest.example/" });
  });

  it("copies a group after the source with unique remapped rule ids (AC-196-02, AC-196-04)", () => {
    const { root, editor } = createTestEditor(projectWithNestedRule());
    openGroup(root);
    clickCommand(root, "copy-group", { groupId: "group-one" });

    const draft = editor.getDraft();
    expect(draft.groups.map((group) => group.id)).toEqual([
      "group-one",
      "group-new",
      "group-two",
    ]);
    const copy = draft.groups[1];
    expect(copy?.name).toBe("One (copy)");
    expect(copy?.rules.map((rule) => rule.id)).toEqual([
      "rule-new",
      "rule-new-2",
    ]);
    expect(copy?.rules.map((rule) => rule.name)).toEqual([
      "Source rule",
      "Other rule",
    ]);
    expect(new Set(allDraftIds(draft)).size).toBe(allDraftIds(draft).length);
    expect(editor.isDirty()).toBe(true);

    const sourceInput = root.querySelector(
      'textarea[data-path="/groups/1/rules/0/source/value"]',
    );
    if (!(sourceInput instanceof HTMLTextAreaElement)) {
      throw new Error("copied group rule source input not found");
    }
    sourceInput.value = "^https://group-copy-only\\.example/";
    sourceInput.dispatchEvent(new Event("input", { bubbles: true }));

    const after = editor.getDraft();
    expect(sourceValue(after.groups[0]?.rules[0])).toBe(
      "^https://source\\.example/",
    );
    expect(sourceValue(after.groups[1]?.rules[0])).toBe(
      "^https://group-copy-only\\.example/",
    );
  });

  it("keeps the original name when a (copy) suffix would exceed maxLabelLength", () => {
    const longName = "n".repeat(LIMITS.maxLabelLength);
    const project = projectWithNestedRule();
    project.groups[0].rules[0].name = longName;
    project.groups[0].name = longName;

    const { root, editor } = createTestEditor(project);
    openGroup(root, longName);
    clickCommand(root, "copy-rule", {
      groupId: "group-one",
      ruleId: "rule-source",
    });
    expect(editor.getDraft().groups[0]?.rules[1]?.name).toBe(longName);

    openProject(root);
    clickCommand(root, "copy-group", { groupId: "group-one" });
    const groups = editor.getDraft().groups;
    const copiedGroup = groups.find((group) => group.id === "group-new");
    expect(copiedGroup?.name).toBe(longName);
  });

  it("exposes copy-group on the project list and copy-rule on rule actions (AC-196-05)", () => {
    const { root } = createTestEditor(projectWithNestedRule());
    openProject(root);
    expect(
      root.querySelector(
        '[data-group-list] button[data-command="copy-group"][data-group-id="group-one"]',
      ),
    ).not.toBeNull();

    openGroup(root);
    expect(
      root.querySelector(
        '[data-group-heading] button[data-command="copy-group"]',
      ),
    ).not.toBeNull();
    expect(
      root.querySelector(
        '[data-rule-card][data-rule-id="rule-source"] button[data-command="copy-rule"]',
      ),
    ).not.toBeNull();
  });

  it("keeps copied rules in the draft for validate and save (AC-196-03)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const saved: unknown[] = [];
    const editor = createEditor({
      root,
      initialProject: projectWithNestedRule(),
      validate: (project) => {
        const groups = (project as { groups?: unknown[] }).groups;
        if (!Array.isArray(groups) || groups.length < 2) {
          return [
            {
              code: "test.missing-copy",
              severity: "error",
              path: "/groups",
              message: "Expected copied group in draft.",
            },
          ];
        }
        return [];
      },
      save: (project) => {
        saved.push(project);
        return { ok: true };
      },
    });
    openGroup(root);
    clickCommand(root, "copy-group", { groupId: "group-one" });
    expect(editor.isDirty()).toBe(true);
    expect(editor.validate()).toEqual([]);
    root
      .querySelector('button[data-command="save"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    const savedProject = saved[0] as {
      groups: Array<{ id: string; rules: Array<{ id: string }> }>;
    };
    expect(savedProject.groups.map((group) => group.id)).toContain("group-new");
    expect(savedProject.groups[1]?.rules.map((rule) => rule.id)).toEqual([
      "rule-new",
      "rule-new-2",
    ]);
    editor.destroy();
  });
});
