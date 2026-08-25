import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/index.js";

function project(rule: Record<string, unknown>) {
  return {
    version: 1,
    name: "Response body",
    groups: [
      {
        id: "g1",
        name: "Group",
        origins: ["https://example.com"],
        rules: [rule],
      },
    ],
  };
}

const base = {
  id: "r1",
  name: "Rewrite",
  urlRegex: "^https://example\\.com/data$",
  origins: [],
  resourceTypes: ["xmlhttprequest"],
  priority: 1,
  type: "response-body",
  responseBody: { replacements: [{ pattern: "old", replacement: "new" }] },
};

describe("F15 response-body schema", () => {
  it("accepts an ordered replacement list", () =>
    expect(validateProjectDetailed(project(base)).valid).toBe(true));
  it.each([
    ["missing action", { ...base, responseBody: undefined }],
    ["empty replacements", { ...base, responseBody: { replacements: [] } }],
    [
      "invalid pattern",
      {
        ...base,
        responseBody: { replacements: [{ pattern: "[", replacement: "x" }] },
      },
    ],
    [
      "unknown property",
      {
        ...base,
        responseBody: {
          replacements: [{ pattern: "x", replacement: "y" }],
          body: "no",
        },
      },
    ],
  ])("rejects %s", (_name, rule) =>
    expect(validateProjectDetailed(project(rule)).valid).toBe(false),
  );
});
