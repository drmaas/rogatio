import { compileProject } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it } from "vitest";

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

describe("@rogatio/compiler mock operations", () => {
  it("emits a MockOperation for a mock rule with an inline body", () => {
    const project = projectWith({
      id: "rule-mock",
      name: "Mock rule",
      urlRegex: "^https://example\\.com/",
      origins: [],
      resourceTypes: ["main_frame"],
      priority: 100,
      type: "mock",
      mock: {
        status: 200,
        headers: [{ name: "x-test", value: "1" }],
        body: "hello",
      },
    });
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      kind: "mock",
      groupId: "group-main",
      ruleId: "rule-mock",
      mock: {
        status: 200,
        headers: [{ name: "x-test", value: "1" }],
        body: "hello",
      },
    });
    const operation = result.operations[0];
    if (operation.kind !== "mock") throw new Error("expected mock operation");
    expect(operation.matcher).toMatchObject({
      urlRegex: { source: "^https://example\\.com/", flags: "" },
      origins: ["https://example.com"],
      resourceTypes: ["main_frame"],
      priority: 100,
    });
  });

  it("emits a MockOperation for a file mock rule", () => {
    const project = projectWith({
      id: "rule-mock-file",
      name: "File mock",
      urlRegex: "^https://example\\.com/",
      origins: [],
      resourceTypes: ["main_frame"],
      priority: 100,
      type: "mock",
      mock: { status: 201, delayMs: 100, file: "fixtures/data.json" },
    });
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.operations[0]).toMatchObject({
      kind: "mock",
      ruleId: "rule-mock-file",
      mock: { status: 201, delayMs: 100, file: "fixtures/data.json" },
    });
  });

  it("emits a MatcherOperation for actionless rules (unchanged)", () => {
    const project = projectWith({
      id: "rule-matcher",
      name: "Matcher rule",
      urlRegex: "^https://example\\.com/",
      origins: [],
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
