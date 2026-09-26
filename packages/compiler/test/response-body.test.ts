import { describe, expect, it } from "vitest";
import { compileProject } from "../src/index.js";

function project(responseBody: Record<string, unknown>) {
  return {
    version: 2,
    name: "Response body",
    groups: [
      {
        id: "g1",
        name: "Group",

        rules: [
          {
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
            responseBody,
          },
        ],
      },
    ],
  };
}

describe(" response-body compiler", () => {
  it("emits untagged regex replacements unchanged", () => {
    const replacements = [
      { pattern: "old", replacement: "new" },
      { pattern: "new", replacement: "final" },
    ];
    const result = compileProject(project({ replacements }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({
      kind: "response-body",
      groupId: "g1",
      ruleId: "r1",
      responseBody: { replacements },
    });
  });

  it("emits tagged replace mode unchanged", () => {
    const responseBody = { mode: "replace", body: '{"ok":true}' };
    const result = compileProject(project(responseBody));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({
      kind: "response-body",
      responseBody,
    });
  });

  it("emits tagged regex mode unchanged", () => {
    const responseBody = {
      mode: "regex",
      replacements: [{ pattern: "old", replacement: "new" }],
    };
    const result = compileProject(project(responseBody));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({
      kind: "response-body",
      responseBody,
    });
  });
});
