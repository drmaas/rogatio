import type { RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";

const PROJECT = {
  version: 1 as const,
  name: "request-body dry-run",
  groups: [
    {
      id: "g1",
      name: "group1",
      origins: ["https://example.com"],
      rules: [
        {
          id: "r1",
          name: "Replace body",
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
          name: "Regex replace",
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

function getOperations(): readonly RogatioOperation[] {
  const compiled = compileProject(PROJECT);
  if (!compiled.ok) {
    throw new Error(
      "fixture project failed to compile: " +
        JSON.stringify(compiled.diagnostics),
    );
  }
  return compiled.operations;
}

describe(" request-body dry-run behavior (future API)", () => {
  const operations = getOperations();

  it("compiles request-body operations with correct structure", () => {
    const requestBodyOps = operations.filter(
      (op) => op.kind === "request-body",
    );
    expect(requestBodyOps).toHaveLength(2);

    const replaceOp = requestBodyOps[0];
    expect(replaceOp.ruleId).toBe("r1");
    expect(replaceOp.matcher.priority).toBe(10);
    expect(replaceOp.requestBody.mode).toBe("replace");
    if (replaceOp.requestBody.mode === "replace") {
      expect(replaceOp.requestBody.body).toBe('{"debug":false}');
    }

    const regexOp = requestBodyOps[1];
    expect(regexOp.ruleId).toBe("r2");
    expect(regexOp.matcher.priority).toBe(5);
    expect(regexOp.requestBody.mode).toBe("regex");
    if (regexOp.requestBody.mode === "regex") {
      expect(regexOp.requestBody.pattern).toBe('"debug"\\s*:\\s*true');
    }
  });

  it("preserves source order for tie-breaking", () => {
    const requestBodyOps = operations.filter(
      (op) => op.kind === "request-body",
    );
    // r1 comes before r2 in source order
    expect(requestBodyOps[0].ruleId).toBe("r1");
    expect(requestBodyOps[1].ruleId).toBe("r2");
  });

  // Note: Current dryRunProject only accepts MatcherOperation[].
  //  requires shared arbitration in dry-run which will need either:
  // 1. An additive dry-run contract accepting RogatioOperation[]
  // 2. Or explicit limitation of  dry-run evidence to compiler/CLI selector checks
  // This test documents the expected behavior for when the contract is extended.
});
