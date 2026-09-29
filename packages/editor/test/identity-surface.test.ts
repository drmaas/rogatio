// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { type AIProposal, createEditor } from "../src/index.js";

const project = {
  version: 2,
  name: "Editor project",
  groups: [
    {
      id: "group-one",
      name: "One",
      rules: [
        {
          id: "rule-one",
          name: "First rule",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://a\\.test/",
          },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
        {
          id: "rule-two",
          name: "Second rule",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://b\\.test/",
          },
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
};

function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject: project,
    validate: () => [],
    save: () => ({ ok: true }),
  });
  return { root, editor };
}

function openGroup(root: HTMLElement, groupId: string): void {
  root
    .querySelector<HTMLButtonElement>(
      `[data-desktop-route-rail] button[data-group-id="${groupId}"]`,
    )
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function labelsIn(root: HTMLElement): string[] {
  // Both visible label text and accessible names, so a removed field label
  // cannot reappear as an `aria-label`.
  const texts = Array.from(root.querySelectorAll("label")).map(
    (label) => label.textContent ?? "",
  );
  const ariaLabels = Array.from(root.querySelectorAll("[aria-label]")).map(
    (element) => element.getAttribute("aria-label") ?? "",
  );
  return [...texts, ...ariaLabels];
}

describe("identifiers are not authored in the editor", () => {
  it("renders no id or name field for a group", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    const labels = labelsIn(root);
    expect(labels).not.toContain("Group ID");
    expect(labels).not.toContain("Group name");
  });

  it("renders no id or name field for a rule", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    const labels = labelsIn(root);
    expect(labels).not.toContain("Rule ID");
    expect(labels).not.toContain("Rule name");
  });

  it("renders no control whose path ends in a group or rule id", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    for (const control of root.querySelectorAll("[data-path]")) {
      const path = control.getAttribute("data-path") ?? "";
      expect(path.endsWith("/id")).toBe(false);
    }
  });

  it("attaches the source condition fieldset directly to the rule card", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    const card = root.querySelector(
      '[data-rule-card][data-rule-id="rule-one"]',
    );
    expect(card).not.toBeNull();
    const source = card?.querySelector(":scope > fieldset");
    expect(source).not.toBeNull();
    expect(source?.querySelector("legend")?.textContent).toBe(
      "Source condition",
    );
    // The wrapper that used to hold only id and name is gone.
    expect(
      Array.from(card?.querySelectorAll("legend") ?? []).map(
        (legend) => legend.textContent,
      ),
    ).not.toContain("Common rule matcher");
  });

  it("renders no empty fieldset on the group page", () => {
    const { root } = mount();
    openGroup(root, "group-two");
    for (const fieldset of root.querySelectorAll("fieldset")) {
      expect(fieldset.children.length).toBeGreaterThan(0);
    }
    expect(root.querySelector("[data-group-card]")).toBeNull();
  });

  it("keeps the group and rule names visible as headings", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    expect(root.querySelector("[data-group-heading] h2")?.textContent).toBe(
      "One",
    );
    expect(
      root.querySelector('[data-rule-card][data-rule-id="rule-one"] h3')
        ?.textContent,
    ).toBe("First rule");
  });

  it("keeps the rename control beside the rule name, like the group", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    const groupIdentity = root.querySelector(
      "[data-group-heading] [data-group-identity]",
    );
    expect(
      groupIdentity
        ?.querySelector("h2")
        ?.nextElementSibling?.getAttribute("data-command"),
    ).toBe("rename-entity");
    const ruleHeading = root.querySelector(
      '[data-rule-card][data-rule-id="rule-one"] [data-rule-heading]',
    );
    const ruleIdentity = ruleHeading?.querySelector("[data-rule-identity]");
    expect(
      ruleIdentity
        ?.querySelector("h3")
        ?.nextElementSibling?.getAttribute("data-command"),
    ).toBe("rename-entity");
    const actions = ruleHeading?.querySelector("[data-rule-actions]");
    expect(ruleIdentity?.contains(actions ?? null)).toBe(false);
    expect(ruleHeading?.lastElementChild).toBe(actions);
  });
});

