import type { RogatioRule } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { createRedirectRuleType } from "../src/index.js";

const ext = createRedirectRuleType();

const redirectRule: RogatioRule = {
  id: "rule-redirect",
  name: "Redirect rule",
  urlRegex: "^https://example\\.com/(.*)$",
  origins: [],
  resourceTypes: ["main_frame"],
  priority: 100,
  type: "redirect",
  redirect: { destination: "https://other.com/\\1" },
};

describe("@rogatio/editor redirect rule type", () => {
  it("matches redirect rules only", () => {
    expect(
      ext.matches(redirectRule as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(
      ext.matches({
        ...redirectRule,
        type: undefined,
      } as unknown as Record<string, unknown>),
    ).toBe(false);
    expect(
      ext.matches({
        ...redirectRule,
        type: "header",
      } as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  it("validates a well-formed redirect destination", () => {
    expect(
      ext.validate(
        redirectRule as unknown as Record<string, unknown>,
        "/groups/0/rules/0",
      ),
    ).toEqual([]);
  });

  it("reports a missing destination", () => {
    const rule = { ...redirectRule, redirect: {} };
    const diagnostics = ext.validate(
      rule as unknown as Record<string, unknown>,
      "/groups/0/rules/0",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].path).toBe("/groups/0/rules/0/redirect/destination");
  });

  it("reports a backreference that exceeds capture groups", () => {
    const rule = {
      ...redirectRule,
      urlRegex: "^https://example\\.com/(a)$",
      redirect: { destination: "https://other.com/\\3" },
    };
    const diagnostics = ext.validate(
      rule as unknown as Record<string, unknown>,
      "/groups/0/rules/0",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
  });
});
