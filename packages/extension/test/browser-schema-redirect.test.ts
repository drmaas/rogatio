import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/browser-schema.js";

const redirectRule = {
  id: "rule-redirect",
  name: "Redirect rule",
  urlRegex: "^https://example\\.com/(.*)$",
  origins: [],
  resourceTypes: ["main_frame"],
  priority: 100,
  type: "redirect" as const,
  redirect: { destination: "https://other.com/\\1" },
};

const baseProject = {
  version: 1,
  name: "Example project",
  groups: [
    {
      id: "group-main",
      name: "Main sites",
      origins: ["https://example.com"],
      rules: [redirectRule],
    },
  ],
};

describe("F9 browser schema redirect rules", () => {
  it("accepts a valid redirect rule", () => {
    expect(validateProjectDetailed(baseProject)).toMatchObject({ valid: true });
  });

  it("rejects a redirect rule without a destination", () => {
    expect(
      validateProjectDetailed({
        ...baseProject,
        groups: [
          {
            ...baseProject.groups[0],
            rules: [{ ...redirectRule, redirect: {} }],
          },
        ],
      }),
    ).toMatchObject({
      valid: false,
      errors: [{ instancePath: "/groups/0/rules/0/redirect/destination" }],
    });
  });

  it("rejects a redirect rule whose backreference exceeds capture groups", () => {
    const result = validateProjectDetailed({
      ...baseProject,
      groups: [
        {
          ...baseProject.groups[0],
          rules: [
            {
              ...redirectRule,
              urlRegex: "^https://example\\.com/(a)$",
              redirect: { destination: "https://other.com/\\3" },
            },
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "schema.invalid-value"),
      ).toBe(true);
    }
  });

  it("rejects an unknown rule type value", () => {
    expect(
      validateProjectDetailed({
        ...baseProject,
        groups: [
          {
            ...baseProject.groups[0],
            rules: [{ ...redirectRule, type: "header" }],
          },
        ],
      }),
    ).toMatchObject({
      valid: false,
      errors: [
        { instancePath: "/groups/0/rules/0/type", keyword: "invalid-value" },
      ],
    });
  });
});
