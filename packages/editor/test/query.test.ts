// @vitest-environment happy-dom

import type { RogatioRule } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { queryRuleType } from "../src/index.js";

const ext = queryRuleType;
const rulePath = "/groups/0/rules/0";

const querySetRule: RogatioRule = {
  id: "rule-query",
  name: "Add tracking param",
  source: {
    key: "url",
    operator: "regex",
    value: "^https://example\\.com/page\\?",
  },
  resourceTypes: ["main_frame"],
  priority: 200,
  type: "query",
  action: {
    type: "query",
    params: [{ name: "ref", value: "rogatio" }],
  },
};

function createMountContext(
  fields: Record<string, unknown>,
  document: Document,
) {
  const store = { ...fields };
  const container = document.createElement("div");
  const setField = vi.fn((name: string, value: unknown) => {
    store[name] = value;
  });
  const deleteField = vi.fn((name: string) => {
    delete store[name];
  });
  return {
    container,
    deleteField,
    setField,
    getField: (name: string) => store[name],
    getAction: () => store.action as Record<string, unknown> | undefined,
  };
}

describe("@rogatio/editor query rule type", () => {
  it("matches query rules by rule.type only", () => {
    expect(
      ext.matches(querySetRule as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(
      ext.matches({
        type: "redirect",
        action: { type: "query", params: [{ name: "a", value: "1" }] },
      }),
    ).toBe(false);
    expect(ext.matches({ type: "query" })).toBe(true);
  });

  it("defaultAction includes operation set on new params", () => {
    expect(ext.defaultAction?.()).toEqual({
      type: "query",
      params: [{ name: "", operation: "set", value: "" }],
    });
  });

  it("validates legacy name/value-only params as set", () => {
    expect(
      ext.validate(
        querySetRule as unknown as Record<string, unknown>,
        rulePath,
      ),
    ).toEqual([]);
  });

  it("validates explicit set and remove params", () => {
    expect(
      ext.validate(
        {
          type: "query",
          action: {
            type: "query",
            params: [
              { name: "a", operation: "set", value: "1" },
              { name: "b", operation: "remove" },
            ],
          },
        },
        rulePath,
      ),
    ).toEqual([]);
  });

  it("rejects value on remove", () => {
    const diagnostics = ext.validate(
      {
        type: "query",
        action: {
          type: "query",
          params: [{ name: "a", operation: "remove", value: "" }],
        },
      },
      rulePath,
    );
    expect(diagnostics.some((d) => d.path.endsWith("/value"))).toBe(true);
  });

  it("rejects missing value on set", () => {
    const diagnostics = ext.validate(
      {
        type: "query",
        action: {
          type: "query",
          params: [{ name: "a", operation: "set" }],
        },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.query-param-value-required"),
    ).toBe(true);
  });

  it("rejects duplicate param names", () => {
    const diagnostics = ext.validate(
      {
        type: "query",
        action: {
          type: "query",
          params: [
            { name: "a", operation: "set", value: "1" },
            { name: "a", operation: "remove" },
          ],
        },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.query-duplicate-param"),
    ).toBe(true);
  });

  it("lists set and remove in the operation select", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", operation: "set", value: "rogatio" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const operationSelect = ctx.container.querySelector(
      '[data-query-param-operation="0"]',
    ) as HTMLSelectElement | null;
    expect(operationSelect).toBeDefined();
    expect(
      Array.from(operationSelect?.options ?? []).map((option) => option.value),
    ).toEqual(["set", "remove"]);
  });

  it("treats legacy params without operation as set in the UI", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", value: "rogatio" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const operationSelect = ctx.container.querySelector(
      '[data-query-param-operation="0"]',
    ) as HTMLSelectElement | null;
    expect(operationSelect?.value).toBe("set");
    const valueLabel = Array.from(ctx.container.querySelectorAll("label")).find(
      (label) => label.textContent?.startsWith("Value"),
    );
    expect(valueLabel?.hidden).toBe(false);
  });

  it("hides the value input when mounting a remove param", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", operation: "remove" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const valueLabel = Array.from(ctx.container.querySelectorAll("label")).find(
      (label) => label.textContent?.startsWith("Value"),
    );
    expect(valueLabel?.hidden).toBe(true);
  });

  it("omits value from the param when operation becomes remove", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", operation: "set", value: "rogatio" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const operationSelect = ctx.container.querySelector(
      '[data-query-param-operation="0"]',
    ) as HTMLSelectElement;
    operationSelect.value = "remove";
    operationSelect.dispatchEvent(new Event("change"));
    const params = (
      ctx.getAction()?.params as Array<Record<string, unknown>> | undefined
    )?.[0];
    expect(params).toEqual({ name: "ref", operation: "remove" });
    expect(params).not.toHaveProperty("value");
    const valueLabel = Array.from(ctx.container.querySelectorAll("label")).find(
      (label) => label.textContent?.startsWith("Value"),
    );
    expect(valueLabel?.hidden).toBe(true);
  });

  it("shows the value input again when operation switches back to set", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", operation: "remove" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const operationSelect = ctx.container.querySelector(
      '[data-query-param-operation="0"]',
    ) as HTMLSelectElement;
    operationSelect.value = "set";
    operationSelect.dispatchEvent(new Event("change"));
    const params = (
      ctx.getAction()?.params as Array<Record<string, unknown>> | undefined
    )?.[0];
    expect(params).toEqual({ name: "ref", operation: "set", value: "" });
    const valueLabel = Array.from(ctx.container.querySelectorAll("label")).find(
      (label) => label.textContent?.startsWith("Value"),
    );
    expect(valueLabel?.hidden).toBe(false);
  });

  it("does not rewrite sibling params when editing a value", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [
            { name: "ref", value: "rogatio" },
            { name: "utm", operation: "set", value: "old" },
          ],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const utmValue = Array.from(
      ctx.container.querySelectorAll('[data-query-param-row="1"] input'),
    ).find((input) => input.parentElement?.textContent?.startsWith("Value"));
    expect(utmValue).toBeInstanceOf(HTMLInputElement);
    const valueInput = utmValue as HTMLInputElement;
    valueInput.value = "new";
    valueInput.dispatchEvent(new Event("input"));
    expect(ctx.getAction()?.params).toEqual([
      { name: "ref", value: "rogatio" },
      { name: "utm", operation: "set", value: "new" },
    ]);
  });

  it("add parameter writes operation set with empty name and value", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        action: {
          type: "query",
          params: [{ name: "ref", value: "rogatio" }],
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
      deleteField: ctx.deleteField,
      registerControl: () => {},
    });
    const addButton = Array.from(ctx.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add parameter",
    );
    addButton?.click();
    expect(ctx.getAction()?.params).toEqual([
      { name: "ref", value: "rogatio" },
      { name: "", operation: "set", value: "" },
    ]);
  });
});
