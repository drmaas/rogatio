import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/browser-schema.js";
import { project } from "./fixtures.js";

function makeProject(ruleOverrides: Record<string, unknown> = {}) {
  return {
    ...project,
    groups: [
      {
        ...project.groups[0],
        rules: [{ ...project.groups[0].rules[0], ...ruleOverrides }],
      },
    ],
  };
}

describe("browser schema redactSensitiveInLogs", () => {
  it("accepts omitted, true, and false", () => {
    expect(validateProjectDetailed(makeProject())).toMatchObject({
      valid: true,
    });
    expect(
      validateProjectDetailed(makeProject({ redactSensitiveInLogs: true })),
    ).toMatchObject({ valid: true });
    expect(
      validateProjectDetailed(makeProject({ redactSensitiveInLogs: false })),
    ).toMatchObject({ valid: true });
  });

  it("rejects non-booleans, extra rule keys, and redactBodiesInLogs", () => {
    for (const value of ["true", 1]) {
      expect(
        validateProjectDetailed(makeProject({ redactSensitiveInLogs: value })),
      ).toMatchObject({ valid: false });
    }

    expect(
      validateProjectDetailed({
        ...makeProject(),
        groups: [
          {
            ...makeProject().groups[0],
            rules: [
              { ...makeProject().groups[0].rules[0], extraRuleKey: true },
            ],
          },
        ],
      }),
    ).toMatchObject({
      valid: false,
      errors: [{ keyword: "unknown-property" }],
    });

    expect(
      validateProjectDetailed(makeProject({ redactBodiesInLogs: true })),
    ).toMatchObject({
      valid: false,
      errors: [{ keyword: "unknown-property" }],
    });
  });

  it("does not inject redactSensitiveInLogs when omitted", () => {
    const candidate = makeProject();
    expect(validateProjectDetailed(candidate)).toMatchObject({ valid: true });
    expect(candidate.groups[0].rules[0]).not.toHaveProperty(
      "redactSensitiveInLogs",
    );
  });
});
