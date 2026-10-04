import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import {
  type CompileResult,
  type CompilerDiagnostic,
  compileProject,
  type MockOperation,
  type RogatioOperation,
  selectWinningOperation,
} from "../src/index.js";

function mockRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-mock",
    name: "Mock rule",
    source: { key: "url", operator: "regex", value: "^https://example\\.com/" },
    resourceTypes: ["main_frame"],
    priority: 100,
    type: "mock",
    mock: { status: 200, body: "hello" },
    ...overrides,
  };
}

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
  } as RogatioProject;
}

function expectFailure(
  result: CompileResult,
): asserts result is Extract<CompileResult, { ok: false }> {
  expect(result.ok).toBe(false);
  expect(result.operations).toEqual([]);
  if (result.ok) throw new Error("Expected compilation to fail");
}

describe("@rogatio/compiler mock rules", () => {
  it("compiles a valid mock into exactly one MockOperation", () => {
    const result = compileProject(projectWith(mockRule()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.kind).toBe("mock");
    expect(result.operations[0]?.kind).not.toBe("matcher");
  });

  it("carries groupId, ruleId, name, redactSensitiveInLogs, matcher, and mock field-by-field", () => {
    const result = compileProject(
      projectWith(
        mockRule({
          id: "mock-1",
          name: "API mock",
          redactSensitiveInLogs: true,
          method: "POST",
          priority: 500,
          resourceTypes: ["xmlhttprequest", "main_frame"],
          mock: {
            status: 404,
            delayMs: 50,
            headers: [{ name: "X-Test", value: "v" }],
            body: '{"ok":false}',
          },
        }),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const op = result.operations[0] as MockOperation;
    expect(op).toEqual({
      kind: "mock",
      groupId: "group-main",
      ruleId: "mock-1",
      name: "API mock",
      redactSensitiveInLogs: true,
      matcher: {
        source: {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/",
        },
        resourceTypes: ["main_frame", "xmlhttprequest"],
        priority: 500,
        method: "POST",
      },
      mock: {
        status: 404,
        delayMs: 50,
        headers: [{ name: "X-Test", value: "v" }],
        body: '{"ok":false}',
      },
    });
  });

  it("preserves file-backed mock payload unchanged", () => {
    const result = compileProject(
      projectWith(
        mockRule({
          mock: {
            status: 200,
            file: "responses/data.bin",
          },
        }),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0] as MockOperation;
    expect(op.mock).toEqual({
      status: 200,
      file: "responses/data.bin",
    });
  });

  it("maps mock body-source violations to compiler.mock-body-source with stable paths", () => {
    const both = compileProject(
      projectWith(
        mockRule({
          mock: { status: 200, body: "a", file: "responses/a.bin" },
        }),
      ),
    );
    expectFailure(both);
    expect(both.diagnostics).toEqual([
      expect.objectContaining({
        code: "compiler.mock-body-source",
        severity: "error",
        path: "/groups/0/rules/0/mock",
        message: "Mock rules require exactly one of body or file.",
      }),
    ]);

    const neither = compileProject(
      projectWith(mockRule({ mock: { status: 200 } })),
    );
    expectFailure(neither);
    expect(neither.diagnostics[0]).toMatchObject({
      code: "compiler.mock-body-source",
      path: "/groups/0/rules/0/mock",
    });
  });

  it("maps forbidden mock response headers to compiler.mock-forbidden-header", () => {
    const result = compileProject(
      projectWith(
        mockRule({
          mock: {
            status: 200,
            body: "x",
            headers: [{ name: "Content-Length", value: "0" }],
          },
        }),
      ),
    );

    expectFailure(result);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "compiler.mock-forbidden-header",
        severity: "error",
        path: "/groups/0/rules/0/mock/headers/0/name",
        params: {
          headerName: "Content-Length",
          headerDirection: "response",
        },
      }),
    ]);
  });

  it("fails closed for adversarial mock rule input without throwing", () => {
    const sparseHeaders = [] as Array<{ name: string; value: string }>;
    Object.setPrototypeOf(sparseHeaders, {
      0: { name: "X-Test", value: "v" },
    });
    sparseHeaders.length = 1;

    const cyclic = projectWith(mockRule()) as unknown as Record<
      string,
      unknown
    >;
    cyclic.groups = cyclic;

    for (const value of [
      projectWith(
        mockRule({
          mock: {
            status: 200,
            body: "x",
            headers: sparseHeaders,
          },
        }),
      ),
      cyclic,
      null,
      projectWith(mockRule({ mock: { status: 200 } })),
    ]) {
      expect(() => compileProject(value)).not.toThrow();
      expectFailure(compileProject(value));
    }
  });

  it("keeps the RogatioOperation union exhaustive for every emitted kind", () => {
    const kinds = new Set<string>();
    const samples: RogatioProject[] = [
      projectWith(mockRule()),
      {
        version: 2,
        name: "Kinds",
        groups: [
          {
            id: "g",
            name: "G",
            rules: [
              {
                id: "r",
                name: "R",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/$",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
              },
            ],
          },
        ],
      } as RogatioProject,
    ];

    for (const project of samples) {
      const result = compileProject(project);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const operation of result.operations) {
        kinds.add(operationKindLabel(operation));
      }
    }

    expect([...kinds].sort()).toEqual(["matcher", "mock"]);
  });
});

