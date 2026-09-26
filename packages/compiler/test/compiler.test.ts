import {
  type HeaderDirection,
  type HeaderOperationKind,
  LIMITS,
  RESOURCE_TYPES,
  type RogatioProject,
  type RogatioRule,
} from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { mapValidationIssues } from "../src/diagnostics.js";
import {
  type CompileResult,
  type CompilerDiagnostic,
  compileProject,
  type HeaderOperation,
} from "../src/index.js";

function makeRule(
  index: number,
  overrides: Record<string, unknown> = {},
): RogatioRule & Record<string, unknown> {
  return {
    id: `rule-${index}`,
    name: `Rule ${index}`,
    source: {
      key: "url" as const,
      operator: "regex" as const,
      value: "^https://example\\.com/",
    },
    resourceTypes: ["image", "main_frame"],
    priority: 100 + index,
    ...overrides,
  } as RogatioRule & Record<string, unknown>;
}

function makeHeaderRule(
  index: number,
  overrides: Record<string, unknown> = {},
): RogatioRule & Record<string, unknown> {
  return {
    id: `header-${index}`,
    name: `Header Rule ${index}`,
    source: {
      key: "url" as const,
      operator: "regex" as const,
      value: "^https://example\\.com/",
    },
    resourceTypes: ["main_frame"],
    priority: 100 + index,
    type: "header",
    headerDirection: "request",
    headerOperation: "set",
    headerName: "X-Custom-Header",
    headerValue: "test-value",
    ...overrides,
  } as RogatioRule & Record<string, unknown>;
}

