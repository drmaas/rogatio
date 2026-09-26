import { describe, expect, it } from "vitest";
import { toDnrRule } from "../src/installer.js";
import type { HeaderProjection } from "../src/projection.js";

function makeProjection(
  overrides: Partial<HeaderProjection> = {},
): HeaderProjection {
  return {
    id: 2_000_001,
    groupId: "g1",
    ruleId: "rule-header-set",
    matcher: {
      source: {
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      },
      resourceTypes: ["main_frame"],
      priority: 100,
    },
    action: {
      direction: "request",
      operation: "set",
      headerName: "X-Custom-Header",
      headerValue: "test-value",
    },
    installable: true,
    ...overrides,
  };
}

describe("installer.ts — header DNR rule shape", () => {
  it("toDnrRule scopes with requestDomains from host source", () => {
    const projection = makeProjection();
    const rule = toDnrRule(projection);

    expect(rule.condition).toHaveProperty("requestDomains");
    expect(rule.condition).not.toHaveProperty("excludedRequestDomains");
    expect(rule.condition).not.toHaveProperty("initiatorDomains");
    expect(rule.condition.requestDomains).toEqual(["example.com"]);
  });

  it("toDnrRule omits responseHeaders for request-direction projections", () => {
    const projection = makeProjection({
      action: {
        direction: "request",
        operation: "set",
        headerName: "X-Custom-Header",
        headerValue: "test-value",
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.action).not.toHaveProperty("responseHeaders");
    expect(rule.action.requestHeaders).toEqual([
      {
        header: "X-Custom-Header",
        operation: "set",
        value: "test-value",
      },
    ]);
  });

  it("toDnrRule omits requestHeaders and value for response-direction remove projections", () => {
    const projection = makeProjection({
      action: {
        direction: "response",
        operation: "remove",
        headerName: "X-Test-Header",
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.action).not.toHaveProperty("requestHeaders");
    expect(rule.action.responseHeaders).toEqual([
      { header: "X-Test-Header", operation: "remove" },
    ]);
    expect(rule.action.responseHeaders?.[0]).not.toHaveProperty("value");
  });

  it("toDnrRule omits optional condition keys when unset", () => {
    const projection = makeProjection({
      matcher: {
        source: {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/",
        },
        resourceTypes: [],
        priority: 100,
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.condition).toEqual({
      regexFilter: "^https://example\\.com/",
    });
    for (const value of Object.values(rule.condition)) {
      expect(value).not.toBeUndefined();
    }
  });

  it("toDnrRule preserves requestDomains for host source projections", () => {
    const projection = makeProjection({
      matcher: {
        source: {
          key: "host",
          operator: "regex",
          value: "^example\\.com$",
        },
        resourceTypes: ["main_frame"],
        priority: 100,
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.condition.requestDomains).toEqual(["example.com"]);
    expect(rule.condition).not.toHaveProperty("excludedRequestDomains");
  });
});
