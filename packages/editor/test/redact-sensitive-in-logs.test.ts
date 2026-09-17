// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createEditor } from "../src/index.js";

function createTestEditor(initialProject: unknown) {
  const root = document.createElement("div");
  document.body.append(root);
  const saved: unknown[] = [];
  const editor = createEditor({
    root,
    initialProject,
    validate: () => [],
    save: (project) => {
      saved.push(project);
      return { ok: true };
    },
  });
  root
    .querySelector('[data-desktop-route-rail] button[data-route="group"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return { root, editor, saved };
}

function clickSave(root: HTMLElement): void {
  root
    .querySelector('button[data-command="save"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function findRedactLabel(root: HTMLElement): HTMLLabelElement | undefined {
  return Array.from(root.querySelectorAll("label")).find((label) =>
    label.textContent?.includes("Redact sensitive fields in logs"),
  );
}

function redactCheckbox(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector(
    'input[type="checkbox"][data-path$="/redactSensitiveInLogs"]',
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("redact checkbox not found");
  }
  return input;
}

function redirectProject(redact?: boolean | "omit") {
  const rule: Record<string, unknown> = {
    id: "rule-redirect",
    name: "Redirect rule",
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame"],
    priority: 100,
    type: "redirect",
    redirect: { destination: "https://other.example/" },
  };
  if (redact !== "omit") {
    rule.redactSensitiveInLogs = redact;
  }
  return {
    version: 1,
    name: "Editor project",
    groups: [
      {
        id: "group-one",
        name: "One",
        origins: ["https://one.example"],
        rules: [rule],
      },
    ],
  };
}

function matcherProject(redact?: boolean | "omit") {
  const rule: Record<string, unknown> = {
    id: "rule-matcher",
    name: "Matcher rule",
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame"],
    priority: 100,
  };
  if (redact !== "omit") {
    rule.redactSensitiveInLogs = redact;
  }
  return {
    version: 1,
    name: "Editor project",
    groups: [
      {
        id: "group-one",
        name: "One",
        origins: ["https://one.example"],
        rules: [rule],
      },
    ],
  };
}

function bodyProject(type: "request-body" | "response-body") {
  return {
    version: 1,
    name: "Editor project",
    groups: [
      {
        id: "group-one",
        name: "One",
        origins: ["https://one.example"],
        rules: [
          {
            id: "rule-body",
            name: "Body rule",
            urlRegex: "^https://example\\.com/api$",
            origins: [],
            resourceTypes:
              type === "request-body" ? ["xmlhttprequest"] : ["main_frame"],
            priority: 100,
            ...(type === "request-body" ? { method: "POST" } : {}),
            type,
            ...(type === "request-body"
              ? { requestBody: { mode: "replace", body: '{"debug":false}' } }
              : { responseBody: { mode: "replace", body: '{"debug":false}' } }),
          },
        ],
      },
    ],
  };
}

function selectRuleType(root: HTMLElement, typeId: string): void {
  const select = root.querySelector(
    "select[data-rule-type-select]",
  ) as HTMLSelectElement | null;
  if (!select) throw new Error("rule type select not found");
  select.value = typeId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("@rogatio/editor redact sensitive logs checkbox", () => {
  it("shows one checkbox on redirect and matcher cards", () => {
    expect(
      findRedactLabel(createTestEditor(redirectProject("omit")).root),
    ).toBeDefined();
    expect(
      findRedactLabel(createTestEditor(matcherProject("omit")).root),
    ).toBeDefined();
  });

  it("hides the checkbox on request-body and response-body cards", () => {
    expect(
      findRedactLabel(createTestEditor(bodyProject("request-body")).root),
    ).toBeUndefined();
    expect(
      findRedactLabel(createTestEditor(bodyProject("response-body")).root),
    ).toBeUndefined();
  });

  it("is unchecked when omitted or false and checked only for boolean true", () => {
    expect(
      redactCheckbox(createTestEditor(redirectProject("omit")).root).checked,
    ).toBe(false);
    expect(
      redactCheckbox(createTestEditor(redirectProject(false)).root).checked,
    ).toBe(false);
    expect(
      redactCheckbox(createTestEditor(redirectProject(true)).root).checked,
    ).toBe(true);
  });

  it("persists booleans on change but not on input", () => {
    const { root, editor } = createTestEditor(redirectProject(true));
    let checkbox = redactCheckbox(root);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.getDraft().groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(
      false,
    );

    checkbox = redactCheckbox(root);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getDraft().groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(
      false,
    );

    checkbox = redactCheckbox(root);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.getDraft().groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(
      true,
    );
  });

  it("keeps the flag across type changes and hides it on body kinds", () => {
    const { root, editor } = createTestEditor(matcherProject(true));
    selectRuleType(root, "query");
    expect(editor.getDraft().groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(
      true,
    );
    expect(findRedactLabel(root)).toBeDefined();

    selectRuleType(root, "request-body");
    expect(editor.getDraft().groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(
      true,
    );
    expect(findRedactLabel(root)).toBeUndefined();
  });

  it("includes the flag in the save snapshot", () => {
    const { root, saved } = createTestEditor(redirectProject("omit"));
    const checkbox = redactCheckbox(root);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    clickSave(root);
    expect(saved).toHaveLength(1);
    const snapshot = saved[0] as {
      groups: Array<{ rules: Array<Record<string, unknown>> }>;
    };
    expect(snapshot.groups[0]?.rules[0]?.redactSensitiveInLogs).toBe(true);
  });
});