function makeProject(
  groupOverrides: Record<string, unknown> = {},
  ruleOverrides: Record<string, unknown> = {},
): RogatioProject {
  return {
    version: 2,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        rules: [makeRule(1, ruleOverrides)],
        ...groupOverrides,
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
  expect(result.diagnostics.length).toBeGreaterThan(0);
}

function diagnostics(result: CompileResult): readonly CompilerDiagnostic[] {
  expectFailure(result);
  return result.diagnostics;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("@rogatio/compiler", () => {
  it("compiles a valid project into one data-only matcher operation", () => {
    const project = makeProject(
      {},
      {
        resourceTypes: ["image", "main_frame"],
        method: "GET",
        priority: 250,
      },
    );

    const result = compileProject(project);

    expect(result).toEqual({
      ok: true,
      operations: [
        {
          kind: "matcher",
          groupId: "group-main",
          ruleId: "rule-1",
          name: "Rule 1",
          redactSensitiveInLogs: false,
          matcher: {
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/",
            },

            resourceTypes: ["main_frame", "image"],
            priority: 250,
            method: "GET",
          },
        },
      ],
      diagnostics: [],
    });
  });

  it("compiles a source-only rule without an origin set", () => {
    const project = makeProject();
    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations[0]?.matcher.source.key).toBe("url");
      expect(result.operations[0]?.matcher).not.toHaveProperty("origins");
      expect(result.operations[0]?.matcher).not.toHaveProperty("urlRegex");
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("preserves regex source, method, priority, and canonical resource order", () => {
    const project = makeProject(
      {},
      {
        source: {
          key: "url",
          operator: "regex",
          value: "Example/[A-Z]+$",
        },
        resourceTypes: ["websocket", "script", "main_frame"],
        method: "POST",
        priority: 999,
      },
    );

    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations[0]?.matcher).toEqual({
        source: { key: "url", operator: "regex", value: "Example/[A-Z]+$" },

        resourceTypes: ["main_frame", "script", "websocket"],
        priority: 999,
        method: "POST",
      });
    }
  });

  it("omits an absent method and emits one operation without Cartesian expansion", () => {
    expect(Object.isFrozen(RESOURCE_TYPES)).toBe(true);
    const project = makeProject(
      {},
      {
        resourceTypes: [...RESOURCE_TYPES],
      },
    );

    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]?.matcher).not.toHaveProperty("method");
      expect(result.operations[0]?.matcher.resourceTypes).toEqual([
        ...RESOURCE_TYPES,
      ]);
    }
  });

  it("preserves group and rule source order, including distinct duplicate matchers", () => {
    const first = makeRule(1);
    const second = makeRule(2, { priority: 101 });
    second.id = "rule-second";
    const project = {
      version: 2,
      name: "Ordered project",
      groups: [
        {
          id: "group-first",
          name: "First",
          rules: [first],
        },
        {
          id: "group-second",
          name: "Second",
          rules: [second],
        },
      ],
    };

    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.operations.map(({ groupId, ruleId }) => [groupId, ruleId]),
      ).toEqual([
        ["group-first", "rule-1"],
        ["group-second", "rule-second"],
      ]);
      expect(result.operations[0]?.matcher).toEqual(
        result.operations[1]?.matcher,
      );
    }
  });

  it("preserves source order instead of sorting by priority", () => {
    const first = makeRule(1, { priority: 1000 });
    const second = makeRule(2, { priority: 1 });
    const project = {
      version: 2,
      name: "Priority order project",
      groups: [
        {
          id: "group-order",
          name: "Order",
          rules: [first, second],
        },
      ],
    };

    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.operations.map(({ ruleId, matcher }) => [
          ruleId,
          matcher.priority,
        ]),
      ).toEqual([
        ["rule-1", 1000],
        ["rule-2", 1],
      ]);
    }
  });

  it("maps schema failures to stable diagnostics and never returns partial output", () => {
    const result = compileProject({
      ...makeProject(),
      version: 1,
      unexpected: "not echoed",
    });
    const issues = diagnostics(result);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema.unknown-property",
          severity: "error",
          path: "",
        }),
        expect.objectContaining({
          code: "schema.invalid-value",
          severity: "error",
          path: "/version",
        }),
      ]),
    );
    expect(issues.map(({ path, code }) => `${path}:${code}`)).toEqual([
      ":schema.unknown-property",
      "/version:schema.invalid-value",
    ]);
    expect(JSON.stringify(issues)).not.toContain("not echoed");
    expect(JSON.stringify(issues)).not.toContain("must be");
  });

  it("sorts equivalent diagnostics independently of unknown-property insertion order", () => {
    const first = compileProject({
      ...makeProject(),
      zebra: true,
      alpha: true,
    });
    const second = compileProject({
      ...makeProject(),
      alpha: true,
      zebra: true,
    });

    expect(first).toEqual(second);
  });

  it("uses the fallback diagnostic for unknown validation keywords", () => {
    for (const keyword of ["constructor", "toString", "__proto__"]) {
      const [diagnostic] = mapValidationIssues([
        { instancePath: "", keyword, message: "unstable", params: {} },
      ]);
      expect(diagnostic).toMatchObject({
        code: "schema.invalid-value",
        message: "The project contains an invalid value.",
      });
    }
  });

  it("reports required, invalid-type, and invalid-format failures", () => {
    const cases: unknown[] = [
      { version: 2, name: "Missing groups" },
      null,
      makeProject(
        {},
        {
          source: { key: "url", operator: "regex", value: "[" },
        },
      ),
    ];

    expect(diagnostics(compileProject(cases[0]))[0]).toMatchObject({
      code: "schema.required",
      path: "",
      severity: "error",
    });
    expect(diagnostics(compileProject(cases[1]))[0]).toMatchObject({
      code: "schema.invalid-type",
      path: "",
      severity: "error",
    });
    expect(
      diagnostics(compileProject(cases[2])).some(
        ({ code }) => code === "schema.invalid-format",
      ),
    ).toBe(true);
  });

  it("fails closed for duplicate IDs, invalid actions, and limits", () => {
    const duplicate = makeProject();
    duplicate.groups[0].rules.push(makeRule(1));
    expect(diagnostics(compileProject(duplicate))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema.duplicate-id",
          path: "/groups/0/rules/1/id",
        }),
      ]),
    );

    const sourceOnly = compileProject(makeProject());
    expect(sourceOnly.ok).toBe(true);
    expect(sourceOnly.diagnostics).toEqual([]);

    const action = makeProject({}, { action: { type: "redirect" } });
    expect(diagnostics(compileProject(action)).length).toBeGreaterThan(0);

    const overLimit = makeProject();
    overLimit.groups = Array.from({ length: 17 }, (_, groupIndex) => ({
      id: `group-${groupIndex}`,
      name: `Group ${groupIndex}`,
      rules: Array.from({ length: LIMITS.maxRulesPerGroup }, (_, ruleIndex) =>
        makeRule(groupIndex * LIMITS.maxRulesPerGroup + ruleIndex, {
          priority: 1,
        }),
      ),
    }));
    expect(diagnostics(compileProject(overLimit))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema.rule-limit",
          path: "/groups",
        }),
      ]),
    );
  });

  it("fails without throwing for sparse, inherited, cyclic, and arbitrary inputs", () => {
    const sparseGroups = [] as RogatioProject["groups"];
    Object.setPrototypeOf(sparseGroups, { 0: makeProject().groups[0] });
    sparseGroups.length = 1;
    const sparse = { ...makeProject(), groups: sparseGroups };

    const cyclic = makeProject() as unknown as Record<string, unknown>;
    cyclic.groups = cyclic;

    const customArrayCycle = makeProject() as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(customArrayCycle.groups, "extra", {
      value: customArrayCycle,
    });

    for (const value of [
      sparse,
      cyclic,
      customArrayCycle,
      null,
      1,
      "project",
      [],
      {},
    ]) {
      expect(() => compileProject(value)).not.toThrow();
      expectFailure(compileProject(value));
    }
  });

  it("uses stable data descriptors instead of getters or proxy traps", () => {
    const accessor = makeProject();
    let getterRead = false;
    Object.defineProperty(accessor.groups[0].rules[0], "priority", {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 1n;
      },
    });
    const accessorResult = compileProject(accessor);
    expectFailure(accessorResult);
    expect(getterRead).toBe(false);

    const source = makeProject();
    const proxied = new Proxy(source, {
      get(target, property, receiver) {
        if (property === "groups") return [];
        return Reflect.get(target, property, receiver);
      },
    });
    const result = compileProject(proxied);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.operations).toHaveLength(1);
  });

  it("rejects non-JSON collection extensions", () => {
    const project = makeProject();
    Object.defineProperty(project.groups, "entries", {
      value: () => [][Symbol.iterator](),
    });
    Object.defineProperty(project.groups[0].rules, Symbol.iterator, {
      value: function* () {
        yield makeRule(99);
      },
    });

    const result = compileProject(project);

    expect(diagnostics(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "schema.invalid-structure" }),
      ]),
    );
  });

  it("is deterministic, does not mutate input, and returns detached serializable data", () => {
    const project = makeProject({}, { resourceTypes: ["script"] });
    const before = structuredClone(project);
    const frozen = deepFreeze(project);

    const first = compileProject(frozen);
    const second = compileProject(structuredClone(frozen));

    expect(first).toEqual(second);
    expect(frozen).toEqual(before);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    if (first.ok) {
      expect(first.operations[0]).not.toBe(frozen.groups[0]);
      expect(first.operations[0]?.matcher).not.toHaveProperty("origins");
      expect(first.operations[0]?.matcher.resourceTypes).not.toBe(
        frozen.groups[0].rules[0].resourceTypes,
      );
    }
  });

  it("exposes no action, browser, permission, runtime, or execution fields", () => {
    const result = compileProject(makeProject());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.operations[0] ?? {})).toEqual([
        "kind",
        "groupId",
        "ruleId",
        "name",
        "redactSensitiveInLogs",
        "matcher",
      ]);
      expect(Object.keys(result.operations[0]?.matcher ?? {})).toEqual([
        "source",
        "resourceTypes",
        "priority",
      ]);
    }
  });

  it("compiles a valid query action into an operation carrying the action", () => {
    const project = makeProject(
      {},
      {
        type: "query",
        action: {
          type: "query",
          params: [{ name: "utm_source", value: "rogatio" }],
        },
      },
    );

    const result = compileProject(project);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      console.log("Diagnostics:", result.diagnostics);
    }
    if (result.ok) {
      expect(result.operations[0]?.kind).toBe("query");
      if (result.operations[0]?.kind === "query") {
        expect(result.operations[0].action).toEqual({
          type: "query",
          params: [{ name: "utm_source", value: "rogatio" }],
        });
      }
    }
  });

  describe("header rules", () => {
    it("compiles a valid header rule into a HeaderOperation", () => {
      const project = makeProject({}, { ...makeHeaderRule(1) });
      const result = compileProject(project);
      if (!result.ok) {
        console.log(
          "Validation failed:",
          JSON.stringify(result.diagnostics, null, 2),
        );
      }
      expect(result.ok).toBe(true);
      if (result.ok) {
        const op = result.operations[0] as HeaderOperation;
        expect(op.kind).toBe("header");
        expect(op.groupId).toBe("group-main");
        expect(op.ruleId).toBe("header-1");
        expect(op.matcher).toBeDefined();
        expect(op.header.direction).toBe("request");
        expect(op.header.operation).toBe("set");
        expect(op.header.name).toBe("X-Custom-Header");
        expect(op.header.value).toBe("test-value");
      }
    });

    it("compiles a response header rule", () => {
      const project = makeProject(
        {},
        {
          ...makeHeaderRule(1),
          headerDirection: "response" as HeaderDirection,
        },
      );
      const result = compileProject(project);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const op = result.operations[0] as HeaderOperation;
        expect(op.header.direction).toBe("response");
      }
    });

    it("compiles append and remove operations", () => {
      for (const opKind of ["append", "remove"] as HeaderOperationKind[]) {
        const project = makeProject(
          {},
          {
            ...makeHeaderRule(1),
            headerOperation: opKind,
            headerValue: opKind === "remove" ? undefined : "value",
          },
        );
        const result = compileProject(project);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const op = result.operations[0] as HeaderOperation;
          expect(op.header.operation).toBe(opKind);
          if (opKind === "remove") {
            expect(op.header).not.toHaveProperty("value");
          } else {
            expect(op.header.value).toBe("value");
          }
        }
      }
    });

    it("preserves matcher fields for header rules", () => {
      const project = makeProject(
        {},
        {
          ...makeHeaderRule(1),
          method: "POST",
          priority: 500,
        },
      );
      const result = compileProject(project);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const op = result.operations[0] as HeaderOperation;
        expect(op.matcher).not.toHaveProperty("origins");
        expect(op.matcher).not.toHaveProperty("urlRegex");
        expect(op.matcher.method).toBe("POST");
        expect(op.matcher.priority).toBe(500);
      }
    });
  });
});
