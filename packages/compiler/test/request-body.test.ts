import { describe, expect, it } from "vitest";
import { compileProject } from "../src/index.js";

const project = {
  version: 1,
  name: "Request body",
  groups: [
    {
      id: "g1",
      name: "Group",
      origins: ["https://example.com"],
      rules: [
        {
          id: "r1",
          name: "Replace",
          urlRegex: "^https://example\\.com/api$",
          origins: [],
          resourceTypes: ["xmlhttprequest"] as const,
          priority: 10,
          method: "POST" as const,
          type: "request-body" as const,
          requestBody: { mode: "replace" as const, body: '{"debug":false}' },
        },
        {
          id: "r2",
          name: "Regex",
          urlRegex: "^https://example\\.com/data$",
          origins: [],
          resourceTypes: ["xmlhttprequest"] as const,
          priority: 5,
          method: "PATCH" as const,
          type: "request-body" as const,
          requestBody: {
            mode: "regex" as const,
            pattern: '"debug"\\s*:\\s*true',
            replacement: '"debug":false',
          },
        },
      ],
    },
  ],
};

describe(" request-body compiler", () => {
  it("emits detached RequestBodyOperation with source order", () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.operations).toHaveLength(2);

    const replaceOp = result.operations[0];
    expect(replaceOp).toMatchObject({
      kind: "request-body",
      groupId: "g1",
      ruleId: "r1",
      matcher: expect.objectContaining({
        urlRegex: { source: "^https://example\\.com/api$", flags: "" },
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
      }),
      requestBody: { mode: "replace", body: '{"debug":false}' },
    });

    const regexOp = result.operations[1];
    expect(regexOp).toMatchObject({
      kind: "request-body",
      groupId: "g1",
      ruleId: "r2",
      matcher: expect.objectContaining({
        urlRegex: { source: "^https://example\\.com/data$", flags: "" },
        resourceTypes: ["xmlhttprequest"],
        priority: 5,
        method: "PATCH",
      }),
      requestBody: {
        mode: "regex",
        pattern: '"debug"\\s*:\\s*true',
        replacement: '"debug":false',
      },
    });
  });

  it("preserves source order in operation array", () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.operations[0].ruleId).toBe("r1");
    expect(result.operations[1].ruleId).toBe("r2");
  });

  it("compiles invalid projects to no operations with diagnostics", () => {
    const invalidProject = {
      ...project,
      groups: [
        {
          ...project.groups[0],
          rules: [
            {
              ...project.groups[0].rules[0],
              requestBody: { mode: "replace" },
            },
          ],
        },
      ],
    };
    const result = compileProject(invalidProject);
    expect(result.ok).toBe(false);
  });
});
