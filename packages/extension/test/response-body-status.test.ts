import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const responseProject: RogatioProject = {
  version: 2,
  name: "Response project",
  groups: [
    {
      id: "group-response",
      name: "Response group",
      rules: [
        {
          id: "rule-response",
          name: "Rewrite response",
          source: {
            key: "host",
            operator: "regex",
            value: "^example\\.com$",
          },
          resourceTypes: ["xmlhttprequest"],
          priority: 100,
          method: "GET",
          type: "response-body",
          responseBody: {
            replacements: [{ pattern: "old", replacement: "new" }],
          },
        },
      ],
    },
  ],
};

function harness() {
  let stored: unknown;
  const nativeRuntime = {
    start: vi.fn(async () => ({ state: "started" as const })),
    stop: vi.fn(async () => ({ state: "stopped" as const })),
    status: vi.fn(async () => ({ state: "stopped" as const })),
    sendPolicy: vi.fn(async (_frames: Uint8Array[]) => {}),
  };
  const app = createExtensionApplication({
    storage: {
      read: async () => stored,
      compareAndSwap: async (previous: unknown, next: unknown) => {
        if (stored !== previous) return false;
        stored = next;
        return true;
      },
    },
    installer: {
      current: async () => [],
      install: async () => ({ ok: true as const }),
    },
    nativeRuntime,
    extensionId: "test-extension-id",
    generateId: () => "response-project",
    now: () => 1,
  });
  return { app, nativeRuntime };
}

async function prepare(app: ReturnType<typeof createExtensionApplication>) {
  await app.handle({
    version: 1,
    command: "create-project",
    data: responseProject,
  });
  await app.handle({
    version: 1,
    command: "set-group-enabled",
    projectId: "response-project",
    groupId: "group-response",
    enabled: true,
  });
}

describe("response-body extension status", () => {
  it("reports enabled body rules as needing runtime before explicit start", async () => {
    const { app } = harness();
    await prepare(app);

    const before = await app.handle({ version: 1, command: "get-state" });
    expect(before).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "needs runtime" }] },
    });
  });

  it("reports body rules as active after the runtime starts", async () => {
    const { app, nativeRuntime } = harness();
    await prepare(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "started" },
        ruleStatuses: [{ status: "active" }],
      },
    });
    expect(nativeRuntime.start).toHaveBeenCalledOnce();
  });

  it("reports unsupported without a native runtime adapter", async () => {
    let unsupportedStored: unknown;
    const noAdapter = createExtensionApplication({
      storage: {
        read: async () => unsupportedStored,
        compareAndSwap: async (previous: unknown, next: unknown) => {
          if (unsupportedStored !== previous) return false;
          unsupportedStored = next;
          return true;
        },
      },
      installer: {
        current: async () => [],
        install: async () => ({ ok: true as const }),
      },
      generateId: () => "unsupported-project",
      now: () => 1,
    });
    await noAdapter.handle({
      version: 1,
      command: "create-project",
      data: responseProject,
    });
    await noAdapter.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "unsupported-project",
      groupId: "group-response",
      enabled: true,
    });
    const state = await noAdapter.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "unsupported" },
        ruleStatuses: [{ status: "unsupported" }],
      },
    });
    expect(
      await noAdapter.handle({
        version: 1,
        command: "start-native-runtime",
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.native-runtime-unavailable" },
    });
  });

  it("reports exact URL body rules as active after the runtime starts", async () => {
    const exactUrlProject: RogatioProject = {
      version: 2,
      name: "Exact URL body",
      groups: [
        {
          id: "group-exact",
          name: "Exact group",
          rules: [
            {
              id: "rule-response-exact",
              name: "Rewrite response body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/data\\.json$",
              },
              resourceTypes: ["main_frame"],
              priority: 500,
              type: "response-body",
              responseBody: {
                replacements: [
                  { pattern: "oldValue", replacement: "newValue" },
                ],
              },
            },
            {
              id: "rule-request-exact",
              name: "Replace request body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/(submit)$",
              },
              resourceTypes: ["xmlhttprequest"],
              priority: 600,
              method: "POST",
              type: "request-body",
              requestBody: { mode: "replace", body: '{"user":"$1"}' },
            },
          ],
        },
      ],
    };
    const { app } = harness();
    await app.handle({
      version: 1,
      command: "create-project",
      data: exactUrlProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "response-project",
      groupId: "group-exact",
      enabled: true,
    });
    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "started" },
        ruleStatuses: [{ status: "active" }, { status: "active" }],
      },
    });
  });

  it("reports path-prefix body rules as active after the runtime starts", async () => {
    const prefixProject: RogatioProject = {
      version: 2,
      name: "Prefix body",
      groups: [
        {
          id: "group-prefix",
          name: "Prefix group",
          rules: [
            {
              id: "rule-response-prefix",
              name: "Rewrite response body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/data\\.json/([^/]+)",
              },
              resourceTypes: ["main_frame"],
              priority: 500,
              type: "response-body",
              responseBody: {
                replacements: [
                  { pattern: "oldValue", replacement: "newValue" },
                ],
              },
            },
            {
              id: "rule-request-prefix",
              name: "Replace request body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/submit/([^/]+)",
              },
              resourceTypes: ["xmlhttprequest"],
              priority: 600,
              method: "POST",
              type: "request-body",
              requestBody: { mode: "replace", body: '{"user":"$1"}' },
            },
          ],
        },
      ],
    };
    const { app } = harness();
    await app.handle({
      version: 1,
      command: "create-project",
      data: prefixProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "response-project",
      groupId: "group-prefix",
      enabled: true,
    });
    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "started" },
        ruleStatuses: [{ status: "active" }, { status: "active" }],
      },
    });
  });

  it("keeps a request-body rule needs runtime when the regex does not name one literal host", async () => {
    const urlRegexProject: RogatioProject = {
      version: 2,
      name: "URL regex body",
      groups: [
        {
          id: "group-url",
          name: "URL group",
          rules: [
            {
              id: "rule-url-body",
              name: "URL body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://.*\\.example\\.com/submit",
              },
              resourceTypes: ["xmlhttprequest"],
              priority: 100,
              method: "POST",
              type: "request-body",
              requestBody: { mode: "replace", body: "{}" },
            },
          ],
        },
      ],
    };
    const { app, nativeRuntime } = harness();
    await app.handle({
      version: 1,
      command: "create-project",
      data: urlRegexProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "response-project",
      groupId: "group-url",
      enabled: true,
    });

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "started" },
        ruleStatuses: [
          {
            status: "needs runtime",
            diagnostics: [{ code: "runtime.pac-unroutable" }],
          },
        ],
      },
    });
    expect(nativeRuntime.start).toHaveBeenCalledOnce();
  });
});
