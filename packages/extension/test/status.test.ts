import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const requestBodyProject: RogatioProject = {
  version: 1,
  name: "Request body project",
  groups: [
    {
      id: "group-body",
      name: "Body group",
      origins: ["https://example.com"],
      rules: [
        {
          id: "rule-replace",
          name: "Replace body",
          urlRegex: "^https://example\\.com/api$",
          origins: [],
          resourceTypes: ["xmlhttprequest"],
          priority: 50,
          method: "POST",
          type: "request-body",
          requestBody: { mode: "replace", body: '{"debug":false}' },
        },
      ],
    },
  ],
};

type NativeStartResult = {
  readonly state: "started" | "failed" | "unsupported";
  readonly message?: string;
};

function harness(
  start: () => Promise<NativeStartResult> = async () => ({
    state: "started" as const,
  }),
) {
  let stored: unknown;
  const nativeRuntime = {
    start: vi.fn(start),
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
    extensionId: "test-extension-id",
    generateId: () => "request-body-project",
    now: () => 1,
  });
  return { app, nativeRuntime };
}

async function prepare(app: ReturnType<typeof createExtensionApplication>) {
  await app.handle({
    version: 1,
    command: "create-project",
    data: requestBodyProject,
  });
  await app.handle({
    version: 1,
    command: "set-group-enabled",
    projectId: "request-body-project",
    groupId: "group-body",
    enabled: true,
  });
}

describe(" request-body extension status", () => {
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
      data: requestBodyProject,
    });
    await noAdapter.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "unsupported-project",
      groupId: "group-body",
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
  });

  it("reports the host-missing diagnostic and failed phase when the native host is not installed", async () => {
    const { app, nativeRuntime } = harness(async () => ({
      state: "unsupported" as const,
      message: "extension.native-host-missing",
    }));
    await prepare(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.native-host-missing" },
    });
    expect(nativeRuntime.start).toHaveBeenCalledOnce();

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: { nativeRuntimeState: { phase: "failed" } },
    });
  });

  it("reports a transition failure for other native start failures", async () => {
    const { app } = harness(async () => ({
      state: "failed" as const,
      message: "extension.native-runtime-transition",
    }));
    await prepare(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.native-runtime-transition" },
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: { nativeRuntimeState: { phase: "failed" } },
    });
  });
});