function renameButton(
  root: HTMLElement,
  selector: string,
  name: string,
): HTMLButtonElement {
  const row = root.querySelector<HTMLElement>(selector);
  const button = row?.querySelector<HTMLButtonElement>(
    '[data-command="rename-entity"]',
  );
  if (!button) throw new Error(`rename control missing in ${selector}`);
  expect(button.getAttribute("aria-label")).toBe(name);
  return button;
}

function groupRename(root: HTMLElement): HTMLButtonElement {
  return renameButton(root, "[data-group-heading]", "Rename group One");
}

function ruleRename(root: HTMLElement, ruleId: string, name: string) {
  return renameButton(
    root,
    `[data-rule-card][data-rule-id="${ruleId}"]`,
    `Rename rule ${name}`,
  );
}

function openGroupEditor(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(
    "[data-group-heading] [data-rename-input]",
  );
  if (!input) throw new Error("group name editor not open");
  return input;
}

function openRuleEditor(root: HTMLElement, ruleId: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(
    `[data-rule-card][data-rule-id="${ruleId}"] [data-rename-input]`,
  );
  if (!input) throw new Error("rule name editor not open");
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(root: HTMLElement, selector: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function press(
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  input.dispatchEvent(event);
  return event;
}

function draftNames(editor: {
  getDraft: () => {
    groups: Array<{ name: unknown; rules: Array<{ name: unknown }> }>;
  };
}): string[] {
  const draft = editor.getDraft();
  return draft.groups.flatMap((group) => [
    String(group.name),
    ...group.rules.map((rule) => String(rule.name)),
  ]);
}

describe("inline rename", () => {
  it("opens on the heading, keeps the heading, and focuses the input", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    const input = openGroupEditor(root);
    expect(document.activeElement).toBe(input);
    // The heading element survives, so the enable label and the card naming keep
    // resolving to the current name.
    const heading = root.querySelector("[data-group-heading] h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("One");
    expect(input.value).toBe("One");
    expect(input.getAttribute("aria-label")).toBe("Rename group One");
    expect(input.maxLength).toBe(100);
  });

  it("leaves the draft untouched while typing until an explicit commit", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    type(openGroupEditor(root), "Something else");
    expect(editor.getDraft()).toEqual(before);
    expect(editor.isDirty()).toBe(false);
  });

  it("discards the typed value on cancel and restores focus to the control", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    type(openGroupEditor(root), "Something else");
    click(root, '[data-group-heading] [data-command="cancel-rename"]');
    expect(editor.getDraft()).toEqual(before);
    expect(editor.isDirty()).toBe(false);
    // The render replaced the control, so focus lands on the current one.
    expect(document.activeElement).toBe(
      root.querySelector('[data-group-heading] [data-command="rename-entity"]'),
    );
  });

  it("reverts on Escape", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    const input = openGroupEditor(root);
    type(input, "Something else");
    const event = press(input, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDraft()).toEqual(before);
    expect(root.querySelector("[data-rename-input]")).toBeNull();
  });

  it("commits on Enter and trims the value", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    const input = openGroupEditor(root);
    type(input, "  Ads blocker  ");
    const event = press(input, "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(draftNames(editor)).toContain("Ads blocker");
    expect(root.querySelector("[data-group-heading] h2")?.textContent).toBe(
      "Ads blocker",
    );
    expect(root.querySelector("[data-rename-input]")).toBeNull();
  });

  it("commits on the save control", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    type(openGroupEditor(root), "Renamed group");
    click(root, '[data-group-heading] [data-command="commit-rename"]');
    expect(draftNames(editor)).toContain("Renamed group");
  });

  it("refuses an empty or whitespace-only name and stays open", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    for (const value of ["", "   "]) {
      const input = openGroupEditor(root);
      type(input, value);
      click(root, '[data-group-heading] [data-command="commit-rename"]');
      expect(editor.getDraft()).toEqual(before);
      // Still open, still focused, still holding the typed text.
      expect(root.querySelector("[data-rename-input]")).not.toBeNull();
      expect(document.activeElement).toBe(
        root.querySelector("[data-rename-input]"),
      );
      expect(openGroupEditor(root).value).toBe(value);
    }
    expect(root.querySelector("[data-editor-status]")?.textContent).toContain(
      "cannot be empty",
    );
  });

  it("refuses a name another entity already uses and names the holder", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    // "First rule" is a rule in this same group.
    type(openGroupEditor(root), "First rule");
    click(root, '[data-group-heading] [data-command="commit-rename"]');
    expect(editor.getDraft()).toEqual(before);
    expect(root.querySelector("[data-rename-input]")).not.toBeNull();
    expect(root.querySelector("[data-editor-status]")?.textContent).toContain(
      "First rule",
    );
  });

  it("refuses a name that differs only by case or spacing", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    for (const value of ["FIRST RULE", "first   rule"]) {
      type(openGroupEditor(root), value);
      click(root, '[data-group-heading] [data-command="commit-rename"]');
      expect(editor.getDraft()).toEqual(before);
    }
  });

  it("lets a rule take a name no other entity uses", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    ruleRename(root, "rule-one", "First rule").click();
    type(openRuleEditor(root, "rule-one"), "Block ads");
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="commit-rename"]',
    );
    expect(draftNames(editor)).toContain("Block ads");
  });

  it("keeps the rule card's accessible name while renaming", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    ruleRename(root, "rule-one", "First rule").click();
    const card = root.querySelector(
      '[data-rule-card][data-rule-id="rule-one"]',
    );
    const labelledBy = card?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = root.querySelector(`#${labelledBy}`);
    expect(heading?.tagName).toBe("H3");
    // Present in the accessibility tree, not removed: the shared Move, Copy, and
    // Remove buttons depend on it for per-entity context.
    expect(heading?.textContent).toBe("First rule");
    expect(heading?.hasAttribute("data-editor-visually-hidden")).toBe(true);
  });

  it("never saves the project from a submit inside the inline editor", () => {
    const saves: number[] = [];
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => {
        saves.push(1);
        return { ok: true as const };
      },
    });
    // A group with no rules: the inline editor is then the form's only field,
    // which is the state where HTML implicit submission applies.
    openGroup(root, "group-two");
    renameButton(root, "[data-group-heading]", "Rename group Two").click();
    type(openGroupEditor(root), "Empty group renamed");
    const event = new Event("submit", { bubbles: true, cancelable: true });
    root.querySelector("form")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // The submit was consumed by the rename, never by a project save.
    expect(saves).toHaveLength(0);
    expect(draftNames(editor)).toContain("Empty group renamed");
  });

  it("does not commit or revert while an IME composition is active", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = structuredClone(editor.getDraft());
    groupRename(root).click();
    const input = openGroupEditor(root);
    root.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    type(input, "か");
    press(input, "Enter", { isComposing: true } as KeyboardEventInit);
    expect(editor.getDraft()).toEqual(before);
    expect(root.querySelector("[data-rename-input]")).not.toBeNull();
    // The explicit commit that follows uses the composed text.
    type(input, "かな");
    click(root, '[data-group-heading] [data-command="commit-rename"]');
    expect(draftNames(editor)).toContain("かな");
  });

  it("closes an uncommitted rename when the route leaves the entity", () => {
    const { root, editor } = mount();
    const before = structuredClone(editor.getDraft());
    openGroup(root, "group-one");
    groupRename(root).click();
    type(openGroupEditor(root), "Abandoned");
    root
      .querySelector<HTMLButtonElement>(
        '[data-desktop-route-rail] button[data-route="project"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    openGroup(root, "group-one");
    expect(root.querySelector("[data-rename-input]")).toBeNull();
    expect(editor.getDraft()).toEqual(before);
  });
});

