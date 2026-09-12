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
  it("toDnrRule produces a condition without requestDomains or excludedRequestDomains", () => {
    const projection = makeProjection();
    const rule = toDnrRule(projection);

    expect(rule.condition).not.toHaveProperty("requestDomains");
    expect(rule.condition).not.toHaveProperty("excludedRequestDomains");
    expect(rule.condition).toHaveProperty("initiatorDomains");
    expect(rule.condition).toHaveProperty("excludedInitiatorDomains");
    expect(rule.condition.initiatorDomains).toEqual(["example.com"]);
  });

  it("toDnrRule preserves initiatorDomains and excludedInitiatorDomains from origins", () => {
    const projection = makeProjection({
      matcher: {
        urlRegex: { source: "^https://example\\.com/", flags: "" },
        origins: ["https://example.com", "!https://blocked.com"],
        resourceTypes: ["main_frame"],
        priority: 100,
      },
    });
    const rule = toDnrRule(projection);

    expect(rule.condition.initiatorDomains).toEqual(["example.com"]);
    // excluded origins keep the full URL (toDnrDomains only strips '!' prefix)
    expect(rule.condition.excludedInitiatorDomains).toEqual([
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
