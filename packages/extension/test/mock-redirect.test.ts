import type { MockOperation } from "@rogatio/compiler";
import { LIMITS } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  buildMockGuardRule,
  buildMockRedirectRule,
  installMockRedirects,
  isMockRedirectId,
  MOCK_GUARD_ID,
  MOCK_REDIRECT_ID_MAX,
  MOCK_REDIRECT_ID_MIN,
  mockGuardRegex,
  removeMockRedirects,
} from "../src/mock-redirect.js";
import {
  isResponseBodyRedirectId,
  RESPONSE_BODY_REDIRECT_ID_MAX,
  RESPONSE_BODY_REDIRECT_ID_MIN,
} from "../src/response-body-redirect.js";
import { isBodyMarkerBandId } from "../src/session-body-markers.js";

const operation: MockOperation = {
  kind: "mock",
  groupId: "g1",
  ruleId: "r1",
  name: "Mock",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: ".*",
    },
    resourceTypes: ["xmlhttprequest"],
    priority: 10,
  },
  mock: { status: 200, body: "hello" },
};

function sessionApi(fail = false) {
  let rules: Array<{
    id: number;
    action?: { type: string };
    priority?: number;
  }> = [{ id: RESPONSE_BODY_REDIRECT_ID_MIN }, { id: 1_500_000 }];
  const updateSessionRules = vi.fn(
    async (payload: {
      removeRuleIds: number[];
      addRules: Array<{
        id: number;
        action?: { type: string };
        priority?: number;
      }>;
    }) => {
      if (fail) throw new Error("update failed");
      const remove = new Set(payload.removeRuleIds);
      rules = rules.filter((rule) => !remove.has(rule.id));
      rules.push(...payload.addRules);
    },
  );
  const api = {
    declarativeNetRequest: {
      getSessionRules: async () => rules.map((rule) => ({ ...rule })),
      updateSessionRules,
    },
  } as unknown as ChromeApi;
  return { api, rules: () => rules };
}

describe("mock redirect band", () => {
  it("does not overlap the response-body or body-marker bands", () => {
    expect(MOCK_REDIRECT_ID_MIN).toBe(5_000_001);
    expect(MOCK_REDIRECT_ID_MAX).toBe(6_000_000);
    expect(isMockRedirectId(MOCK_REDIRECT_ID_MIN)).toBe(true);
    expect(isMockRedirectId(MOCK_GUARD_ID)).toBe(true);
    expect(isMockRedirectId(RESPONSE_BODY_REDIRECT_ID_MAX)).toBe(false);
    expect(isResponseBodyRedirectId(RESPONSE_BODY_REDIRECT_ID_MIN)).toBe(true);
    expect(isResponseBodyRedirectId(RESPONSE_BODY_REDIRECT_ID_MAX)).toBe(true);
    expect(isResponseBodyRedirectId(MOCK_REDIRECT_ID_MIN)).toBe(false);
    expect(isBodyMarkerBandId(4_000_001)).toBe(false);
    expect(isBodyMarkerBandId(4_000_000)).toBe(true);
  });

  it("omits requestMethods when the rule has no filter and sets one method when it does", () => {
    const open = buildMockRedirectRule(
      operation,
      MOCK_REDIRECT_ID_MIN,
      9,
      "sha256:abc",
      "token",
    );
    expect(open.condition.requestMethods).toBeUndefined();
    expect(open.action.redirect.url).toBe(
      "http://127.0.0.1:9/.rogatio/mock/token/sha256%3Aabc",
    );
    const filtered = buildMockRedirectRule(
      {
        ...operation,
        matcher: { ...operation.matcher, method: "POST" },
      },
      MOCK_REDIRECT_ID_MIN,
      9,
      "sha256:abc",
      "token",
    );
    expect(filtered.condition.requestMethods).toEqual(["post"]);
  });

  it("guards a broad regex with a higher-priority allow on the listener only", () => {
    const guard = buildMockGuardRule(4545);
    const listener = "http://127.0.0.1:4545/.rogatio/mock/token/sha256:abc";
    expect(guard.priority).toBeGreaterThan(LIMITS.maxPriority);
    expect(guard.action.type).toBe("allow");
    expect(new RegExp(guard.condition.regexFilter).test(listener)).toBe(true);
    expect(new RegExp(mockGuardRegex(4545)).test("https://example.com/")).toBe(
      false,
    );
    expect(new RegExp(operation.matcher.source.value).test(listener)).toBe(
      true,
    );
    expect(guard.priority).toBeGreaterThan(operation.matcher.priority);
  });

  it("rolls back when the session update fails and leaves foreign ids", async () => {
    const failed = sessionApi(true);
    const result = await installMockRedirects({
      api: failed.api,
      rules: [{ operation, token: "token" }],
      port: 9,
      digest: "sha256:abc",
    });
    expect(result).toEqual({
      ok: false,
      reason: "extension.session-rules-update-failed",
    });
    expect(failed.rules().map((rule) => rule.id)).toEqual([
      RESPONSE_BODY_REDIRECT_ID_MIN,
      1_500_000,
    ]);

    const held = sessionApi(false);
    const installed = await installMockRedirects({
      api: held.api,
      rules: [{ operation, token: "token" }],
      port: 9,
      digest: "sha256:abc",
    });
    expect(installed.ok).toBe(true);
    expect(held.rules().some((rule) => rule.id === 1_500_000)).toBe(true);
    expect(
      held.rules().some((rule) => rule.id === RESPONSE_BODY_REDIRECT_ID_MIN),
    ).toBe(true);
    await removeMockRedirects(held.api);
    expect(
      held
        .rules()
        .map((rule) => rule.id)
        .sort(),
    ).toEqual([1_500_000, RESPONSE_BODY_REDIRECT_ID_MIN]);
  });
});
