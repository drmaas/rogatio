import type {
  RequestBodyOperation,
  ResponseBodyOperation,
} from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  BODY_MARKER_HEADER_NAME,
  BODY_MARKER_ID_MIN,
  bodyMarkerIdForIndex,
  buildBodyMarkerRule,
  createBodyMarkerSessionHelper,
  isBodyMarkerBandId,
} from "../src/session-body-markers.js";
import {
  BODY_MARKER_BAND_ID,
  chromeHeldInstaller,
  FOREIGN_ID,
  HEADER_BAND_ID,
} from "./dnr-harness.js";

const requestBodyOp: RequestBodyOperation = {
  kind: "request-body",
  groupId: "g1",
  ruleId: "body-req-1",
  name: "body-req-1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/api$", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["xmlhttprequest"],
    priority: 50,
    method: "POST",
  },
  requestBody: { mode: "replace", body: '{"ok":true}' },
};

const responseBodyOp: ResponseBodyOperation = {
  kind: "response-body",
  groupId: "g1",
  ruleId: "body-res-1",
  name: "body-res-1",
  redactSensitiveInLogs: false,
  matcher: {
    urlRegex: { source: "^https://example\\.com/page$", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["xmlhttprequest"],
    priority: 40,
    method: "GET",
  },
  responseBody: { mode: "replace", body: "<html/>" },
};

describe("body-marker id band (session store)", () => {
  it("owns 3_000_001+ and rejects dynamic redirect/query/header bands", () => {
    expect(BODY_MARKER_ID_MIN).toBe(3_000_001);
    expect(bodyMarkerIdForIndex(0)).toBe(3_000_001);
    expect(bodyMarkerIdForIndex(1)).toBe(3_000_002);
    expect(isBodyMarkerBandId(3_000_001)).toBe(true);
    expect(isBodyMarkerBandId(3_000_099)).toBe(true);
    expect(isBodyMarkerBandId(1)).toBe(false);
    expect(isBodyMarkerBandId(1_000_000)).toBe(false);
    expect(isBodyMarkerBandId(HEADER_BAND_ID)).toBe(false);
    expect(isBodyMarkerBandId(FOREIGN_ID)).toBe(false);
    expect(isBodyMarkerBandId(2_000_000)).toBe(false);
    expect(isBodyMarkerBandId(3_000_000)).toBe(false);
    expect(isBodyMarkerBandId(3.5)).toBe(false);
  });
});

describe("buildBodyMarkerRule (set-only inert)", () => {
  it("builds set-only modifyHeaders with reserved name and opaque id value", () => {
    const id = BODY_MARKER_ID_MIN;
    const rule = buildBodyMarkerRule(requestBodyOp, id);

    expect(rule.id).toBe(id);
    expect(rule.priority).toBe(requestBodyOp.matcher.priority);
    expect(rule.action.type).toBe("modifyHeaders");
    expect(rule.action.requestHeaders).toEqual([
      {
        header: BODY_MARKER_HEADER_NAME,
        operation: "set",
        value: String(id),
      },
    ]);
    expect(Object.hasOwn(rule.action, "responseHeaders")).toBe(false);
    expect(rule.condition.regexFilter).toBe(
      requestBodyOp.matcher.urlRegex.source,
    );
    expect(rule.condition.resourceTypes).toEqual(["xmlhttprequest"]);
    expect(rule.condition.requestMethods).toEqual(["post"]);
    expect(rule.condition.requestDomains).toEqual(["example.com"]);
    expect(rule.condition).not.toHaveProperty("initiatorDomains");
    expect(rule.condition).not.toHaveProperty("excludedRequestDomains");
  });

  it("maps !origins to excludedRequestDomains", () => {
    const op: RequestBodyOperation = {
      ...requestBodyOp,
      matcher: {
        ...requestBodyOp.matcher,
        origins: ["https://example.com", "!https://evil.example"],
      },
    };
    const rule = buildBodyMarkerRule(op, BODY_MARKER_ID_MIN);
    expect(rule.condition.requestDomains).toEqual(["example.com"]);
    expect(rule.condition.excludedRequestDomains).toEqual([
      "https://evil.example",
    ]);
    expect(rule.condition).not.toHaveProperty("initiatorDomains");
  });

  it("never pairs set with remove of the same header", () => {
    const rule = buildBodyMarkerRule(responseBodyOp, BODY_MARKER_ID_MIN + 1);
    const headers = [...rule.action.requestHeaders] as Array<{
      header: string;
      operation: string;
      value?: string;
    }>;
    expect(headers.every((h) => h.operation === "set")).toBe(true);
    expect(headers.some((h) => h.operation === "remove")).toBe(false);
    expect(
      headers.filter((h) => h.header === BODY_MARKER_HEADER_NAME),
    ).toHaveLength(1);
  });

  it("uses inert sentinel values (no capability / digest / rewrite-auth)", () => {
    const id = BODY_MARKER_ID_MIN + 2;
    const rule = buildBodyMarkerRule(requestBodyOp, id);
    const value = rule.action.requestHeaders?.[0]?.value ?? "";
    expect(value).toBe(String(id));
    expect(value.toLowerCase()).not.toContain("capability");
    expect(value.toLowerCase()).not.toContain("digest");
    expect(value.toLowerCase()).not.toContain("rewrite-auth");
    expect(value).not.toMatch(/~/);
    expect(BODY_MARKER_HEADER_NAME.startsWith("X-Rogatio-Dispatch-")).toBe(
      true,
    );
  });
});

describe("createBodyMarkerSessionHelper", () => {
  it("installs only into the session store body band", async () => {
    const harness = chromeHeldInstaller([1, HEADER_BAND_ID, FOREIGN_ID]);
    const helper = createBodyMarkerSessionHelper(harness.api);

    const result = await helper.install([requestBodyOp, responseBodyOp]);
    expect(result).toEqual({ ok: true });

    expect(harness.sessionIds()).toEqual([
      BODY_MARKER_BAND_ID,
      BODY_MARKER_BAND_ID + 1,
    ]);
    expect(harness.chromeIds()).toEqual([1, HEADER_BAND_ID, FOREIGN_ID]);
    expect(harness.updateDynamicRules).not.toHaveBeenCalled();
    expect(harness.updateSessionRules).toHaveBeenCalled();
  });

  it("removeOwned clears only getSessionRules ∩ body band", async () => {
    const foreignSessionId = 100;
    const harness = chromeHeldInstaller([]);
    harness.setSessionIds([
      BODY_MARKER_BAND_ID,
      BODY_MARKER_BAND_ID + 1,
      foreignSessionId,
    ]);
    const helper = createBodyMarkerSessionHelper(harness.api);

    await helper.removeOwned();

    expect(harness.sessionIds()).toEqual([foreignSessionId]);
    expect(harness.updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [BODY_MARKER_BAND_ID, BODY_MARKER_BAND_ID + 1],
      addRules: [],
    });
    expect(harness.updateDynamicRules).not.toHaveBeenCalled();
  });

  it("install replace removes prior body-band session ids then adds", async () => {
    const harness = chromeHeldInstaller([]);
    harness.setSessionIds([BODY_MARKER_BAND_ID, BODY_MARKER_BAND_ID + 5]);
    const helper = createBodyMarkerSessionHelper(harness.api);

    await helper.install([requestBodyOp]);

    expect(harness.sessionIds()).toEqual([BODY_MARKER_BAND_ID]);
    const call = harness.updateSessionRules.mock.calls.at(-1)?.[0] as {
      removeRuleIds: number[];
      addRules: Array<{ id: number }>;
    };
    expect(call.removeRuleIds).toEqual(
      expect.arrayContaining([BODY_MARKER_BAND_ID, BODY_MARKER_BAND_ID + 5]),
    );
    expect(call.addRules).toHaveLength(1);
    expect(call.addRules[0]?.id).toBe(BODY_MARKER_BAND_ID);
  });

  it("never calls updateDynamicRules even when dynamic ids exist", async () => {
    const harness = chromeHeldInstaller([
      42,
      HEADER_BAND_ID,
      FOREIGN_ID,
      1_000_000,
    ]);
    const helper = createBodyMarkerSessionHelper(harness.api);

    await helper.install([requestBodyOp]);
    await helper.removeOwned();

    expect(harness.updateDynamicRules).not.toHaveBeenCalled();
    expect(harness.chromeIds()).toEqual([
      42,
      HEADER_BAND_ID,
      FOREIGN_ID,
      1_000_000,
    ]);
  });

  it("fails closed when session APIs are missing", async () => {
    const api = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules: vi.fn(async () => {}),
      },
    } as unknown as ChromeApi;
    const helper = createBodyMarkerSessionHelper(api);
    const result = await helper.install([requestBodyOp]);
    expect(result.ok).toBe(false);
  });

  it("installed action remains set-only inert sentinel", async () => {
    const harness = chromeHeldInstaller([]);
    const helper = createBodyMarkerSessionHelper(harness.api);
    await helper.install([requestBodyOp]);

    const addCall = harness.updateSessionRules.mock.calls.find((call) => {
      const payload = call[0] as { addRules?: unknown[] };
      return (payload.addRules?.length ?? 0) > 0;
    })?.[0] as unknown as {
      addRules: Array<{
        action: {
          requestHeaders?: Array<{
            header: string;
            operation: string;
            value?: string;
          }>;
        };
      }>;
    };

    const headers = addCall.addRules[0]?.action.requestHeaders ?? [];
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({
      header: BODY_MARKER_HEADER_NAME,
      operation: "set",
      value: String(BODY_MARKER_BAND_ID),
    });
    expect(headers[0]?.value?.toLowerCase()).not.toContain("capability");
    expect(headers[0]?.value?.toLowerCase()).not.toContain("digest");
  });
});
