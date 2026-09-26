import {
  LIMITS,
  validateProjectDetailed as validateNode,
} from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { validateProjectDetailed as validateBrowser } from "../src/browser-schema.js";

function project(rule: Record<string, unknown>) {
  return {
    version: 2,
    name: "Response body",
    groups: [
      {
        id: "g1",
        name: "Group",
        rules: [rule],
      },
    ],
  };
}

const baseUntaggedRegex = {
  id: "r1",
  name: "Rewrite",
  source: {
    key: "url" as const,
    operator: "regex" as const,
    value: "^https://example\\.com/data$",
  },
  resourceTypes: ["xmlhttprequest"],
  priority: 1,
  type: "response-body",
  responseBody: { replacements: [{ pattern: "old", replacement: "new" }] },
};

const baseTaggedRegex = {
  ...baseUntaggedRegex,
  responseBody: {
    mode: "regex",
    replacements: [{ pattern: "old", replacement: "new" }],
  },
};

const baseReplace = {
  ...baseUntaggedRegex,
  responseBody: { mode: "replace", body: '{"replaced":true}' },
};

describe(" response-body browser schema", () => {
  it("accepts untagged regex replacements", () =>
    expect(validateBrowser(project(baseUntaggedRegex)).valid).toBe(true));

  it("accepts tagged regex replacements", () =>
    expect(validateBrowser(project(baseTaggedRegex)).valid).toBe(true));

  it("accepts replace mode with body", () =>
    expect(validateBrowser(project(baseReplace)).valid).toBe(true));

  it.each([
    ["missing action", { ...baseUntaggedRegex, responseBody: undefined }],
    [
      "empty replacements",
      {
        ...baseUntaggedRegex,
        responseBody: { replacements: [] },
      },
    ],
    [
      "invalid pattern",
      {
        ...baseUntaggedRegex,
        responseBody: { replacements: [{ pattern: "[", replacement: "x" }] },
      },
    ],
    [
      "replace missing body",
      { ...baseReplace, responseBody: { mode: "replace" } },
    ],
    [
      "unknown property on replace",
      {
        ...baseReplace,
        responseBody: { mode: "replace", body: "x", extra: 1 },
      },
    ],
  ])("rejects %s", (_name, rule) => {
    expect(validateBrowser(project(rule)).valid).toBe(false);
  });

  it("rejects replace body over maxResponseBodyBytes", () => {
    const body = "x".repeat(LIMITS.maxResponseBodyBytes + 1);
    expect(
      validateBrowser(
        project({
          ...baseReplace,
          responseBody: { mode: "replace", body },
        }),
      ).valid,
    ).toBe(false);
  });

  it("matches Node validation for valid payloads", () => {
    for (const rule of [baseUntaggedRegex, baseTaggedRegex, baseReplace]) {
      const nodeResult = validateNode(project(rule));
      const browserResult = validateBrowser(project(rule));
      expect(nodeResult.valid).toBe(browserResult.valid);
    }
  });

  it("matches Node validation for invalid payloads", () => {
    const invalidRule = {
      ...baseReplace,
      responseBody: { mode: "replace" },
    };
    const nodeResult = validateNode(project(invalidRule));
    const browserResult = validateBrowser(project(invalidRule));
    expect(nodeResult.valid).toBe(browserResult.valid);
  });
});