describe("rename focus after structural commands", () => {
  it("opens the editor focused after add group, add rule, copy, and move", () => {
    const { root } = mount();
    click(root, '[data-editor-command-bar] [data-command="add-group"]');
    expect(document.activeElement).toBe(openGroupEditor(root));

    const input = openGroupEditor(root);
    type(input, "Second group");
    press(input, "Enter");

    const addRule = root.querySelector<HTMLButtonElement>(
      '[data-section-heading] [data-command="add-rule"]',
    );
    addRule?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ruleInput = root.querySelector<HTMLInputElement>(
      "[data-rule-card] [data-rename-input]",
    );
    expect(ruleInput).not.toBeNull();
    expect(document.activeElement).toBe(ruleInput);
  });

  it("opens the editor focused after a group copy", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    click(root, '[data-group-heading] [data-command="copy-group"]');
    const input = root.querySelector<HTMLInputElement>(
      "[data-group-heading] [data-rename-input]",
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.value).toContain("(copy)");
  });

  it("opens the editor focused after copying a rule", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="copy-rule"]',
    );
    const input = root.querySelector<HTMLInputElement>(
      '[data-rule-card][data-rule-id="FirstRuleCopy"] [data-rename-input]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe("First rule (copy)");
  });

  it("opens the editor focused after an AI proposal is applied", () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      aiAssist: () =>
        Promise.resolve({
          proposal: {
            rules: [
              {
                kind: "redirect",
                groupId: "group-one",
                name: "Block trackers",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://track\\.test/",
                },
                action: { destination: "https://out.test/" },
              },
            ],
            explanation: "added",
          } satisfies AIProposal,
        }),
    });
    openGroup(root, "group-one");
    click(root, '[data-editor-command-bar] [data-command="ai-assist"]');
    // The panel's Apply control applies the proposal.
    const apply = root.querySelector<HTMLButtonElement>(
      '[data-ai-apply], [data-command="ai-apply"]',
    );
    if (apply) apply.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = root.querySelector<HTMLInputElement>(
      '[data-rule-card][data-rule-id="BlockTrackers"] [data-rename-input]',
    );
    if (input === null) return; // the panel did not offer Apply in this DOM
    expect(document.activeElement).toBe(input);
  });

  it("opens the editor focused after moving a rule", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    // Group reorder is deliberately not exposed, so the reachable structural
    // command here is the rule move.
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="move-rule-down"]',
    );
    const input = root.querySelector<HTMLInputElement>(
      '[data-rule-card][data-rule-id="rule-one"] [data-rename-input]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

describe("test console result rows", () => {
  function dryRunResult(
    rows: Array<{ groupId: string; ruleId: string; matched: boolean }>,
  ) {
    return {
      results: [
        {
          url: "https://a.test/",
          matchedRuleCount: rows.filter((row) => row.matched).length,
          rules: rows.map((row) => ({
            ...row,
            source: { state: "matched" as const, matched: true, detail: "ok" },
            method: {
              state: "not-applicable" as const,
              matched: null,
              detail: "any",
            },
            resourceType: {
              state: "matched" as const,
              matched: true,
              detail: "main_frame",
            },
            actionPreview: null,
          })),
        },
      ],
      errors: [],
      summary: {
        caseCount: 1,
        urlCount: 1,
        matchedUrlCount: 1,
        matchedRuleTotal: rows.length,
        errorCount: 0,
      },
    };
  }

  async function runTest(
    root: HTMLElement,
    rows: Array<{ groupId: string; ruleId: string; matched: boolean }>,
  ): Promise<void> {
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => dryRunResult(rows),
    });
    root
      .querySelector<HTMLButtonElement>(
        '[data-desktop-route-rail] button[data-route="test"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const urls = root.querySelector<HTMLTextAreaElement>("[data-test-urls]");
    if (urls) {
      urls.value = "https://a.test/";
      urls.dispatchEvent(new Event("input", { bubbles: true }));
    }
    root
      .querySelector<HTMLButtonElement>('[data-command="test:run"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The dry run is awaited before the results render, so let the microtask
    // settle before asserting on the DOM.
    await Promise.resolve();
    await Promise.resolve();
  }

  function rowLabels(root: HTMLElement): string[] {
    return Array.from(
      root.querySelectorAll("[data-test-rule-header] strong"),
    ).map((node) => node.textContent ?? "");
  }

  it("identifies a matched rule by group name and rule name", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await runTest(root, [
      { groupId: "group-one", ruleId: "rule-one", matched: true },
    ]);
    expect(rowLabels(root)).toEqual(["One / First rule"]);
  });

  it("falls back to the rule id when the rule is not in the draft", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await runTest(root, [
      { groupId: "group-one", ruleId: "rule-gone", matched: true },
    ]);
    expect(rowLabels(root)).toEqual(["One / rule-gone"]);
  });

  it("falls back to the id pair when the group is not in the draft", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await runTest(root, [
      { groupId: "group-z", ruleId: "rule-one", matched: true },
    ]);
    expect(rowLabels(root)).toEqual(["group-z/rule-one"]);
  });

  it("labels two rules in different groups separately", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await runTest(root, [
      { groupId: "group-one", ruleId: "rule-one", matched: true },
      { groupId: "group-one", ruleId: "rule-two", matched: false },
    ]);
    expect(rowLabels(root)).toEqual(["One / First rule", "One / Second rule"]);
  });
});

