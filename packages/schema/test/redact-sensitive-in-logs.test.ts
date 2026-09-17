import { describe, expect, it } from "vitest";
import {
  type RogatioProject,
  safeClone,
  validateProject,
  validateProjectDetailed,
} from "../src/index.js";

function makeRule(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `rule-${index}`,
    name: `Rule ${index}`,
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame" as const],
    priority: 100,
    ...overrides,
  };
}

function makeProject(
  ruleOverrides: Record<string, unknown> = {},
): RogatioProject {
  return {
    version: 1,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        origins: ["https://example.com"],
        rules: [makeRule(1, ruleOverrides)],
      },
    ],
  };
}

describe("redactSensitiveInLogs schema", () => {
  it("accepts omitted, true, and false", () => {
    expect(validateProject(makeProject())).toBe(true);
    expect(validateProject(makeProject({ redactSensitiveInLogs: true }))).toBe(
      true,
    );
    expect(validateProject(makeProject({ redactSensitiveInLogs: false }))).toBe(
      true,
    );
  });

  it("rejects non-booleans, extra rule keys, and redactBodiesInLogs", () => {
    for (const value of ["true", 1]) {
      expect(
        validateProject(makeProject({ redactSensitiveInLogs: value })),
      ).toBe(false);
    }

    const extraKey = validateProjectDetailed({
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [{ ...makeRule(1), unexpectedRuleKey: true }],
        },
      ],
    });
    expect(extraKey.valid).toBe(false);
    if (!extraKey.valid) {
      expect(
        extraKey.errors.some(
          (error) => error.keyword === "additionalProperties",
        ),
      ).toBe(true);
    }

    const bodyRedact = validateProjectDetailed(
      makeProject({ redactBodiesInLogs: true }),
    );
    expect(bodyRedact.valid).toBe(false);
    if (!bodyRedact.valid) {
      expect(
        bodyRedact.errors.some(
          (error) => error.keyword === "additionalProperties",
        ),
      ).toBe(true);
    }
  });

  it("does not inject redactSensitiveInLogs when omitted", () => {
    const project = makeProject();
    const clone = safeClone(project) as RogatioProject;
    validateProject(clone);
    expect(clone.groups[0]?.rules[0]).not.toHaveProperty(
      "redactSensitiveInLogs",
    );
  });
});
