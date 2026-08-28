import { describe, expect, it } from "vitest";
import { compileProject } from "../src/index.js";

const project = {
  version: 1,
  name: "Response body",
  groups: [
    {
      id: "g1",
      name: "Group",
      origins: ["https://example.com"],
      rules: [
        {
          id: "r1",
          name: "Rewrite",
          urlRegex: "^https://example\\.com/data$",
          origins: [],
          resourceTypes: ["xmlhttprequest"],
          priority: 1,
          type: "response-body",
          responseBody: {
            replacements: [
              { pattern: "old", replacement: "new" },
              { pattern: "new", replacement: "final" },
            ],
          },
        },
      ],
    },
  ],
};

describe(" response-body compiler", () => {
  it("emits a deterministic ResponseBodyOperation", () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({
      kind: "response-body",
      groupId: "g1",
      ruleId: "r1",
      responseBody: {
        replacements: project.groups[0].rules[0].responseBody.replacements,
      },
    });
  });
});
