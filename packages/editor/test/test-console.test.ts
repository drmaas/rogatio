// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createEditor, type DryRunResult } from "../src/index.js";
import { urlToExactRegex } from "../src/url.js";

const exact = urlToExactRegex("https://example.com/old");
if (!exact.ok) throw new Error("fixture URL did not convert");

const project = {
  version: 2,
  name: "Editor project",
  groups: [
    {
      id: "ads",
      name: "Ads",
      rules: [
        {
          id: "old-path",
          name: "Old path",
          type: "redirect",
          source: {
            key: "url",
            operator: "regex",
            value: exact.source,
          },
          resourceTypes: ["main_frame"],
          priority: 100,
          redirect: { destination: "https://example.com/new" },
        },
        {
          id: "post-only",
          name: "Post only",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/post$",
          },
          resourceTypes: ["main_frame"],
          priority: 90,
          method: "POST",
        },
      ],
    },
  ],
};

function result(rules: DryRunResult["results"][number]["rules"]): DryRunResult {
  return {
    results: [
      {
        url: "https://example.com/old",
        rules,
        matchedRuleCount: rules.filter((rule) => rule.matched).length,
      },
    ],
    errors: [],
    summary: {
      caseCount: 1,
      urlCount: 1,
      matchedUrlCount: rules.some((rule) => rule.matched) ? 1 : 0,
      matchedRuleTotal: rules.filter((rule) => rule.matched).length,
    },
  };
}

function dimension(
  state: "matched" | "unmatched" | "not-applicable",
  detail: string,
) {
  return {
    state,
    matched: state === "not-applicable" ? null : state === "matched",
    detail,
  };
}

