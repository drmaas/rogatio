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
  version: 1,
  name: "Editor project",
  groups: [
    {
      id: "group-one",
      name: "One",
      origins: ["https://one.example"],
      rules: [
        {
          id: "rule-new",
          name: "New rule",
          urlRegex: "",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
        },
      ],
    },
  ],
} as const;

function createTestEditor(initialProject: unknown = emptyProject) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject,
    validate: () => [],
    save: () => ({ ok: true }),
  });
  root
    .querySelector('[data-desktop-route-rail] button[data-route="group"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return { root, editor };
}

function headerProject(fields: Record<string, unknown>) {
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
            id: "rule-header",
            name: "Header rule",
            urlRegex: "^https://example\\.com/",
            origins: [],
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
  it("registers header, redirect, query, mock, request-body, and response-body", () => {
    expect(builtInRuleTypes.map((extension) => extension.id)).toEqual([
      "header",
      "redirect",
      "query",
      "mock",
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
      "mock",
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
    expect(rule.responseBody).toEqual({
      replacements: [{ pattern: "", replacement: "" }],
    });
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
    expect(rule.responseBody).toEqual({
      replacements: [{ pattern: "", replacement: "" }],
    });
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

describe("@rogatio/editor query rule type ()", () => {
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
