import { compileProject } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it } from "vitest";

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

describe("@rogatio/compiler redirect operations", () => {
  it("emits a RedirectOperation for redirect rules", () => {
    const project = projectWith({
      id: "rule-redirect",
      name: "Redirect rule",
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/(.*)$",
      },
      resourceTypes: ["main_frame"],
      priority: 100,
      type: "redirect",
      redirect: { destination: "https://other.com/\\1" },
    });
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      kind: "redirect",
      groupId: "group-main",
      ruleId: "rule-redirect",
      redirect: { destination: "https://other.com/\\1" },
    });
  });

  it("emits a MatcherOperation for actionless rules", () => {
    const project = projectWith({
      id: "rule-matcher",
      name: "Matcher rule",
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame"],
      priority: 100,
    });
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.operations[0]).toMatchObject({
      kind: "matcher",
      ruleId: "rule-matcher",
    });
  });
});
