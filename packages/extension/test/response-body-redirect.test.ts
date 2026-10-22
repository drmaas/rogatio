import type { ResponseBodyOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  installResponseBodyRedirects,
  RESPONSE_BODY_REDIRECT_ID_MIN,
} from "../src/response-body-redirect.js";

const operation: ResponseBodyOperation = {
  kind: "response-body",
  groupId: "g1",
  ruleId: "rule-1",
  name: "Rewrite",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/page$",
    },
    resourceTypes: ["main_frame"],
    priority: 10,
    method: "GET",
  },
  responseBody: {
    replacements: [{ pattern: "old", replacement: "new" }],
  },
};

describe("response-body redirect path", () => {
  it("includes the per-runtime token before the rule id and digest", async () => {
    const token = "cd".repeat(32);
    let added: Array<{
      id: number;
      action?: { redirect?: { regexSubstitution?: string } };
    }> = [];
    const api = {
      declarativeNetRequest: {
        getSessionRules: async () => [],
        updateSessionRules: vi.fn(
          async (payload: {
            addRules: Array<{
              id: number;
              action?: { redirect?: { regexSubstitution?: string } };
            }>;
          }) => {
            added = payload.addRules;
          },
        ),
      },
    } as unknown as ChromeApi;
    const result = await installResponseBodyRedirects({
      api,
      operations: [operation],
      port: 9,
      digest: "sha256:abc",
      token,
    });
    expect(result).toEqual({ ok: true });
    expect(added[0]?.id).toBe(RESPONSE_BODY_REDIRECT_ID_MIN);
    expect(added[0]?.action?.redirect?.regexSubstitution).toBe(
      `http://127.0.0.1:9/.rogatio/body/${token}/rule-1/sha256%3Aabc/\\0`,
    );
  });
});