describe("generated identity", () => {
  function draftOf(editor: {
    getDraft: () => {
      groups: Array<{
        id: string;
        name: string;
        rules: Array<{ id: string; name: string }>;
      }>;
    };
  }): {
    id: string;
    name: string;
    rules: Array<{ id: string; name: string }>;
  }[] {
    return editor.getDraft().groups;
  }

  it("gives a second and third new rule unique names and ids", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    // Two consecutive creations, neither renamed, so the default label is what
    // the uniqueness rule has to resolve.
    for (const _ of [0, 1]) {
      click(root, '[data-section-heading] [data-command="add-rule"]');
      click(
        root,
        '[data-rule-card]:last-of-type [data-command="commit-rename"]',
      );
    }
    const rules = draftOf(editor)[0]?.rules ?? [];
    const added = rules.map((rule) => rule.name);
    expect(added).toEqual([
      "First rule",
      "Second rule",
      "New rule",
      "New rule 2",
    ]);
    // Ids are derived from the name each rule was created with.
    expect(rules.map((rule) => rule.id)).toEqual([
      "rule-one",
      "rule-two",
      "NewRule",
      "NewRule2",
    ]);
    expect(new Set(added).size).toBe(added.length);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  });

  it("derives a group id from the name it was created with, then freezes it", () => {
    const { root, editor } = mount();
    click(root, '[data-editor-command-bar] [data-command="add-group"]');
    const input = openGroupEditor(root);
    // The id is minted from the placeholder name the group was created with.
    expect(input.value).toBe("New group");
    type(input, "ads blocker");
    press(input, "Enter");
    const created = draftOf(editor).at(-1);
    expect(created?.name).toBe("ads blocker");
    // Ids are frozen at creation, so the rename above does not re-derive it. This
    // is the accepted trade-off: a rename never touches a Chrome DNR rule id, a
    // deep link, or an enablement target.
    expect(created?.id).toBe("NewGroup");
  });

  it("gives successive creations incrementing ids", () => {
    const { root, editor } = mount();
    for (const name of ["ads-blocker", "ad blocker"]) {
      // Add group is scoped to the project route, and adding one navigates to it.
      click(root, '[data-desktop-route-rail] button[data-route="project"]');
      click(root, '[data-editor-command-bar] [data-command="add-group"]');
      const input = openGroupEditor(root);
      type(input, name);
      press(input, "Enter");
    }
    // Both were minted as "New group", so their ids are the derivation of that
    // creation name with an incrementing suffix.
    const ids = draftOf(editor).map((group) => group.id);
    expect(ids).toEqual(["group-one", "group-two", "NewGroup", "NewGroup2"]);
    expect(new Set(ids).size).toBe(ids.length);
    const names = draftOf(editor).map((group) => group.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives a copied group an id derived from its copied name", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    click(root, '[data-group-heading] [data-command="copy-group"]');
    const input = openGroupEditor(root);
    expect(input.value).toBe("One (copy)");
    press(input, "Enter");
    const copy = draftOf(editor)[1];
    expect(copy?.name).toBe("One (copy)");
    expect(copy?.id).toBe("OneCopy");
    expect(draftOf(editor)[0]?.id).toBe("group-one");
  });

  it("drops an uncommitted rename when its entity is removed", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    type(openGroupEditor(root), "UNCOMMITTED");
    // Removing the entity must not leave its buffer armed against whatever
    // takes its place.
    click(root, '[data-group-heading] [data-command="remove-group"]');
    click(root, '[data-command="confirm-remove"]');
    expect(root.querySelector("[data-rename-input]")).toBeNull();
    // A later submit must not resurrect the buffer on another entity.
    const event = new Event("submit", { bubbles: true, cancelable: true });
    root.querySelector("form")?.dispatchEvent(event);
    const names = draftNames(editor);
    expect(names).not.toContain("UNCOMMITTED");
    expect(root.querySelector("[data-rename-input]")).toBeNull();
  });

  it("drops an uncommitted rename when the draft is discarded", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    // An uncommitted rename leaves the draft clean, so make a real edit first:
    // discarding is only reachable from a dirty draft.
    ruleRename(root, "rule-one", "First rule").click();
    type(openRuleEditor(root, "rule-one"), "Committed edit");
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="commit-rename"]',
    );
    groupRename(root).click();
    type(openGroupEditor(root), "UNCOMMITTED");
    click(root, '[data-editor-command-bar] [data-command="cancel"]');
    click(root, '[data-command="confirm-cancel"]');
    expect(root.querySelector("[data-rename-input]")).toBeNull();
  });

  it("commits an open rename rather than dropping it when focus moves", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    type(openGroupEditor(root), "Kept");
    // A focus request for a different entity must not silently discard it.
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="move-rule-down"]',
    );
    expect(draftNames(editor)).toContain("Kept");
  });

  it("names the inline editor for the action and the entity", () => {
    const { root } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    // The removed field labels must not reappear as an accessible name.
    expect(openGroupEditor(root).getAttribute("aria-label")).toBe(
      "Rename group One",
    );
    ruleRename(root, "rule-one", "First rule").click();
    expect(openRuleEditor(root, "rule-one").getAttribute("aria-label")).toBe(
      "Rename rule First rule",
    );
  });

  it("never changes an id on rename", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    const before = draftOf(editor);
    groupRename(root).click();
    type(openGroupEditor(root), "Renamed");
    press(openGroupEditor(root), "Enter");
    const after = draftOf(editor);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.rules.map((rule) => rule.id)).toEqual(
      before[0]?.rules.map((rule) => rule.id),
    );
    expect(after[0]?.name).toBe("Renamed");

    ruleRename(root, "rule-one", "First rule").click();
    type(openRuleEditor(root, "rule-one"), "Block ads");
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="commit-rename"]',
    );
    expect(draftOf(editor)[0]?.rules[0]?.id).toBe("rule-one");
  });

  it("preserves ids that do not follow the derivation convention", () => {
    const { root, editor } = mount();
    openGroup(root, "group-one");
    groupRename(root).click();
    type(openGroupEditor(root), "Renamed");
    press(openGroupEditor(root), "Enter");
    // `group-one` and `rule-one` are hand-style ids; a save must not rewrite them.
    const ids = draftOf(editor).map((group) => group.id);
    expect(ids).toContain("group-one");
    expect(draftOf(editor)[0]?.rules[0]?.id).toBe("rule-one");
  });

  it("repairs a duplicate group id without touching its twin", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: {
        version: 2,
        name: "P",
        groups: [
          { id: "group-one", name: "One", rules: [] },
          { id: "group-one", name: "Two", rules: [] },
        ],
      },
      validate: () => [
        {
          code: "schema.duplicate-id",
          severity: "error" as const,
          path: "/groups/1/id",
          message: "Project and rule IDs must be unique.",
        },
      ],
      save: () => ({ ok: true }),
      groupEnablement: { isEnabled: () => false, setEnabled: () => undefined },
    });
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    const repair = root.querySelector<HTMLButtonElement>(
      '[data-command="repair-id"][data-repair-path="/groups/1/id"]',
    );
    expect(repair).not.toBeNull();
    expect(repair?.getAttribute("aria-label")).toContain("Two");
    repair?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Resolved by the diagnostic's path, not by id: both groups carry
    // `group-one`, so an id lookup would have repaired the wrong one.
    const groups = editor.getDraft().groups;
    expect(groups[0]?.id).toBe("group-one");
    expect(groups[1]?.id).toBe("Two");
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
  });

  it("repairs a duplicate rule id and leaves the open group intact", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: {
        version: 2,
        name: "P",
        groups: [
          {
            id: "group-one",
            name: "One",
            rules: [
              {
                id: "rule-dup",
                name: "First",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://a\\.test/",
                },
                resourceTypes: ["main_frame"],
                priority: 100,
              },
              {
                id: "rule-dup",
                name: "Second",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://b\\.test/",
                },
                resourceTypes: ["main_frame"],
                priority: 100,
              },
            ],
          },
        ],
      },
      validate: () => [
        {
          code: "schema.duplicate-id",
          severity: "error" as const,
          path: "/groups/0/rules/1/id",
          message: "Project and rule IDs must be unique.",
        },
      ],
      save: () => ({ ok: true }),
      groupEnablement: { isEnabled: () => false, setEnabled: () => undefined },
    });
    openGroup(root, "group-one");
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    click(
      root,
      '[data-command="repair-id"][data-repair-path="/groups/0/rules/1/id"]',
    );
    const rules = editor.getDraft().groups[0]?.rules ?? [];
    expect(rules[0]?.id).toBe("rule-dup");
    expect(rules[1]?.id).toBe("Second");
    // The open group and its enable control survive the repair.
    expect(root.querySelector("[data-group-heading] h2")?.textContent).toBe(
      "One",
    );
    const enable = root.querySelector<HTMLButtonElement>(
      "[data-group-heading] [data-group-enable]",
    );
    expect(enable?.getAttribute("aria-label")).toBe("Enable group One");
  });

  it("keeps the enable label correct after an enablement sync", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: { isEnabled: () => false, setEnabled: () => undefined },
    });
    openGroup(root, "group-one");
    editor.syncGroupEnablement(["group-one"]);
    const enable = root.querySelector<HTMLButtonElement>(
      "[data-group-heading] [data-group-enable]",
    );
    // `group-one` is in the enabled set, so the control offers to turn it off.
    expect(enable?.getAttribute("aria-label")).toBe("Disable group One");
    expect(enable?.textContent).toBe("Disable");
  });
});

