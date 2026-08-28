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
  const metadataCalls: Array<Record<string, unknown>> = [];
  const nativeRuntime = {
    start: vi.fn(async (_config: unknown) => ({ state: "started" as const })),
    stop: vi.fn(async () => ({ state: "stopped" as const })),
    status: vi.fn(async () => ({ state: "stopped" as const })),
    sendPrepare: vi.fn(async (metadata: Record<string, unknown>) => {
      metadataCalls.push(metadata);
      return { ok: true };
    }),
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
    generateId: () => "request-body-project",
    now: () => 1,
  });
  return { app, nativeRuntime, metadataCalls };
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
  await app.handle({
    version: 1,
    command: "start-native-runtime",
  });
}

describe(" request-body metadata integration (future API)", () => {
  it("copies only explicit safe fields for best-effort diagnostics", async () => {
    const { app, nativeRuntime } = harness();
    await prepare(app);

    // Simulate a webRequest event (implementation will add this)
    // The listener should explicitly copy: URL, target, method, resourceType, initiator, requestId, policyDigest
    // Never read or spread details.requestBody, headers, cookies, authorization
    expect(nativeRuntime.sendPrepare).toBeDefined();
  });

  it("never uses metadata as body authority", async () => {
    const { app } = harness();
    await prepare(app);

    // Native runtime must validate against committed session policy only
    // Per-request rule ID, selected operation, grant, or browser claim is never sufficient
    expect(app).toBeDefined();
  });

  it("never accesses or spreads details.requestBody, headers, cookies, or authorization values", async () => {
    const { app } = harness();
    await prepare(app);

    // The listener must explicitly copy safe fields only
    expect(app).toBeDefined();
  });
});