function openTest(root: HTMLElement): void {
  root
    .querySelector<HTMLButtonElement>(
      '[data-rail-tools] button[data-route="test"]',
    )
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function typeUrl(root: HTMLElement, value: string): void {
  const urls = root.querySelector<HTMLTextAreaElement>("[data-test-urls]");
  if (!urls) throw new Error("missing URL box");
  urls.value = value;
  urls.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickRun(root: HTMLElement): Promise<void> {
  root
    .querySelector<HTMLButtonElement>('[data-command="test:run"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
}

describe("test console", () => {
  it("offers one Run test control and page-load defaults", () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "old-path",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("matched", "GET"),
            resourceType: dimension("matched", "main_frame"),
            actionPreview: null,
          },
        ]),
    });
    openTest(root);
    expect(root.querySelectorAll('[data-command="test:run"]')).toHaveLength(1);
    expect(root.querySelector("[data-editor-command-bar]")).toBeNull();
    expect(
      root.querySelector("[data-editor-header]")?.textContent,
    ).not.toContain("Run test");
    expect(root.querySelector("[data-test-description]")?.textContent).toBe(
      "Check whether these URLs match your rules. Nothing is contacted, and nothing is saved.",
    );
    expect(root.querySelector("[data-test-checking]")?.textContent).toBe(
      "Checking these as page loads (GET).",
    );
    expect(root.textContent).not.toContain("without explicit values");
    expect(root.textContent).not.toContain("Max test cases");
    expect(
      root.querySelector<HTMLSelectElement>("[data-test-method]")?.value,
    ).toBe("GET");
    expect(
      root.querySelector<HTMLSelectElement>("[data-test-resource-type]")?.value,
    ).toBe("main_frame");
    expect(
      root.querySelector<HTMLSelectElement>("[data-test-resource-type]")
        ?.selectedOptions[0]?.textContent,
    ).toBe("Page");
    expect(root.textContent).toContain("Try a URL from this rule");
  });

  it("sends GET and a page load unless the person picks otherwise", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const seen: Array<{ method?: string; resourceType?: string }> = [];
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: (_draft, cases) => {
        seen.push(
          ...cases.map((entry) => ({
            method: entry.method,
            resourceType: entry.resourceType,
          })),
        );
        return result([]);
      },
    });
    openTest(root);
    typeUrl(root, "https://example.com/post");
    await clickRun(root);
    expect(seen).toEqual([{ method: "GET", resourceType: "main_frame" }]);
  });

  it("says the constraint was not tested when Any method is chosen", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "old-path",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("not-applicable", "method not specified"),
            resourceType: dimension("matched", "page"),
            actionPreview: {
              kind: "redirect",
              summary: "https://example.com/new",
            },
          },
        ]),
    });
    openTest(root);
    const method = root.querySelector<HTMLSelectElement>("[data-test-method]");
    if (!method) throw new Error("missing method select");
    method.value = "";
    method.dispatchEvent(new Event("change", { bubbles: true }));
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(root.textContent).toContain(
      "https://example.com/old matches Redirect in Ads / ",
    );
    expect(root.textContent).toContain(
      "The browser would go to https://example.com/new.",
    );
    expect(root.textContent).toContain("The method was not tested.");
  });

  it("labels a disabled group and keeps misses collapsed", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      groupEnablement: {
        isEnabled: () => false,
        setEnabled: () => undefined,
      },
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "old-path",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("matched", "GET"),
            resourceType: dimension("matched", "page"),
            actionPreview: {
              kind: "redirect",
              summary: "https://example.com/new",
            },
          },
          {
            groupId: "ads",
            ruleId: "post-only",
            matched: false,
            source: dimension("unmatched", "miss"),
            method: dimension("unmatched", "POST"),
            resourceType: dimension("matched", "page"),
            actionPreview: null,
          },
        ]),
    });
    openTest(root);
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(root.textContent).toContain(
      "This group is off in Chrome, so the browser will not apply this rule.",
    );
    const matches = root.querySelector("details[data-test-matches]");
    expect(matches?.hasAttribute("open")).toBe(true);
    expect(matches?.querySelector("summary")?.textContent).toBe(
      "1 rule matched",
    );
    const misses = root.querySelector("details[data-test-misses]");
    expect(misses?.hasAttribute("open")).toBe(false);
    expect(misses?.querySelector("summary")?.textContent).toBe(
      "1 rule did not match",
    );
    root
      .querySelector<HTMLButtonElement>(
        "[data-test-outcome] [data-test-rule-link]",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      root.querySelector('[data-rule-card][data-rule-id="old-path"]'),
    ).not.toBeNull();
  });

  it("heads matched rules with their count", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "old-path",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("matched", "GET"),
            resourceType: dimension("matched", "page"),
            actionPreview: null,
          },
          {
            groupId: "ads",
            ruleId: "post-only",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("matched", "GET"),
            resourceType: dimension("matched", "page"),
            actionPreview: null,
          },
        ]),
    });
    openTest(root);
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    const matches = root.querySelector("details[data-test-matches]");
    expect(matches?.querySelector("summary")?.textContent).toBe(
      "2 rules matched",
    );
    expect(matches?.querySelectorAll("[data-test-outcome]")).toHaveLength(2);
    expect(root.querySelector("details[data-test-misses]")).toBeNull();
  });

  it("shows field diagnostics for an invalid draft and keeps rendering", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => ({
        code: "validation-failed",
        message: "Project validation failed",
        diagnostics: [
          {
            code: "schema.required",
            severity: "error" as const,
            path: "/groups/0/rules/0/source/value",
            message: "Enter a valid regular expression.",
          },
        ],
      }),
    });
    openTest(root);
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(root.textContent).toContain("Enter a valid regular expression.");
    expect(root.textContent).not.toContain("TypeError");
    expect(document.activeElement).toBe(
      root.querySelector('[data-path="/groups/0/rules/0/source/value"]'),
    );
    openTest(root);
    expect(root.querySelector("[data-test-description]")).not.toBeNull();
    expect(root.querySelector("[data-test-results]")).not.toBeNull();
  });

  it("fills the box from an exact URL rule", () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => result([]),
    });
    openTest(root);
    root
      .querySelector<HTMLButtonElement>('[data-command="test:try-url"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      root.querySelector<HTMLTextAreaElement>("[data-test-urls]")?.value,
    ).toBe("https://example.com/old");
  });

  it("keeps editor status out of the dialog", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => result([]),
    });
    editor.validate();
    openTest(root);
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe(
      "Project is valid.",
    );
    expect(root.querySelector("[data-test-dialog]")?.textContent).not.toContain(
      "Project is valid.",
    );
    root
      .querySelector<HTMLButtonElement>('[data-command="test:run"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-test-status]")?.textContent).toBe(
      "Please enter at least one URL to test.",
    );
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe(
      "Project is valid.",
    );
    root
      .querySelector("[data-test-console]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-rail-tools] [data-route='test']"),
    );
  });

  it("cycles tab past a collapsed miss list and returns focus on Escape", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "post-only",
            matched: false,
            source: dimension("unmatched", "miss"),
            method: dimension("unmatched", "POST"),
            resourceType: dimension("matched", "page"),
            actionPreview: null,
          },
        ]),
    });
    openTest(root);
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    const summary = root.querySelector<HTMLElement>(
      "[data-test-misses] summary",
    );
    const hidden = root.querySelector("[data-test-misses] button");
    summary?.focus();
    const forward = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    summary?.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      root.querySelector("[data-command='close-test-console']"),
    );
    expect(document.activeElement).not.toBe(hidden);
    const back = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(back);
    expect(document.activeElement).toBe(summary);
    root
      .querySelector(".rogatio-editor")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-rail-tools] [data-route='test']"),
    );
  });

  it("ignores a run that finishes after the dialog closes", async () => {
    let release: ((value: DryRunResult) => void) | undefined;
    const pending = new Promise<DryRunResult>((resolve) => {
      release = resolve;
    });
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => pending,
    });
    openTest(root);
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(root.querySelector("[data-test-pending]")?.textContent).toBe(
      "Checking URLs...",
    );
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe("");
    root
      .querySelector<HTMLButtonElement>("[data-command='close-test-console']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe("");
    release?.(result([]));
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe("");
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    openTest(root);
    expect(root.querySelector("[data-test-status]")).toBeNull();
    expect(root.querySelector("[data-test-pending]")).toBeNull();
  });
});

