import { createRequestBodyRuleType } from "@rogatio/editor";
import { describe, expect, it } from "vitest";

describe(" request-body editor extension", () => {
  it("is selectable and validates replace mode", () => {
    const extension = createRequestBodyRuleType();
    expect(extension.id).toBe("request-body");
    expect(extension.matches({ type: "request-body" })).toBe(true);
    expect(
      extension.validate(
        {
          type: "request-body",
          method: "POST",
          resourceTypes: ["xmlhttprequest"],
          requestBody: { mode: "replace", body: '{"debug":false}' },
        },
        "/groups/0/rules/0",
      ),
    ).toEqual([]);
  });

  it("is selectable and validates regex mode", () => {
    const extension = createRequestBodyRuleType();
    expect(
      extension.validate(
        {
          type: "request-body",
          method: "PATCH",
          resourceTypes: ["xmlhttprequest"],
          requestBody: {
            mode: "regex",
            pattern: '"debug"\\s*:\\s*true',
            replacement: '"debug":false',
          },
        },
        "/groups/0/rules/0",
      ),
    ).toEqual([]);
  });

  it("rejects invalid mode", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "invalid", body: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(diagnostics.some((d) => d.code === "editor.request-body-mode")).toBe(
      true,
    );
  });

  it("rejects missing body in replace mode", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "replace" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-replace-body"),
    ).toBe(true);
  });

  it("rejects missing pattern in regex mode", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "regex", replacement: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-pattern"),
    ).toBe(true);
  });

  it("rejects empty regex pattern", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "regex", pattern: "", replacement: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-pattern"),
    ).toBe(true);
  });

  it("rejects invalid regex pattern", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "regex", pattern: "[", replacement: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-pattern"),
    ).toBe(true);
  });

  it("rejects oversized values", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "replace", body: "x".repeat(5 * 1024 * 1024) },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-replace-body"),
    ).toBe(true);
  });

  it("rejects wrong method", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "GET",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "replace", body: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-method"),
    ).toBe(true);
  });

  it("rejects wrong resource type", () => {
    const extension = createRequestBodyRuleType();
    const diagnostics = extension.validate(
      {
        type: "request-body",
        method: "POST",
        resourceTypes: ["main_frame"],
        requestBody: { mode: "replace", body: "x" },
      },
      "/groups/0/rules/0",
    );
    expect(
      diagnostics.some((d) => d.code === "editor.request-body-resource-types"),
    ).toBe(true);
  });
});
