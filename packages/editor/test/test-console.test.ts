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
      '[data-editor-command-bar] button[data-route="test"]',
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
    expect(
      root.querySelector("[data-editor-command-bar]")?.textContent,
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
});
