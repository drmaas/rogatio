import type { MatcherOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import type { DryRunTestCase } from "../src/index.js";
import { dryRunProject, parseTestUrl } from "../src/index.js";

const PROJECT = {
  version: 1 as const,
  name: "test-project",
  groups: [
    {
      id: "g1",
      name: "group1",
      origins: ["https://example.com", "https://www.example.com"],
      rules: [
        {
          id: "r1",
          name: "rule1",
          urlRegex: "^https://example\\.com/",
          origins: ["https://example.com"],
          resourceTypes: ["main_frame"],
          priority: 1,
          method: "GET",
        },
        {
          id: "r2",
          name: "rule2",
          urlRegex: "^https://example\\.com/",
          origins: ["https://example.com"],
          resourceTypes: ["main_frame"],
          priority: 2,
        },
      ],
    },
  ],
};

function getOperations(): readonly MatcherOperation[] {
  const compiled = compileProject(PROJECT);
  if (!compiled.ok) {
    console.error("Compile error:", compiled);
    throw new Error("fixture project failed to compile");
  }
  return compiled.operations.map(({ groupId, ruleId, matcher }) => ({
    kind: "matcher",
    groupId,
    ruleId,
    matcher,
  }));
}

describe("parseTestUrl", () => {
  it("accepts an absolute https URL", () => {
    const result = parseTestUrl("https://example.com/path");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.origin).toBe("https://example.com");
    }
  });

  it("rejects a bare domain without scheme", () => {
    expect(parseTestUrl("example.com").ok).toBe(false);
  });

  it("rejects non-string and empty input", () => {
    expect(parseTestUrl("").ok).toBe(false);
    expect(parseTestUrl(5).ok).toBe(false);
    expect(parseTestUrl(null).ok).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseTestUrl("file:///etc/passwd").ok).toBe(false);
    expect(parseTestUrl("ftp://example.com").ok).toBe(false);
  });
});

