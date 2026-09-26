import { describe, expect, it } from "vitest";
import { LIMITS, validateProjectDetailed } from "../src/index.js";

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

const baseRegex = {
  id: "r1",
  name: "Rewrite",
  source: {
    key: "url",
    operator: "regex",
    value: "^https://example\\.com/data$",
  },

  resourceTypes: ["xmlhttprequest"],
  priority: 1,
  type: "response-body",
  responseBody: { replacements: [{ pattern: "old", replacement: "new" }] },
};

const baseTaggedRegex = {
  ...baseRegex,
  responseBody: {
    mode: "regex",
    replacements: [{ pattern: "old", replacement: "new" }],
  },
};

const baseReplace = {
  ...baseRegex,
  responseBody: { mode: "replace", body: '{"replaced":true}' },
};

describe(" response-body schema", () => {
  it("accepts untagged regex replacements", () =>
    expect(validateProjectDetailed(project(baseRegex)).valid).toBe(true));

  it("accepts tagged regex replacements", () =>
    expect(validateProjectDetailed(project(baseTaggedRegex)).valid).toBe(true));

  it("accepts replace mode with body", () =>
    expect(validateProjectDetailed(project(baseReplace)).valid).toBe(true));

  it.each([
    ["missing action", { ...baseRegex, responseBody: undefined }],
    [
      "empty replacements",
      { ...baseRegex, responseBody: { replacements: [] } },
    ],
    [
      "invalid pattern",
      {
        ...baseRegex,
        responseBody: { replacements: [{ pattern: "[", replacement: "x" }] },
      },
    ],
    [
      "replace missing body",
      { ...baseReplace, responseBody: { mode: "replace" } },
    ],
    [
      "replace with replacements",
      {
        ...baseReplace,
        responseBody: {
          mode: "replace",
          body: "x",
          replacements: [{ pattern: "a", replacement: "b" }],
        },
      },
    ],
    [
      "unknown property on untagged regex",
      {
        ...baseRegex,
        responseBody: {
          replacements: [{ pattern: "x", replacement: "y" }],
          body: "no",
        },
      },
    ],
  ])("rejects %s", (_name, rule) => {
    expect(validateProjectDetailed(project(rule)).valid).toBe(false);
  });

  it("rejects replace body over maxResponseBodyBytes", () => {
    const body = "x".repeat(LIMITS.maxResponseBodyBytes + 1);
    expect(
      validateProjectDetailed(
        project({
          ...baseReplace,
          responseBody: { mode: "replace", body },
        }),
      ).valid,
    ).toBe(false);
  });
});
