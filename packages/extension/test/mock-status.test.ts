import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const mockProject: RogatioProject = {
  version: 2,
  name: "Mock project",
  groups: [
    {
      id: "group-mock",
      name: "Mock group",
      rules: [
        {
          id: "rule-mock",
          name: "Mock",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "mock",
          mock: { status: 200, body: "ok" },
        },
      ],
    },
  ],
};

function chromeApi() {
  return {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
      },
    },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async () => undefined,
    },
  };
}

function harness(options?: {
  readonly native?: boolean;
  readonly installThrows?: boolean;
}) {
  let stored: unknown;
  let fileErrors: readonly {
    ruleId: string;
    code: string;
    message?: string;
  }[] = [];
  const api = chromeApi();
  if (options?.installThrows) {
    api.declarativeNetRequest.updateSessionRules = async () => {
      throw new Error("session update failed");
    };
  }
  const nativeRuntime = {
    start: vi.fn(async () => ({
      state: "started" as const,
      proxy: { host: "127.0.0.1", port: 9 },
    })),
    stop: vi.fn(async () => ({ state: "stopped" as const })),
    status: vi.fn(async () => ({ state: "stopped" as const })),
    sendPolicy: vi.fn(async () => undefined),
    send: vi.fn(async (envelope: { type: string }) => {
      if (envelope.type === "mock.connect") {
        return {
          protocol: "v1" as const,
          type: "mock.connect",
          timestamp: 1,
          metadata: { mocks: [{ ruleId: "rule-mock", token: "tok" }] },
        };
      }
      if (envelope.type === "runtime.status") {
        return {
          protocol: "v1" as const,
          type: "runtime.status",
          timestamp: 1,
          metadata: {
            mockFileErrors: fileErrors,
          },
        };
      }
      return {
        protocol: "v1" as const,
        type: envelope.type,
        timestamp: 1,
        metadata: { ok: true, presetDigest: "sha256:abc" },
      };
    }),
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
    ...(options?.native === false
      ? {}
      : {
          nativeRuntime,
          extensionId: "test-extension-id",
          chromeApi: api as never,
        }),
    generateId: () => "mock-project",
    now: () => 1,
  });
  return {
    app,
    setFileErrors(next: typeof fileErrors) {
      fileErrors = next;
    },
  };
}

async function enable(app: ReturnType<typeof createExtensionApplication>) {
  const created = await app.handle({
    version: 1,
    command: "create-project",
    data: mockProject,
  });
  await app.handle({
    version: 1,
    command: "set-group-enabled",
    projectId: "mock-project",
    groupId: "group-mock",
    enabled: true,
  });
  return created;
}

describe("mock extension status", () => {
  it("reports a disabled mock as disabled", async () => {
    const { app } = harness();
    await app.handle({
      version: 1,
      command: "create-project",
      data: mockProject,
    });
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "disabled" }],
        badge: { text: "0", attention: false },
      },
    });
  });

  it("reports unsupported when the native runtime adapter is absent", async () => {
    const { app } = harness({ native: false });
    await enable(app);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        nativeRuntimeState: { phase: "unsupported" },
        ruleStatuses: [
          {
            status: "unsupported",
            diagnostics: [{ code: "extension.unsupported" }],
          },
        ],
      },
    });
  });

  it("reports an unprojectable mock source as unsupported", async () => {
    const { app } = harness();
    const project = structuredClone(mockProject);
    const rule = project.groups[0]?.rules[0];
    if (rule === undefined) throw new Error("missing rule");
    rule.source = {
      key: "host",
      operator: "regex",
      value: "^.*\\.example\\.com$",
    };
    await app.handle({
      version: 1,
      command: "create-project",
      data: project,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "mock-project",
      groupId: "group-mock",
      enabled: true,
    });
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "unsupported" }],
      },
    });
  });

  it("reports needs runtime before start and does not count it active", async () => {
    const { app } = harness();
    await enable(app);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "needs runtime" }],
        badge: { text: "0", attention: true },
      },
    });
  });

  it("reports active only after the mock redirect is installed", async () => {
    const { app } = harness();
    await enable(app);
    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "active" }] },
    });
  });

  it("reports error when mock redirect installation fails", async () => {
    const { app } = harness({ installThrows: true });
    await enable(app);
    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started.ok).toBe(false);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          {
            status: "error",
            diagnostics: [{ code: "extension.install-failed" }],
          },
        ],
      },
    });
  });

  it("overlays a redacted file error and clears it on save and later success", async () => {
    const { app, setFileErrors } = harness();
    await enable(app);
    const before = await app.handle({ version: 1, command: "get-state" });
    const revision =
      before.ok &&
      before.value &&
      typeof before.value === "object" &&
      "projects" in before.value
        ? (before.value.projects as Record<string, { revision?: number }>)[
            "mock-project"
          ]?.revision
        : undefined;
    expect(typeof revision).toBe("number");
    await app.handle({ version: 1, command: "start-native-runtime" });
    setFileErrors([
      {
        ruleId: "rule-mock",
        code: "runtime.file-denied",
        message: "open /tmp/secret.txt failed",
      },
    ]);
    const failed = await app.handle({ version: 1, command: "get-state" });
    expect(failed).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          {
            status: "error",
            diagnostics: [
              {
                code: "extension.mock-file-denied",
                path: "",
                message: "The mock file could not be read.",
              },
            ],
          },
        ],
        badge: { text: "0", attention: true },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("secret.txt");
    expect(JSON.stringify(failed)).not.toContain("/tmp");

    const saved = await app.handle({
      version: 1,
      command: "save-project",
      projectId: "mock-project",
      expectedRevision: revision,
      data: mockProject,
    });
    expect(saved.ok).toBe(true);
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "mock-project",
      groupId: "group-mock",
      enabled: true,
    });
    const cleared = await app.handle({ version: 1, command: "get-state" });
    expect(cleared).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "active" }] },
    });
    expect(JSON.stringify(cleared)).not.toContain("secret.txt");

    await app.handle({ version: 1, command: "stop-native-runtime" });
    setFileErrors([]);
    await app.handle({ version: 1, command: "start-native-runtime" });
    const recovered = await app.handle({ version: 1, command: "get-state" });
    expect(recovered).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "active" }] },
    });
  });
});
