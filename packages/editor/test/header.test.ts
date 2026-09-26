// @vitest-environment happy-dom

import type { RogatioRule } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createHeaderRuleType } from "../src/index.js";

const ext = createHeaderRuleType();
const rulePath = "/groups/0/rules/0";

const headerSetRule: RogatioRule = {
  id: "rule-header-set",
  name: "Set header",
  source: { key: "url", operator: "regex", value: "^https://example\\.com/" },
  resourceTypes: ["main_frame"],
  priority: 100,
  type: "header",
  headerDirection: "request",
  headerOperation: "set",
  headerName: "X-Test",
  headerValue: "enabled",
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
  };
}

describe("@rogatio/editor header rule type", () => {
  it("matches header rules only", () => {
    expect(
      ext.matches(headerSetRule as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(ext.matches({ type: "redirect" })).toBe(false);
  });

  it("provides defaultFields for a new request set rule", () => {
    expect(ext.defaultFields?.()).toEqual({
      headerDirection: "request",
      headerOperation: "set",
      headerName: "",
      headerValue: "",
    });
  });

  it("validates a well-formed set rule", () => {
    expect(
      ext.validate(
        headerSetRule as unknown as Record<string, unknown>,
        rulePath,
      ),
    ).toEqual([]);
  });

  it("validates a remove rule without headerValue", () => {
    expect(
      ext.validate(
        {
          type: "header",
          headerDirection: "response",
          headerOperation: "remove",
          headerName: "X-Test",
        },
        rulePath,
      ),
    ).toEqual([]);
  });

  it("rejects headerValue on remove", () => {
    const diagnostics = ext.validate(
      {
        type: "header",
        headerDirection: "response",
        headerOperation: "remove",
        headerName: "X-Test",
        headerValue: "",
      },
      rulePath,
    );
    expect(diagnostics.some((d) => d.path.endsWith("/headerValue"))).toBe(true);
  });

  it("lists set and remove in the operation select by default", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        headerDirection: "request",
        headerOperation: "set",
        headerName: "",
        headerValue: "",
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
    const operationSelect = ctx.container.querySelectorAll("select")[1] as
      | HTMLSelectElement
      | undefined;
    expect(operationSelect).toBeDefined();
    expect(
      Array.from(operationSelect?.options ?? []).map((option) => option.value),
    ).toEqual(["set", "remove"]);
  });

  it("shows append in the operation select only while it is the current value", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        headerDirection: "request",
        headerOperation: "append",
        headerName: "X-Test",
        headerValue: "1",
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
    const operationSelect = ctx.container.querySelectorAll("select")[1] as
      | HTMLSelectElement
      | undefined;
    expect(
      Array.from(operationSelect?.options ?? []).map((option) => option.value),
    ).toEqual(["set", "append", "remove"]);
  });

  it("hides the value input when mounting a remove rule", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        headerDirection: "response",
        headerOperation: "remove",
        headerName: "X-Test",
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
      (label) => label.textContent?.startsWith("Header value"),
    );
    expect(valueLabel?.hidden).toBe(true);
    expect(ctx.deleteField).not.toHaveBeenCalled();
  });

  it("hides the value input and deletes headerValue when operation becomes remove", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        headerDirection: "request",
        headerOperation: "set",
        headerName: "X-Test",
        headerValue: "enabled",
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
    const selects = ctx.container.querySelectorAll("select");
    const operationSelect = selects[1] as HTMLSelectElement;
    operationSelect.value = "remove";
    operationSelect.dispatchEvent(new Event("change"));
    expect(ctx.deleteField).toHaveBeenCalledWith("headerValue");
    const valueLabel = Array.from(ctx.container.querySelectorAll("label")).find(
      (label) => label.textContent?.startsWith("Header value"),
    );
    expect(valueLabel?.hidden).toBe(true);
    expect(ctx.getField("headerValue")).toBeUndefined();
  });
});
