import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const responseProject: RogatioProject = {
  version: 1,
  name: "Response project",
  groups: [
    {
      id: "group-response",
      name: "Response group",
      origins: ["https://example.com"],
      rules: [
        {
          id: "rule-response",
          name: "Rewrite response",
          urlRegex: "^https://example\\.com/data$",
          origins: [],
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
    permissions: {
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
    },
    installer: {
      current: async () => [],
      install: async () => ({ ok: true as const }),
    },
    nativeRuntime,
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

describe("F15 response-body extension status", () => {
  it("reports needs proxy before explicit start and active after start", async () => {
    const { app, nativeRuntime } = harness();
    await prepare(app);

    const before = await app.handle({ version: 1, command: "get-state" });
    expect(before).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "needs proxy" }] },
    });

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
    const { app } = harness();
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
      permissions: {
        contains: async () => true,
        request: async () => true,
        remove: async () => true,
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
        ruleStatuses: [{ status: "needs proxy" }],
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
    expect(app).toBeDefined();
  });
});
