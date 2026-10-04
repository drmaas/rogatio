// @vitest-environment happy-dom

import type { RogatioRule } from "@rogatio/schema";
import { validateProjectDetailed } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import {
  builtInRuleTypes,
  createEditor,
  createMockRuleType,
} from "../src/index.js";

const ext = createMockRuleType();
const rulePath = "/groups/0/rules/0";

const mockRule: RogatioRule = {
  id: "rule-mock",
  name: "Mock rule",
  source: {
    key: "url",
    operator: "regex",
    value: "^https://example\\.com/",
  },
  resourceTypes: ["main_frame"],
  priority: 100,
  type: "mock",
  mock: { status: 200, body: "hello" },
};

function asRecord(rule: Record<string, unknown>): Record<string, unknown> {
  return rule;
}

function createMountContext(
  fields: Record<string, unknown>,
  document: Document,
) {
  const store = { ...fields };
  const container = document.createElement("div");
  const controls = new Map<string, HTMLElement>();
  const setField = vi.fn((name: string, value: unknown) => {
    store[name] = value;
  });
  return {
    container,
    controls,
    setField,
    getField: (name: string) => store[name],
    getMock: () => store.mock as Record<string, unknown> | undefined,
  };
}

function openListedGroup(root: ParentNode): void {
  root
    .querySelector<HTMLButtonElement>("[data-command='open-group-picker']")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  root
    .querySelector<HTMLButtonElement>(
      "[data-group-picker] button[data-route='group']",
    )
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function selectRuleType(root: HTMLElement, typeId: string): void {
  const select = root.querySelector<HTMLSelectElement>(
    "select[data-rule-type-select]",
  );
  if (!select) throw new Error("rule type select missing");
  select.value = typeId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("@rogatio/editor mock rule type", () => {
  it("registers the mock rule type as a built-in extension", () => {
    expect(builtInRuleTypes.map((entry) => entry.id)).toContain("mock");
  });

  it("provides defaultAction on actionField mock", () => {
    expect(ext.id).toBe("mock");
    expect(ext.label).toBe("Mock response");
    expect(ext.actionField).toBe("mock");
    expect(ext.defaultAction?.()).toEqual({ status: 200, body: "" });
  });

  it("matches mock rules by type or mock payload", () => {
    expect(ext.matches(asRecord({ ...mockRule }))).toBe(true);
    expect(
      ext.matches(
        asRecord({
          mock: { status: 201, file: "data.json" },
        }),
      ),
    ).toBe(true);
    expect(ext.matches(asRecord({ ...mockRule, type: "header" }))).toBe(false);
  });

  it("maps mount controls to /mock/... field paths", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        mock: {
          status: 201,
          delayMs: 50,
          body: "payload",
          headers: [{ name: "X-Test", value: "1" }],
        },
      },
      document,
    );
    ext.mount({
      document,
      container: ctx.container,
      rulePath,
      getField: ctx.getField,
      setField: ctx.setField,
      deleteField: () => {},
      registerControl: (path, control) => {
        ctx.controls.set(path, control);
      },
    });
    expect(ctx.controls.has("/mock/status")).toBe(true);
    expect(ctx.controls.has("/mock/delayMs")).toBe(true);
    expect(ctx.controls.has("/mock")).toBe(true);
    expect(ctx.controls.has("/mock/body")).toBe(true);
    expect(ctx.controls.has("/mock/headers/0/name")).toBe(true);
    expect(ctx.controls.has("/mock/headers/0/value")).toBe(true);
  });

  it("updates nested mock fields through setField", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      { mock: { status: 200, body: "" } },
      document,
    );
    ext.mount({
      document,
      container: ctx.container,
      rulePath,
      getField: ctx.getField,
      setField: ctx.setField,
      deleteField: () => {},
      registerControl: () => {},
    });
    const status = ctx.container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    status.value = "404";
    status.dispatchEvent(new Event("input"));
    expect(ctx.getMock()?.status).toBe(404);

    const source = ctx.container.querySelector("select") as HTMLSelectElement;
    source.value = "file";
    source.dispatchEvent(new Event("change"));
    const fileInput = ctx.container.querySelector(
      'label:has([type="text"]) input',
    ) as HTMLInputElement | null;
    if (!fileInput) {
      const labels = Array.from(ctx.container.querySelectorAll("label"));
      const fileLabel = labels.find((label) =>
        label.textContent?.startsWith("File path"),
      );
      const input = fileLabel?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("file path input not found");
      }
      input.value = "fixtures/out.bin";
      input.dispatchEvent(new Event("input"));
    } else {
      fileInput.value = "fixtures/out.bin";
      fileInput.dispatchEvent(new Event("input"));
    }
    expect(ctx.getMock()?.file).toBe("fixtures/out.bin");
    expect(ctx.getMock()).not.toHaveProperty("body");
  });

  it("adds no editor-local validation policy; the host adapter owns it", () => {
    for (const mock of [
      { status: 204, body: "" },
      { status: 200 },
      { status: 200, body: "x", file: "a.txt" },
      { status: 200, file: "../escape" },
      { status: 200, body: "", headers: [{ name: "a:b", value: "" }] },
    ]) {
      expect(ext.validate({ ...mockRule, mock }, rulePath)).toEqual([]);
    }
  });

  it("surfaces host 204 rejection at /mock/status without a local range check", () => {
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
            rules: [{ ...mockRule, mock: { status: 204, body: "" } }],
          },
        ],
      },
      validate: (value) => {
        const result = validateProjectDetailed(value);
        if (result.valid) return [];
        return result.errors.map((entry) => ({
          code: entry.keyword,
          severity: "error" as const,
          path: entry.instancePath,
          message: entry.message,
        }));
      },
      save: () => ({ ok: true }),
    });
    openListedGroup(root);
    const errors = editor.validate();
    expect(errors.map((entry) => entry.path)).toEqual([
      "/groups/0/rules/0/mock/status",
    ]);
    expect(
      errors.every((entry) => !entry.code.startsWith("editor.mock-")),
    ).toBe(true);
  });

  it("adds and removes response header rows", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      { mock: { status: 200, body: "x" } },
      document,
    );
    ext.mount({
      document,
      container: ctx.container,
      rulePath,
      getField: ctx.getField,
      setField: ctx.setField,
      deleteField: () => {},
      registerControl: () => {},
    });
    ctx.container
      .querySelector<HTMLButtonElement>('[data-mock-add-header="true"]')
      ?.click();
    expect(ctx.getMock()?.headers).toEqual([{ name: "", value: "" }]);

    ctx.setField.mockClear();
    ctx.setField("mock", {
      status: 200,
      body: "x",
      headers: [{ name: "A", value: "1" }],
    });
    ext.mount({
      document,
      container: ctx.container,
      rulePath,
      getField: ctx.getField,
      setField: ctx.setField,
      deleteField: () => {},
      registerControl: () => {},
    });
    const remove = ctx.container.querySelector<HTMLButtonElement>(
      '[data-mock-header-row="0"] button',
    );
    remove?.click();
    expect(ctx.setField).toHaveBeenCalledWith("mock", {
      status: 200,
      body: "x",
      headers: undefined,
    });
  });
});

