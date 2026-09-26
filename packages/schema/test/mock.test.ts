import { describe, expect, it } from "vitest";
import type { RogatioProject } from "../src/index.js";
import { validateProjectDetailed } from "../src/index.js";

function mockRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-mock",
    name: "Mock rule",
    source: { key: "url", operator: "regex", value: "^https://example\\.com/" },

    resourceTypes: ["main_frame" as const],
    priority: 100,
    type: "mock" as const,
    mock: { status: 200, body: "hello" },
    ...overrides,
  };
}

function projectWith(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 2,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",

        rules: [rule as never],
      },
    ],
  };
}

describe("@rogatio/schema mock rules removed", () => {
  it("rejects type mock with a stable enum diagnostic", () => {
    const result = validateProjectDetailed(projectWith(mockRule()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/type" &&
            error.keyword === "enum",
        ),
      ).toBe(true);
    }
  });

  it("rejects unknown mock payload property on a rule", () => {
    const rule = {
      id: "rule-mock",
      name: "Mock rule",
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },

      resourceTypes: ["main_frame" as const],
      priority: 100,
      mock: { status: 200, body: "hello" },
    };
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });
});
