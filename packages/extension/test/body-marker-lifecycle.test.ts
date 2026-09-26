import type {
  RequestBodyOperation,
  ResponseBodyOperation,
} from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MARKER_PROBE_GATES,
  installSessionBodyMarkers,
  removeSessionBodyMarkers,
} from "../src/body-marker-lifecycle.js";
import type { ChromeApi } from "../src/chrome.js";
import { createDnrInstaller } from "../src/dnr.js";
import { lookupMatchIndexEntry, writeMatchIndex } from "../src/match-index.js";
import {
  BODY_MARKER_ID_MIN,
  bodyMarkerIdForIndex,
} from "../src/session-body-markers.js";
import { chromeHeldInstaller, HEADER_BAND_ID } from "./dnr-harness.js";

const requestBodyOp: RequestBodyOperation = {
  kind: "request-body",
  groupId: "g1",
  ruleId: "body-req-1",
  name: "body-req-1",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/api$",
    },
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
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/page$",
    },
    resourceTypes: ["xmlhttprequest"],
    priority: 40,
    method: "GET",
  },
  responseBody: { mode: "replace", body: "<html/>" },
};

function sessionOptions(overrides: {
  api: ChromeApi;
  runtimeStripPathAvailable?: boolean;
  probeGates?: {
    readonly "request-body": boolean;
    readonly "response-body": boolean;
  };
  nativeStart?: () => Promise<{ state: string; message?: string }>;
  getProject?: () => Promise<{
    data: unknown;
    enabledGroupIds: readonly string[];
  } | null>;
}) {
  const projectData = {
    version: 2,
    name: "Body lifecycle",
    groups: [
      {
        id: "g1",
        name: "g1",
        rules: [
          {
            id: "body-req-1",
            name: "body-req-1",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/api$",
            },
            resourceTypes: ["xmlhttprequest"],
            priority: 50,
            method: "POST",
            type: "request-body",
            requestBody: { mode: "replace", body: '{"ok":true}' },
          },
          {
            id: "body-res-1",
            name: "body-res-1",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/page$",
            },
            resourceTypes: ["xmlhttprequest"],
            priority: 40,
            method: "GET",
            type: "response-body",
            responseBody: { mode: "replace", body: "<html/>" },
          },
        ],
      },
    ],
  };
  return {
    extensionId: "test-ext",
    nativeRuntime: {
      start:
        overrides.nativeStart ?? (async () => ({ state: "started" as const })),
      stop: async () => ({ state: "stopped" as const }),
      status: async () => ({ state: "stopped" as const }),
      sendPolicy: async () => {},
    },
    getProject:
      overrides.getProject ??
      (async () => ({
        data: projectData,
        enabledGroupIds: ["g1"],
      })),
    bodyMarkers: {
      api: overrides.api,
      runtimeStripPathAvailable: overrides.runtimeStripPathAvailable ?? true,
      probeGates: overrides.probeGates ?? DEFAULT_BODY_MARKER_PROBE_GATES,
    },
  };
}

