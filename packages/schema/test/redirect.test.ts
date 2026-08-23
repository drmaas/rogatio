import { describe, expect, it } from "vitest";
import {
  countCapturingGroups,
  type RogatioProject,
  validateProjectDetailed,
  validateRedirectDestination,
} from "../src/index.js";

function redirectRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-redirect",
    name: "Redirect rule",
    urlRegex: "^https://example\\.com/(.*)$",
    origins: [],
    resourceTypes: ["main_frame" as const],
    priority: 100,
    type: "redirect" as const,
    redirect: { destination: "https://other.com/\\1" },
    ...overrides,
  };
}

function projectWith(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 1,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        origins: ["https://example.com"],
        rules: [rule as never],
      },
    ],
  };
}

describe("@rogatio/schema redirect rules", () => {
  it("accepts a valid redirect rule with a backreference", () => {
    const result = validateProjectDetailed(projectWith(redirectRule()));
    expect(result).toMatchObject({ valid: true });
  });

  it("rejects a redirect rule without a destination", () => {
    const rule = redirectRule({ redirect: {} });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/redirect" &&
            (error.params as { missingProperty?: string }).missingProperty ===
              "destination",
        ),
      ).toBe(true);
    }
  });

  it("rejects a redirect rule whose backreference exceeds capture groups", () => {
    const rule = redirectRule({
      urlRegex: "^https://example\\.com/(a)$",
      redirect: { destination: "https://other.com/\\3" },
    });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "schema.invalid-value"),
      ).toBe(true);
    }
  });

  it("rejects an unknown rule type value", () => {
    const rule = redirectRule({ type: "header" });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result).toMatchObject({
      valid: false,
      errors: [{ instancePath: "/groups/0/rules/0/type", keyword: "enum" }],
    });
  });

  it("counts capturing groups while excluding non-capturing groups", () => {
    expect(countCapturingGroups("(a)(b)(c)")).toBe(3);
    expect(countCapturingGroups("(?:a)(b)")).toBe(1);
    expect(countCapturingGroups("(?=x)(y)")).toBe(1);
    expect(countCapturingGroups("(?<name>x)(y)")).toBe(1);
    expect(countCapturingGroups("no groups \\( escaped")).toBe(0);
  });

  it("validates redirect destinations directly", () => {
    expect(
      validateRedirectDestination("https://other.com/\\1", "(.*)"),
    ).toEqual([]);
    expect(
      validateRedirectDestination("https://other.com/\\3", "(a)").length,
    ).toBeGreaterThan(0);
    expect(
      validateRedirectDestination("ftp://other.com/", "(a)").length,
    ).toBeGreaterThan(0);
    expect(
      validateRedirectDestination("https://user:pass@other.com/", "(a)").length,
    ).toBeGreaterThan(0);
    expect(
      validateRedirectDestination("https://*.other.com/", "(a)").length,
    ).toBeGreaterThan(0);
    expect(validateRedirectDestination("", "(a)").length).toBeGreaterThan(0);
    expect(
      validateRedirectDestination("not a url", "(a)").length,
    ).toBeGreaterThan(0);
    expect(
      validateRedirectDestination(
        `https://other.com/${"a".repeat(3000)}`,
        "(a)",
      ).length,
    ).toBeGreaterThan(0);
  });
});