describe("dryRunProject", () => {
  const operations = getOperations();
  const run = (cases: readonly unknown[], options?: unknown) =>
    dryRunProject(
      operations,
      cases as readonly DryRunTestCase[],
      options as Parameters<typeof dryRunProject>[2],
    );

  it("matches a fully-specified case (AC-001)", () => {
    const cases: DryRunTestCase[] = [
      {
        url: "https://example.com/page",
        method: "GET",
        resourceType: "main_frame",
      },
    ];
    const result = run(cases);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(1);
    const rule = result.results[0].rules.find((r) => r.ruleId === "r1");
    expect(rule?.matched).toBe(true);
  });

  it("reports all four dimensions with states (AC-002)", () => {
    const result = run([
      {
        url: "https://example.com/page",
        method: "GET",
        resourceType: "main_frame",
      },
    ]);
    const rule = result.results[0].rules.find((r) => r.ruleId === "r1");
    if (!rule) throw new Error("rule r1 not found");
    expect(rule.urlRegex.state).toBe("matched");
    expect(rule.effectiveOrigin.state).toBe("matched");
    expect(rule.method.state).toBe("matched");
    expect(rule.resourceType.state).toBe("matched");
    for (const dim of [
      rule.urlRegex,
      rule.effectiveOrigin,
      rule.method,
      rule.resourceType,
    ]) {
      expect(typeof dim.detail).toBe("string");
      expect(dim.detail.length).toBeGreaterThan(0);
    }
  });

  it("excludes and reports an invalid case as dryrun.invalid-case (AC-003)", () => {
    const result = run([
      { url: "https://example.com/" },
      { resourceType: "main_frame" },
    ]);
    expect(result.results).toHaveLength(1);
    const invalid = result.errors.find((e) => e.code === "dryrun.invalid-case");
    expect(invalid).toBeDefined();
    expect(invalid?.index).toBe(1);
  });

  it("excludes and reports an invalid URL as dryrun.invalid-url (AC-004)", () => {
    const result = run([
      { url: "example.com" },
      { url: "https://example.com/" },
    ]);
    expect(result.results).toHaveLength(1);
    const invalid = result.errors.find((e) => e.code === "dryrun.invalid-url");
    expect(invalid).toBeDefined();
  });

  it("rejects a batch exceeding the default maxCases of 256 (AC-005)", () => {
    const big: DryRunTestCase[] = Array.from({ length: 257 }, () => ({
      url: "https://example.com/",
    }));
    const result = run(big);
    expect(result.results).toHaveLength(0);
    expect(result.errors[0]?.code).toBe("dryrun.batch-limit");
  });

  it("rejects a batch exceeding a configured maxCases (AC-006)", () => {
    const cases: DryRunTestCase[] = [
      { url: "https://example.com/" },
      { url: "https://example.com/" },
      { url: "https://example.com/" },
    ];
    const result = run(cases, { maxCases: 2 });
    expect(result.results).toHaveLength(0);
    expect(result.errors[0]?.code).toBe("dryrun.batch-limit");
  });

  it("computes summary counts (AC-007)", () => {
    const cases: DryRunTestCase[] = [
      {
        url: "https://example.com/a",
        method: "GET",
        resourceType: "main_frame",
      },
      { url: "https://other.com/b" },
    ];
    const result = run(cases);
    expect(result.summary.caseCount).toBe(2);
    expect(result.summary.urlCount).toBe(2);
    expect(result.summary.matchedUrlCount).toBe(1);
    expect(result.summary.matchedRuleTotal).toBeGreaterThan(0);
  });

  it("returns null action preview when none provided and honors the previewAction seam (AC-008)", () => {
    const without = run([
      {
        url: "https://example.com/",
        method: "GET",
        resourceType: "main_frame",
      },
    ]);
    expect(without.results[0].rules[0].actionPreview).toBeNull();

    const withPreview = dryRunProject(
      operations,
      [
        {
          url: "https://example.com/",
          method: "GET",
          resourceType: "main_frame",
        },
      ],
      {
        previewAction: (operation) => ({
          kind: "noop",
          summary: `${operation.groupId}:${operation.ruleId}`,
        }),
      },
    );
    expect(withPreview.results[0].rules[0].actionPreview).toEqual({
      kind: "noop",
      summary: "g1:r1",
    });
  });

  it("does not invoke a throwing previewAction (AC-008 safety)", () => {
    const result = dryRunProject(
      operations,
      [
        {
          url: "https://example.com/",
          method: "GET",
          resourceType: "main_frame",
        },
      ],
      {
        previewAction: () => {
          throw new Error("boom");
        },
      },
    );
    expect(result.results[0].rules[0].actionPreview).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it("does not mutate input operations or cases (no side effects)", () => {
    const frozenOps = Object.freeze([
      ...operations,
    ]) as unknown as MatcherOperation[];
    const cases: DryRunTestCase[] = [
      {
        url: "https://example.com/",
        method: "GET",
        resourceType: "main_frame",
      },
    ];
    const frozenCases = Object.freeze(cases);
    expect(() => dryRunProject(frozenOps, frozenCases)).not.toThrow();
  });

  it("rejects a case with a cyclic reference without recursing (AC-008)", () => {
    const cyclic: Record<string, unknown> = { url: "https://example.com/" };
    cyclic.self = cyclic;
    const result = run([cyclic]);
    expect(result.results).toHaveLength(0);
    expect(result.errors[0]?.code).toBe("dryrun.invalid-case");
  });

  it("treats a case with symbol keys as invalid", () => {
    const sym = Symbol("x");
    const fake: Record<symbol, unknown> = { [sym]: "https://example.com/" };
    const result = run([fake]);
    expect(result.results).toHaveLength(0);
    expect(result.errors[0]?.code).toBe("dryrun.invalid-case");
  });

  it("does not invoke a hostile getter on the url property", () => {
    let invoked = false;
    const hostile = {
      get url() {
        invoked = true;
        return "https://example.com/";
      },
    };
    const result = run([hostile]);
    expect(invoked).toBe(false);
    expect(result.errors[0]?.code).toBe("dryrun.invalid-case");
  });

  it("reports URL failures with their original case indexes", () => {
    const result = run([
      { url: "https://example.com/" },
      { url: 42 },
      { url: "" },
      { url: "example.com" },
    ]);
    expect(
      result.errors.filter((error) => error.code === "dryrun.invalid-url"),
    ).toHaveLength(3);
    expect(result.errors.map((error) => error.index)).toEqual([1, 2, 3]);
  });

  it("rejects malformed options without throwing", () => {
    const nullOptions = run([{ url: "https://example.com/" }], null);
    expect(nullOptions.errors[0]?.code).toBe("dryrun.invalid-case");
    const nanOptions = run([{ url: "https://example.com/" }], {
      maxCases: Number.NaN,
    });
    expect(nanOptions.errors[0]?.code).toBe("dryrun.invalid-case");
  });
});
