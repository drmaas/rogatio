// @vitest-environment happy-dom

import { LIMITS } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createResponseBodyRuleType } from "../src/index.js";

const ext = createResponseBodyRuleType();
const rulePath = "/groups/0/rules/0";

function createMountContext(
  fields: Record<string, unknown>,
  document: Document,
) {
  const store = { ...fields };
  const container = document.createElement("div");
  const setField = vi.fn((name: string, value: unknown) => {
    store[name] = value;
  });
  return {
    container,
    setField,
    getField: (name: string) => store[name],
    getResponseBody: () =>
      store.responseBody as Record<string, unknown> | undefined,
  };
}

describe("@rogatio/editor response-body rule type", () => {
  it("provides a default replace payload on responseBody for new rules", () => {
    expect(ext.actionField).toBe("responseBody");
    expect(ext.label).toBe("Response body");
    expect(ext.defaultAction?.()).toEqual({ mode: "replace", body: "" });
  });

  it("is selectable and validates replace mode", () => {
    expect(ext.id).toBe("response-body");
    expect(ext.matches({ type: "response-body" })).toBe(true);
    expect(
      ext.validate(
        {
          type: "response-body",
          responseBody: { mode: "replace", body: '{"debug":false}' },
        },
        rulePath,
      ),
    ).toEqual([]);
  });

  it("is selectable and validates tagged regex mode", () => {
    expect(
      ext.validate(
        {
          type: "response-body",
          responseBody: {
            mode: "regex",
            replacements: [{ pattern: "a", replacement: "b" }],
          },
        },
        rulePath,
      ),
    ).toEqual([]);
  });

  it("matches and validates untagged regex replacements", () => {
    const untagged = {
      type: "response-body",
      responseBody: { replacements: [{ pattern: "a", replacement: "b" }] },
    };
    expect(ext.matches(untagged)).toBe(true);
    expect(ext.validate(untagged, rulePath)).toEqual([]);
  });

  it("rejects invalid mode", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: { mode: "invalid", body: "x" },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-mode"),
    ).toBe(true);
  });

  it("rejects missing body in replace mode", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: { mode: "replace" },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-replace-body"),
    ).toBe(true);
  });

  it("rejects tagged regex mode without replacements", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: { mode: "regex" },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-replacements"),
    ).toBe(true);
  });

  it("rejects empty regex replacements", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: { mode: "regex", replacements: [] },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-replacements"),
    ).toBe(true);
  });

  it("rejects invalid regex pattern", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: {
          mode: "regex",
          replacements: [{ pattern: "[", replacement: "x" }],
        },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-pattern"),
    ).toBe(true);
  });

  it("rejects oversized replace body", () => {
    const diagnostics = ext.validate(
      {
        type: "response-body",
        responseBody: {
          mode: "replace",
          body: "x".repeat(LIMITS.maxResponseBodyBytes + 1),
        },
      },
      rulePath,
    );
    expect(
      diagnostics.some((d) => d.code === "editor.response-body-replace-body"),
    ).toBe(true);
  });

  it("lists replace and regex rewrite in the mode select", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      { responseBody: { mode: "replace", body: "" } },
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
    const modeSelect = ctx.container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(modeSelect).toBeDefined();
    expect(modeSelect?.value).toBe("replace");
    expect(
      Array.from(modeSelect?.options ?? []).map((option) => option.value),
    ).toEqual(["replace", "regex"]);
    expect(
      Array.from(modeSelect?.options ?? []).map((option) => option.textContent),
    ).toEqual(["Replace body", "Regex rewrite"]);
  });

  it("shows a body textarea in replace mode", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      { responseBody: { mode: "replace", body: "hello" } },
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
    const textarea = ctx.container.querySelector("textarea");
    expect(textarea?.value).toBe("hello");
    expect(
      ctx.container.querySelector("[data-response-body-replacement]"),
    ).toBeNull();
  });

  it("mounts replace form from defaultAction when responseBody was absent", () => {
    const document = globalThis.document;
    const ctx = createMountContext({}, document);
    ctx.setField("responseBody", ext.defaultAction?.());
    ext.mount({
      document,
      container: ctx.container,
      rulePath,
      getField: ctx.getField,
      setField: ctx.setField,
      deleteField: () => {},
      registerControl: () => {},
    });
    const modeSelect = ctx.container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(modeSelect?.value).toBe("replace");
    expect(ctx.container.querySelector("textarea")).not.toBeNull();
    expect(ctx.getResponseBody()).toEqual({ mode: "replace", body: "" });
  });

  it("switches from replace to regex rewrite and remounts replacement rows", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      { responseBody: { mode: "replace", body: "hello" } },
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
    const modeSelect = ctx.container.querySelector(
      "select",
    ) as HTMLSelectElement;
    modeSelect.value = "regex";
    modeSelect.dispatchEvent(new Event("change"));
    expect(ctx.getResponseBody()).toEqual({
      mode: "regex",
      replacements: [{ pattern: "", replacement: "" }],
    });
    expect(ctx.container.querySelector("textarea")).toBeNull();
    expect(
      ctx.container.querySelector("[data-response-body-replacement]"),
    ).not.toBeNull();
  });

  it("switches from untagged regex to replace and writes explicit replace payload", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        responseBody: {
          replacements: [{ pattern: "debug", replacement: "fixed" }],
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
      registerControl: () => {},
    });
    const modeSelect = ctx.container.querySelector(
      "select",
    ) as HTMLSelectElement;
    modeSelect.value = "replace";
    modeSelect.dispatchEvent(new Event("change"));
    expect(ctx.getResponseBody()).toEqual({ mode: "replace", body: "" });
    expect(ctx.container.querySelector("textarea")).not.toBeNull();
    expect(
      ctx.container.querySelector("[data-response-body-replacement]"),
    ).toBeNull();
  });

  it("mounts untagged replacements as regex rewrite rows", () => {
    const document = globalThis.document;
    const ctx = createMountContext(
      {
        responseBody: {
          replacements: [{ pattern: "debug", replacement: "fixed" }],
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
      registerControl: () => {},
    });
    const modeSelect = ctx.container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(modeSelect?.value).toBe("regex");
    const row = ctx.container.querySelector(
      "[data-response-body-replacement='0']",
    );
    expect(row).not.toBeNull();
    const pattern = row?.querySelector("input[placeholder='Pattern']");
    expect((pattern as HTMLInputElement | null)?.value).toBe("debug");
  });
});