describe("body-marker lifecycle + index merge", () => {
  it("start with strip path → session body-band present + index hit by id", async () => {
    const held = chromeHeldInstaller();
    const { startNativeSession } = await import("../src/native-session.js");

    const result = await startNativeSession(sessionOptions({ api: held.api }));
    expect(result.ok).toBe(true);

    expect(held.sessionIds()).toEqual([
      bodyMarkerIdForIndex(0),
      bodyMarkerIdForIndex(1),
    ]);
    expect(held.updateDynamicRules).not.toHaveBeenCalled();

    const reqEntry = await lookupMatchIndexEntry(
      held.api,
      bodyMarkerIdForIndex(0),
    );
    const resEntry = await lookupMatchIndexEntry(
      held.api,
      bodyMarkerIdForIndex(1),
    );
    expect(reqEntry).toMatchObject({
      ruleId: "body-req-1",
      kind: "request-body",
    });
    expect(resEntry).toMatchObject({
      ruleId: "body-res-1",
      kind: "response-body",
    });
  });

  it("stop → session body-band empty + index lacks those ids", async () => {
    const held = chromeHeldInstaller();
    const { startNativeSession, stopNativeSession } = await import(
      "../src/native-session.js"
    );
    const options = sessionOptions({ api: held.api });

    await startNativeSession(options);
    expect(held.sessionIds().length).toBe(2);

    await stopNativeSession(options);
    expect(held.sessionIds()).toEqual([]);
    expect(
      await lookupMatchIndexEntry(held.api, bodyMarkerIdForIndex(0)),
    ).toBeUndefined();
    expect(
      await lookupMatchIndexEntry(held.api, bodyMarkerIdForIndex(1)),
    ).toBeUndefined();
  });

  it("start-failure rollback → no orphan session body rules + index clean", async () => {
    const held = chromeHeldInstaller();
    held.setSessionIds([BODY_MARKER_ID_MIN]);
    await writeMatchIndex(held.api, {
      [String(BODY_MARKER_ID_MIN)]: {
        ruleId: "orphan",
        name: "orphan",
        kind: "request-body",
        redactSensitiveInLogs: false,
        intent: { mode: "replace", rewrite: "" },
      },
    });

    const { startNativeSession } = await import("../src/native-session.js");
    const result = await startNativeSession(
      sessionOptions({
        api: held.api,
        nativeStart: async () => ({
          state: "failed",
          message: "start-failed",
        }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(held.sessionIds()).toEqual([]);
    expect(
      await lookupMatchIndexEntry(held.api, BODY_MARKER_ID_MIN),
    ).toBeUndefined();
  });

  it("no strip path → no marker install", async () => {
    const held = chromeHeldInstaller();
    const { startNativeSession } = await import("../src/native-session.js");

    const result = await startNativeSession(
      sessionOptions({
        api: held.api,
        runtimeStripPathAvailable: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(held.sessionIds()).toEqual([]);
    expect(held.updateSessionRules).not.toHaveBeenCalled();
    expect(
      await lookupMatchIndexEntry(held.api, bodyMarkerIdForIndex(0)),
    ).toBeUndefined();
  });

  it("response-body skipped when probe gate false", async () => {
    const held = chromeHeldInstaller();
    const { startNativeSession } = await import("../src/native-session.js");

    await startNativeSession(
      sessionOptions({
        api: held.api,
        probeGates: { "request-body": true, "response-body": false },
      }),
    );

    expect(held.sessionIds()).toEqual([bodyMarkerIdForIndex(0)]);
    expect(
      await lookupMatchIndexEntry(held.api, bodyMarkerIdForIndex(0)),
    ).toMatchObject({ kind: "request-body" });
    expect(
      await lookupMatchIndexEntry(held.api, bodyMarkerIdForIndex(1)),
    ).toBeUndefined();
  });

  it("createDnrInstaller never emits body rules; preserves body index ids", async () => {
    const held = chromeHeldInstaller();
    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp, responseBodyOp],
      runtimeStripPathAvailable: true,
    });
    const bodyId = bodyMarkerIdForIndex(0);
    expect(await lookupMatchIndexEntry(held.api, bodyId)).toBeDefined();

    const installer = createDnrInstaller(held.api);
    const headerOp = {
      kind: "header" as const,
      groupId: "g1",
      ruleId: "h1",
      name: "h1",
      redactSensitiveInLogs: false,
      matcher: {
        source: {
          key: "url" as const,
          operator: "regex" as const,
          value: "^https://example\\.com/",
        },
        resourceTypes: ["main_frame" as const],
        priority: 1,
      },
      header: {
        direction: "request" as const,
        operation: "set" as const,
        name: "X-Test",
        value: "1",
      },
    };
    expect(await installer.install([headerOp, requestBodyOp])).toEqual({
      ok: true,
    });

    const addCalls = held.updateDynamicRules.mock.calls.map(
      (call) => call[0] as { addRules: Array<{ id: number }> },
    );
    for (const call of addCalls) {
      for (const rule of call.addRules ?? []) {
        expect(rule.id).toBeLessThan(BODY_MARKER_ID_MIN);
        expect(rule.id).not.toBe(HEADER_BAND_ID - 1);
      }
    }
    expect(held.sessionIds()).toContain(bodyId);
    expect(await lookupMatchIndexEntry(held.api, bodyId)).toMatchObject({
      kind: "request-body",
    });
  });
});

describe("installSessionBodyMarkers / removeSessionBodyMarkers", () => {
  it("remove clears markers and index without touching dynamic store", async () => {
    const held = chromeHeldInstaller([HEADER_BAND_ID]);
    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp],
      runtimeStripPathAvailable: true,
    });
    expect(held.sessionIds()).toEqual([BODY_MARKER_ID_MIN]);

    await removeSessionBodyMarkers(held.api);
    expect(held.sessionIds()).toEqual([]);
    expect(held.chromeIds()).toEqual([HEADER_BAND_ID]);
    expect(held.updateDynamicRules).not.toHaveBeenCalled();
    expect(
      await lookupMatchIndexEntry(held.api, BODY_MARKER_ID_MIN),
    ).toBeUndefined();
  });

  it("strip unavailable → clears stale markers/index (no new install)", async () => {
    const held = chromeHeldInstaller();
    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp],
      runtimeStripPathAvailable: true,
    });
    expect(held.sessionIds()).toEqual([BODY_MARKER_ID_MIN]);
    expect(
      await lookupMatchIndexEntry(held.api, BODY_MARKER_ID_MIN),
    ).toBeDefined();

    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp],
      runtimeStripPathAvailable: false,
    });
    expect(held.sessionIds()).toEqual([]);
    expect(
      await lookupMatchIndexEntry(held.api, BODY_MARKER_ID_MIN),
    ).toBeUndefined();
    expect(held.updateDynamicRules).not.toHaveBeenCalled();
  });

  it("strip available + no gated body ops → clears stale markers/index", async () => {
    const held = chromeHeldInstaller();
    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp],
      runtimeStripPathAvailable: true,
    });
    expect(held.sessionIds()).toEqual([BODY_MARKER_ID_MIN]);

    await installSessionBodyMarkers({
      api: held.api,
      operations: [requestBodyOp],
      runtimeStripPathAvailable: true,
      probeGates: { "request-body": false, "response-body": false },
    });
    expect(held.sessionIds()).toEqual([]);
    expect(
      await lookupMatchIndexEntry(held.api, BODY_MARKER_ID_MIN),
    ).toBeUndefined();
  });
});