function operationKindLabel(operation: RogatioOperation): string {
  switch (operation.kind) {
    case "matcher":
      return "matcher";
    case "redirect":
      return "redirect";
    case "query":
      return "query";
    case "header":
      return "header";
    case "response-body":
      return "response-body";
    case "request-body":
      return "request-body";
    case "mock":
      return "mock";
    default: {
      const _exhaustive: never = operation;
      void _exhaustive;
      return "unknown";
    }
  }
}

function stableDiagnostics(diagnostics: readonly CompilerDiagnostic[]): string {
  return diagnostics
    .map(({ path, code }) => `${path}:${code}`)
    .sort()
    .join(",");
}

describe("@rogatio/compiler mock diagnostic stability", () => {
  it("does not echo unstable validation wording for mock failures", () => {
    const result = compileProject(
      projectWith(mockRule({ mock: { status: 200 } })),
    );
    expectFailure(result);
    expect(JSON.stringify(result.diagnostics)).not.toContain("must be");
    expect(stableDiagnostics(result.diagnostics)).toBe(
      "/groups/0/rules/0/mock:compiler.mock-body-source",
    );
  });
});

describe("@rogatio/compiler mock follow-ups", () => {
  it("rejects a mock rule with no mock payload instead of emitting an operation", () => {
    const rule = mockRule();
    delete (rule as { mock?: unknown }).mock;
    const result = compileProject(projectWith(rule));
    expectFailure(result);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "schema.required",
    );
  });

  it("maps a padded forbidden mock header to compiler.mock-forbidden-header", () => {
    const result = compileProject(
      projectWith(
        mockRule({
          mock: {
            status: 200,
            body: "x",
            headers: [{ name: " Content-Length ", value: "1" }],
          },
        }),
      ),
    );
    expectFailure(result);
    expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
      [
        "compiler.mock-forbidden-header",
        "/groups/0/rules/0/mock/headers/0/name",
      ],
    ]);
  });

  it("does not remap a forbidden header rule to the mock code", () => {
    const result = compileProject(
      projectWith({
        id: "rule-header",
        name: "Header rule",
        source: {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/",
        },
        resourceTypes: ["main_frame"],
        priority: 1,
        type: "header",
        headerDirection: "response",
        headerOperation: "set",
        headerName: "Content-Length",
        headerValue: "1",
      }),
    );
    expectFailure(result);
    expect(result.diagnostics[0]?.code).toBe("schema.invalid-value");
  });

  it("selects an enabled mock operation in the request phase", () => {
    const result = compileProject(projectWith(mockRule()));
    if (!result.ok) throw new Error("expected valid mock");
    const context = {
      url: "https://example.com/a",
      target: "https://example.com/a",
      method: "GET",
      initiator: "",
      resourceType: "main_frame",
      phase: "request",
    } as const;
    const winner = selectWinningOperation(
      result.operations,
      ["group-main"],
      context,
    );
    expect(winner.kind).toBe("winner");
    if (winner.kind === "winner") expect(winner.operation.kind).toBe("mock");
    expect(
      selectWinningOperation(result.operations, ["group-main"], {
        ...context,
        phase: "response",
      }).kind,
    ).toBe("none");
  });
});
