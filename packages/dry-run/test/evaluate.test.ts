import type { MatcherOperation, NormalizedMatcher } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import {
  evaluateRule,
  methodDimension,
  resourceTypeDimension,
  sourceDimension,
} from "../src/evaluate.js";
import type { DryRunTestCase } from "../src/types.js";

function matcher(
  overrides: Partial<NormalizedMatcher> = {},
): NormalizedMatcher {
  return {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
    resourceTypes: ["main_frame"],
    priority: 1,
    method: "GET",
    ...overrides,
  };
}

function operation(
  overrides: Partial<MatcherOperation> & {
    matcher?: NormalizedMatcher;
  } = {},
): MatcherOperation {
  return {
    kind: "matcher",
    groupId: "g1",
    ruleId: "r1",
    name: "rule1",
    redactSensitiveInLogs: false,
    matcher: overrides.matcher ?? matcher(),
    ...overrides,
  };
}

describe("sourceDimension", () => {
  it("reports matched and unmatched url subjects with exact detail strings", () => {
    const m = matcher();
    expect(sourceDimension(m, "https://example.com/page")).toEqual({
      state: "matched",
      matched: true,
      detail: "url matched /^https://example\\.com// (url)",
    });
    expect(sourceDimension(m, "https://other.com/page")).toEqual({
      state: "unmatched",
      matched: false,
      detail: "url did not match /^https://example\\.com// (url)",
    });
  });

  it("reports hostname wording for host-key sources", () => {
    const m = matcher({
      source: {
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      },
    });
    expect(sourceDimension(m, "https://example.com/page")).toEqual({
      state: "matched",
      matched: true,
      detail: "hostname matched /^example\\.com$/ (host)",
    });
    expect(sourceDimension(m, "https://other.com/page")).toEqual({
      state: "unmatched",
      matched: false,
      detail: "hostname did not match /^example\\.com$/ (host)",
    });
  });
});

describe("methodDimension", () => {
  it("covers matched, unmatched, and not-applicable with exact details", () => {
    const withMethod = matcher({ method: "GET" });
    const withoutMethod = matcher({ method: undefined });

    expect(
      methodDimension(withMethod, {
        url: "https://example.com/",
        method: "GET",
      }),
    ).toEqual({
      state: "matched",
      matched: true,
      detail: "method GET matches",
    });

    expect(
      methodDimension(withMethod, {
        url: "https://example.com/",
        method: "POST",
      }),
    ).toEqual({
      state: "unmatched",
      matched: false,
      detail: "rule method GET != POST",
    });

    expect(
      methodDimension(withMethod, { url: "https://example.com/" }),
    ).toEqual({
      state: "not-applicable",
      matched: null,
      detail: "method not specified",
    });

    expect(
      methodDimension(withoutMethod, {
        url: "https://example.com/",
        method: "PUT",
      }),
    ).toEqual({
      state: "matched",
      matched: true,
      detail: "rule has no method constraint",
    });
  });
});

describe("resourceTypeDimension", () => {
  it("covers matched, unmatched, and not-applicable with exact details", () => {
    const withTypes = matcher({ resourceTypes: ["main_frame"] });
    const open = matcher({ resourceTypes: [] });

    expect(
      resourceTypeDimension(withTypes, {
        url: "https://example.com/",
        resourceType: "main_frame",
      }),
    ).toEqual({
      state: "matched",
      matched: true,
      detail: "resource type main_frame matches",
    });

    expect(
      resourceTypeDimension(withTypes, {
        url: "https://example.com/",
        resourceType: "script",
      }),
    ).toEqual({
      state: "unmatched",
      matched: false,
      detail: "rule resource types [main_frame] exclude script",
    });

    expect(
      resourceTypeDimension(withTypes, { url: "https://example.com/" }),
    ).toEqual({
      state: "not-applicable",
      matched: null,
      detail: "resource type not specified",
    });

    expect(
      resourceTypeDimension(open, {
        url: "https://example.com/",
        resourceType: "xmlhttprequest",
      }),
    ).toEqual({
      state: "matched",
      matched: true,
      detail: "rule has no resource type constraint",
    });
  });
});

describe("evaluateRule", () => {
  it("composes dimensions and matched with the current rule", () => {
    const op = operation();
    const matchedCase: DryRunTestCase = {
      url: "https://example.com/page",
      method: "GET",
      resourceType: "main_frame",
    };
    const result = evaluateRule(op, matchedCase);
    expect(result.matched).toBe(true);
    expect(result.actionPreview).toBeNull();
    expect(result.source.state).toBe("matched");
    expect(result.method.state).toBe("matched");
    expect(result.resourceType.state).toBe("matched");
  });

  it("yields actionPreview null when previewAction throws", () => {
    const op = operation();
    const result = evaluateRule(
      op,
      {
        url: "https://example.com/page",
        method: "GET",
        resourceType: "main_frame",
      },
      () => {
        throw new Error("boom");
      },
    );
    expect(result.actionPreview).toBeNull();
    expect(result.matched).toBe(true);
  });

  it("honors a successful previewAction", () => {
    const op = operation();
    const result = evaluateRule(
      op,
      { url: "https://example.com/page" },
      (operation) => ({
        kind: "noop",
        summary: `${operation.groupId}:${operation.ruleId}`,
      }),
    );
    expect(result.actionPreview).toEqual({
      kind: "noop",
      summary: "g1:r1",
    });
  });
});
