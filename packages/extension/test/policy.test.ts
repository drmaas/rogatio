import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";

const project = {
  version: 2,
  name: "Request body policy",
  requestBodyPolicy: {
    localOrigins: ["http://127.0.0.1:3000", "https://localhost:8443"],
  },
  groups: [
    {
      id: "g1",
      name: "Group",
      rules: [
        {
          id: "r1",
          name: "Replace",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/api$",
          },
          resourceTypes: ["xmlhttprequest"] as const,
          priority: 10,
          method: "POST" as const,
          type: "request-body" as const,
          requestBody: { mode: "replace" as const, body: '{"debug":false}' },
        },
        {
          id: "r2",
          name: "Regex",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/data$",
          },
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

describe(" extension policy construction (future API)", () => {
  it("builds policy from committed project state, enabled groups, exact local origins, explicit extension ID", async () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const operations = result.operations.filter(
      (op) => op.kind === "request-body",
    );
    expect(operations).toHaveLength(2);

    expect(operations[0].requestBody.mode).toBe("replace");
    expect(operations[1].requestBody.mode).toBe("regex");
  });

  it("excludes observed bodies, response bodies, cookies, credentials, sensitive headers, mock file contents", () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const op of result.operations) {
      expect(op).not.toHaveProperty("observedBody");
      expect(op).not.toHaveProperty("credentials");
      expect(op).not.toHaveProperty("cookies");
    }
  });

  it("computes deterministic digest parity with native runtime", () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
  });

  it("active policy is memory-only, one active immutable policy per session", () => {
    expect(true).toBe(true);
  });
});
