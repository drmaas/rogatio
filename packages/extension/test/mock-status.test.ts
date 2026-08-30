import type { MockOperation, RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  createDnrInstaller,
  mockLoopProtectionRule,
  translateMockToDnr,
} from "../src/dnr.js";
import { projectMatchers } from "../src/projection.js";

const mockOp: MockOperation = {
  kind: "mock",
  groupId: "group-a",
  ruleId: "rule-mock",
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 100,
  },
  mock: { status: 200, body: "hello" },
};

describe(" mock projection", () => {
  it("projects a mock operation as installable with the matcher preserved", () => {
    const result = projectMatchers([mockOp]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1000001,
      groupId: "group-a",
      ruleId: "rule-mock",
      installable: true,
      matcher: mockOp.matcher,
    });
    expect(result[0]).not.toHaveProperty("dnrRule");
  });
});

describe(" mock DNR translation", () => {
  it("translates a mock operation to a DNR redirect rule at the mock URL", () => {
    const rule = translateMockToDnr(
      mockOp,
      42,
      "http://127.0.0.1:8890/mock/tok1",
    );
    expect(rule).toEqual({
      id: 42,
      priority: 100,
      action: {
        type: "redirect",
        redirect: { url: "http://127.0.0.1:8890/mock/tok1" },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
        initiatorDomains: ["example.com"],
      },
    });
  });

  it("builds a high-priority loop-protection allow rule for the mock URL substring", () => {
    const rule = mockLoopProtectionRule(8890);
    expect(rule).toMatchObject({
      action: { type: "allow" },
      condition: { urlFilter: "127.0.0.1:8890/mock/" },
    });
    expect(rule.priority).toBeGreaterThan(1_000_000);
  });

  it("installs mock DNR rules plus the allow rule through the installer", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    let storedIds: number[] = [];
    const getDynamicRules = vi.fn(async () => storedIds.map((id) => ({ id })));
    const api = {
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;
    const resolver = vi.fn(
      (operation: RogatioOperation) =>
        `http://127.0.0.1:8890/mock/${operation.ruleId === "rule-mock" ? "tok1" : "tok2"}`,
    );
    const installer = createDnrInstaller(api, { mockUrlResolver: resolver });

    const result = await installer.install([mockOp]);
    expect(result).toEqual({ ok: true });
    const payload = updateDynamicRules.mock.calls[0][0] as {
      removeRuleIds: number[];
      addRules: unknown[];
    };
    expect(payload.addRules).toHaveLength(2);
    const redirectRule = payload.addRules.find(
      (rule) =>
        (rule as { action: { type: string } }).action.type === "redirect",
    ) as { id: number; action: { redirect: { url: string } } };
    const allowRule = payload.addRules.find(
      (rule) => (rule as { action: { type: string } }).action.type === "allow",
    ) as { id: number; action: { type: string } };
    expect(redirectRule.action.redirect.url).toBe(
      "http://127.0.0.1:8890/mock/tok1",
    );
    expect(allowRule.action.type).toBe("allow");

    storedIds = payload.addRules.map((rule) => (rule as { id: number }).id);
    const current = await installer.current();
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(mockOp);
  });
});