describe("@rogatio/editor mock rule lifecycle", () => {
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

  it("initializes mock when Mock response is selected", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
    });
    openListedGroup(root);
    selectRuleType(root, "mock");
    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.type).toBe("mock");
    expect(rule.mock).toEqual({ status: 200, body: "" });
  });

  it("clears mock when switching away and clears other payloads when switching to mock", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: emptyProject,
      validate: () => [],
      save: () => ({ ok: true }),
    });
    openListedGroup(root);
    selectRuleType(root, "mock");
    selectRuleType(root, "redirect");
    let rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.mock).toBeUndefined();
    expect(rule.redirect).toEqual({ destination: "" });
    selectRuleType(root, "mock");
    rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.redirect).toBeUndefined();
    expect(rule.mock).toEqual({ status: 200, body: "" });
  });

  it("copies a mock rule with nested mock payload", () => {
    const project = {
      version: 2,
      name: "Editor project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-mock",
              name: "API mock",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://api\\.example/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "mock",
              mock: {
                status: 418,
                body: "teapot",
                headers: [{ name: "X-Tea", value: "pot" }],
              },
            },
          ],
        },
      ],
    };
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
    });
    openListedGroup(root);
    root
      .querySelector<HTMLButtonElement>(
        '[data-command="copy-rule"][data-group-id="group-one"][data-rule-id="rule-mock"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const rules = editor.getDraft().groups[0]?.rules ?? [];
    expect(rules).toHaveLength(2);
    expect((rules[1] as unknown as Record<string, unknown>).mock).toEqual({
      status: 418,
      body: "teapot",
      headers: [{ name: "X-Tea", value: "pot" }],
    });
    expect(editor.isDirty()).toBe(true);
  });

  it("blocks save with host validation paths under /mock/...", () => {
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
                id: "rule-mock",
                name: "Mock",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 100,
                type: "mock",
                mock: { status: 200 },
              },
            ],
          },
        ],
      },
      validate: (value) => {
        const result = validateProjectDetailed(value);
        if (result.valid) return [];
        return result.errors.map((entry) => ({
          code: entry.keyword,
          severity: "error" as const,
          path: entry.instancePath,
          message: entry.message,
        }));
      },
      save: () => ({ ok: true }),
    });
    openListedGroup(root);
    const errors = editor.validate();
    expect(errors.some((entry) => entry.path.endsWith("/mock"))).toBe(true);
  });

  it("keeps edits in the draft until save", () => {
    const saved: unknown[] = [];
    const project = {
      version: 2,
      name: "Editor project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-mock",
              name: "Mock",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "mock",
              mock: { status: 200, body: "before" },
            },
          ],
        },
      ],
    };
    const root = document.createElement("div");
    document.body.append(root);
    const editor = createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: (snapshot) => {
        saved.push(snapshot);
        return { ok: true };
      },
    });
    openListedGroup(root);
    const textarea = root.querySelector(
      '[data-extension-fields="mock"] textarea',
    );
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("mock body textarea not found");
    }
    textarea.value = "after";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.isDirty()).toBe(true);
    expect(saved).toHaveLength(0);
    const rule = editor.getDraft().groups[0]?.rules[0] as
      | { mock?: { body?: string } }
      | undefined;
    expect(rule?.mock?.body).toBe("after");
  });

  it("renders mock preview summary from the host dry-run seam", async () => {
    const project = {
      version: 2,
      name: "Editor project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-mock",
              name: "Mock",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "mock",
              mock: { status: 200, body: "hello" },
            },
          ],
        },
      ],
    };
    const root = document.createElement("div");
    document.body.append(root);
    createEditor({
      root,
      initialProject: project,
      validate: () => [],
      save: () => ({ ok: true }),
      dryRun: () => ({
        results: [
          {
            url: "https://example.com/",
            matchedRuleCount: 1,
            rules: [
              {
                groupId: "group-one",
                ruleId: "rule-mock",
                matched: true,
                source: {
                  state: "matched",
                  matched: true,
                  detail: "url",
                },
                method: {
                  state: "not-applicable",
                  matched: null,
                  detail: "method not specified",
                },
                resourceType: {
                  state: "matched",
                  matched: true,
                  detail: "page",
                },
                actionPreview: {
                  kind: "mock",
                  summary: "Mock 200 (inline body)",
                },
              },
            ],
          },
        ],
        errors: [],
        summary: {
          caseCount: 1,
          urlCount: 1,
          matchedUrlCount: 1,
          matchedRuleTotal: 1,
        },
      }),
    });
    openListedGroup(root);
    root
      .querySelector<HTMLButtonElement>(
        '[data-editor-command-bar] button[data-route="test"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const urls = root.querySelector<HTMLTextAreaElement>("[data-test-urls]");
    if (!urls) throw new Error("missing URL box");
    urls.value = "https://example.com/";
    urls.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector<HTMLButtonElement>('[data-command="test:run"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.textContent).toContain("Mock 200 (inline body)");
    });
  });
});