describe("test console page", () => {
  it("fills the editor page and keeps urls, method, and results", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    let left = 0;
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      consoleSurface: "page",
      onLeaveConsole() {
        left += 1;
      },
      dryRun: () =>
        result([
          {
            groupId: "ads",
            ruleId: "old-path",
            matched: true,
            source: dimension("matched", "url"),
            method: dimension("matched", "GET"),
            resourceType: dimension("matched", "main_frame"),
            actionPreview: {
              kind: "redirect",
              summary: "https://example.com/new",
            },
          },
        ]),
    });
    expect(root.querySelector("[data-route='test']")).toBeNull();
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    editor.setConsolePage(true);
    expect(root.querySelector("[data-test-page]")).not.toBeNull();
    expect(root.querySelector("[data-test-dialog]")).toBeNull();
    expect(root.querySelector("[data-test-console]")).toBeNull();
    expect(
      root.querySelector("[data-command='close-test-console']"),
    ).toBeNull();
    expect(root.querySelector("[data-test-description]")?.textContent).toBe(
      "Check whether these URLs match your rules. Nothing is contacted, and nothing is saved.",
    );
    expect(root.querySelectorAll('[data-command="test:run"]')).toHaveLength(1);
    expect(root.querySelector("[data-desktop-route-rail]")).toHaveProperty(
      "hidden",
      true,
    );
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(root.textContent).toContain(
      "https://example.com/old matches Redirect in Ads / ",
    );
    expect(left).toBe(0);
    editor.setConsolePage(false);
    expect(left).toBe(0);
    expect(root.querySelector("[data-test-page]")).toBeNull();
    expect(root.querySelector("[data-route-breadcrumb]")).not.toBeNull();
    editor.setConsolePage(true);
    expect(
      root.querySelector<HTMLTextAreaElement>("[data-test-urls]")?.value,
    ).toBe("https://example.com/old");
    expect(root.textContent).toContain("The browser would go to");
    root
      .querySelector(".rogatio-editor")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    expect(root.querySelector("[data-test-page]")).not.toBeNull();
    root
      .querySelector<HTMLButtonElement>("[data-command='test:open-rule']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(left).toBe(1);
    expect(root.querySelector("[data-test-page]")).toBeNull();
    expect(root.querySelector("[data-rule-card]")).not.toBeNull();
    editor.destroy();
  });

  it("leaves the page when a draft fails validation", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    let left = 0;
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      consoleSurface: "page",
      onLeaveConsole() {
        left += 1;
      },
      dryRun: () => ({
        ok: false as const,
        diagnostics: [
          {
            code: "schema.required",
            severity: "error" as const,
            path: "/groups/0/rules/0/source/value",
            message: "Enter a valid regular expression.",
          },
        ],
      }),
    });
    editor.validate();
    editor.setConsolePage(true);
    expect(root.querySelector("[data-test-page]")?.textContent).not.toContain(
      "Project is valid.",
    );
    expect(root.querySelector("[data-editor-status]")?.textContent).toBe(
      "Project is valid.",
    );
    typeUrl(root, "https://example.com/old");
    await clickRun(root);
    expect(left).toBe(1);
    expect(root.querySelector("[data-test-page]")).toBeNull();
    expect(root.textContent).toContain("Enter a valid regular expression.");
    expect(document.activeElement).toBe(
      root.querySelector('[data-path="/groups/0/rules/0/source/value"]'),
    );
    editor.destroy();
  });

  it("follows a history entry with no group without leaving the page", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let left = 0;
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      consoleSurface: "page",
      onLeaveConsole() {
        left += 1;
      },
    });
    const name = root.querySelector<HTMLInputElement>("[data-path='/name']");
    if (!name) throw new Error("missing project name");
    name.value = "Draft name";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    editor.navigateToRule("ads", "old-path");
    editor.setConsolePage(true);
    typeUrl(root, "https://example.com/old");
    editor.syncRoute(null);
    expect(left).toBe(0);
    expect(root.querySelector("[data-test-page]")).not.toBeNull();
    expect(
      root.querySelector<HTMLTextAreaElement>("[data-test-urls]")?.value,
    ).toBe("https://example.com/old");
    editor.setConsolePage(false);
    expect(left).toBe(0);
    expect(root.querySelector("[data-test-page]")).toBeNull();
    expect(root.querySelector("[data-rule-card]")).toBeNull();
    expect(
      root.querySelector<HTMLInputElement>("[data-path='/name']")?.value,
    ).toBe("Draft name");
    expect(
      root.querySelector("[data-command='open-group-picker']")?.textContent,
    ).toBe("Groups");
    editor.destroy();
  });

  it("does not scroll a rule the editor is already showing", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let left = 0;
    const scrolls: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub() {
      scrolls.push(this.id);
    };
    try {
      const editor = createEditor({
        root,
        initialProject: project,
        validate: () => [],
        save: () => ({ ok: true }),
        consoleSurface: "page",
        onLeaveConsole() {
          left += 1;
        },
      });
      editor.navigateToRule("ads", "old-path");
      scrolls.length = 0;
      editor.setConsolePage(true);
      editor.syncRoute("ads");
      editor.setConsolePage(false);
      expect(left).toBe(0);
      expect(scrolls).toEqual([]);
      const card = root.querySelector("[data-rule-card]");
      expect(card?.getAttribute("data-rule-id")).toBe("old-path");
      expect(document.activeElement).not.toBe(card);
      editor.destroy();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
