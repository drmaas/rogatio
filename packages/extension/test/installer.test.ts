import { describe, expect, it, vi } from "vitest";
import { installHeaderRules, toDnrRule } from "../src/installer.js";
import type { HeaderProjection } from "../src/projection.js";

function makeProjection(
  overrides: Partial<HeaderProjection> = {},
): HeaderProjection {
  return {
    id: 2_000_001,
    groupId: "g1",
    ruleId: "rule-header-set",
    matcher: {
      urlRegex: { source: "^https://example\\.com/", flags: "" },
      origins: ["https://example.com"],
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

describe("installer.ts — header DNR rules", () => {
  it("toDnrRule scopes with requestDomains from origins", () => {
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
        urlRegex: { source: "^https://example\\.com/", flags: "" },
        origins: [],
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

  it("toDnrRule preserves requestDomains and excludedRequestDomains from origins", () => {
    const projection = makeProjection({
      matcher: {
        urlRegex: { source: "^https://example\\.com/", flags: "" },
        origins: ["https://example.com", "!https://blocked.com"],
        resourceTypes: ["main_frame"],
        priority: 100,
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.condition.requestDomains).toEqual(["example.com"]);
    // excluded origins keep the full URL (toDnrDomains only strips '!' prefix)
    expect(rule.condition.excludedRequestDomains).toEqual([
      "https://blocked.com",
    ]);
  });

  it("installHeaderRules returns installed IDs when updateDynamicRules succeeds", async () => {
    const projection = makeProjection();
    const updateDynamicRules = vi.fn(async () => {});
    const getDynamicRules = vi.fn(async () => []);

    // @ts-expect-error - mock chrome.declarativeNetRequest
    globalThis.chrome = {
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    };

    const result = await installHeaderRules([projection]);

    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    expect(result.installed).toEqual([projection.id]);
    expect(result.errors).toHaveLength(0);

    // @ts-expect-error - cleanup mock
    globalThis.chrome = undefined;
  });

  it("installHeaderRules returns errors when updateDynamicRules throws", async () => {
    const projection = makeProjection();
    const updateDynamicRules = vi.fn(async () => {
      throw new Error("DNR installation failed");
    });
    const getDynamicRules = vi.fn(async () => []);

    // @ts-expect-error - mock chrome.declarativeNetRequest
    globalThis.chrome = {
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    };

    const result = await installHeaderRules([projection]);

    expect(result.installed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("extension.dnr-error");
    expect(result.errors[0].message).toBe("DNR installation failed");

    // @ts-expect-error - cleanup mock
    globalThis.chrome = undefined;
  });

  it("installHeaderRules returns errors when DNR API is unavailable", async () => {
    const projection = makeProjection();

    // @ts-expect-error - no chrome.declarativeNetRequest
    globalThis.chrome = {};

    const result = await installHeaderRules([projection]);

    expect(result.installed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("extension.dnr-error");
    expect(result.errors[0].message).toBe(
      "declarativeNetRequest API not available",
    );

    // @ts-expect-error - cleanup mock
    globalThis.chrome = undefined;
  });
});