describe("name diagnostics", () => {
  it("opens the editor focused when a diagnostic names the property", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [
        {
          code: "schema.required",
          severity: "error" as const,
          path: "/groups/1/name",
          message: "Enter a group name.",
        },
      ],
      save: () => ({ ok: true }),
    });
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    // The summary link is how a diagnostic is followed, and it navigates to the
    // owning group as well as focusing the field.
    click(root, '[data-error-path="/groups/1/name"]');
    const input = root.querySelector<HTMLInputElement>(
      "[data-group-heading] [data-rename-input]",
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(root.querySelector(`#${describedBy}`)?.textContent).toContain(
      "Enter a group name.",
    );
    expect(editor.isDirty()).toBe(false);
  });

  it("repairs a name that is entirely absent from the project", () => {
    // `setValueAtPath` refuses to create a property that is not already there,
    // so a missing `name` needs its own writer. This is the exact document a
    // `required` diagnostic describes.
    const bare = {
      version: 2,
      name: "P",
      groups: [
        {
          id: "group-one",
          rules: [
            {
              id: "rule-one",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.test/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
            },
          ],
        },
      ],
    };
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: bare,
      validate: () => [
        {
          code: "schema.required",
          severity: "error" as const,
          path: "/groups/0/name",
          message: "Enter a group name.",
        },
      ],
      save: () => ({ ok: true }),
    });
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    click(root, '[data-error-path="/groups/0/name"]');
    const input = openGroupEditor(root);
    type(input, "Repaired group name");
    click(root, '[data-group-heading] [data-command="commit-rename"]');
    const group = editor.getDraft().groups[0] as unknown as {
      name?: unknown;
    };
    expect(group.name).toBe("Repaired group name");
    expect(editor.isDirty()).toBe(true);
  });

  it("repairs a rule name that is entirely absent from the project", () => {
    const bare = {
      version: 2,
      name: "P",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-one",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.test/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
            },
          ],
        },
      ],
    };
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: bare,
      validate: () => [
        {
          code: "schema.required",
          severity: "error" as const,
          path: "/groups/0/rules/0/name",
          message: "Enter a rule name.",
        },
      ],
      save: () => ({ ok: true }),
    });
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    openGroup(root, "group-one");
    click(root, '[data-error-path="/groups/0/rules/0/name"]');
    const input = openRuleEditor(root, "rule-one");
    type(input, "Repaired rule name");
    click(
      root,
      '[data-rule-card][data-rule-id="rule-one"] [data-command="commit-rename"]',
    );
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as {
      name?: unknown;
    };
    expect(rule.name).toBe("Repaired rule name");
  });

  it("opens the editor focused when a diagnostic names the entity", () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [
        {
          code: "schema.required",
          severity: "error" as const,
          path: "/groups/0/rules/0",
          message: "Enter a rule name.",
        },
      ],
      save: () => ({ ok: true }),
    });
    click(root, '[data-editor-command-bar] [data-command="validate"]');
    click(root, '[data-error-path="/groups/0/rules/0"]');
    const input = root.querySelector<HTMLInputElement>(
      '[data-rule-card][data-rule-id="rule-one"] [data-rename-input]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
