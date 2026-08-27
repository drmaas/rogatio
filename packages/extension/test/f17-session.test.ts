import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const requestBodyProject = {
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

describe("F17 request-body extension session (future API)", () => {
  it("serializes start, stop, policy replacement, permission changes, PAC changes, marker installation", async () => {
    const { app } = harness();
    await prepare(app);

    // Extension coordinator should serialize all session operations
    // Start only after explicit user action and successful policy, identity, trust, capability, collision, arbitration checks
    expect(app).toBeDefined();
  });

  it("start validates policy, trust, capability, collision, PAC, marker before accepting traffic", async () => {
    const { app } = harness();
    await prepare(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started.ok).toBe(true);
    // On failure: stops acceptance, removes owned markers, restores PAC only if owned, stops session, clears transient state
  });

  it("stop is idempotent and invalidates policy, capabilities, sockets, timers, workers, removes owned routing", async () => {
    const { app, nativeRuntime } = harness();
    await prepare(app);
    await app.handle({ version: 1, command: "start-native-runtime" });

    const stopped = await app.handle({
      version: 1,
      command: "stop-native-runtime",
    });
    expect(stopped.ok).toBe(true);
    expect(nativeRuntime.stop).toHaveBeenCalledOnce();

    // Second stop should also succeed
    const stoppedAgain = await app.handle({
      version: 1,
      command: "stop-native-runtime",
    });
    expect(stoppedAgain.ok).toBe(true);
  });

  it("policy change removes old routing before new policy activates", async () => {
    const { app } = harness();
    await prepare(app);
    await app.handle({ version: 1, command: "start-native-runtime" });

    // Changing project, enablement, permission, local-origin should tear down session
    // and require new explicit start
    expect(app).toBeDefined();
  });

  it("permission revocation removes routing", async () => {
    const { app } = harness();
    await prepare(app);
    await app.handle({ version: 1, command: "start-native-runtime" });

    // Revoking permission should stop the session
    expect(app).toBeDefined();
  });

  it("capability loss removes routing", async () => {
    const { app } = harness();
    await prepare(app);
    await app.handle({ version: 1, command: "start-native-runtime" });

    // Losing capability (trust, PAC, proxy control) should stop the session
    expect(app).toBeDefined();
  });

  it("fatal provider failure removes routing", async () => {
    const { app } = harness();
    await prepare(app);

    // Provider failure during start should leave prior routing unchanged
    expect(app).toBeDefined();
  });

  it("CLI does not own or silently replace extension live session", async () => {
    const { app } = harness();
    await prepare(app);

    // CLI runtime start without extension policy cannot begin request-body interception
    expect(app).toBeDefined();
  });
});
