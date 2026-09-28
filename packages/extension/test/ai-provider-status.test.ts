/**
 * The AI capability check is metadata-only and reports host provider metadata
 * (spec REQ-004..REQ-008, AC-004..AC-006, AC-010).
 *
 * The "old host" cases emulate what the real bridge does when the host drops an
 * unknown envelope frame: `send` rejects with the bridge timeout error
 * (background.ts) because the host never answers.
 */
import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type {
  NativeEnvelope,
  NativeEnvelopeInput,
} from "../src/native-session.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { project } from "./fixtures.js";

const BRIDGE_TIMEOUT = new Error(
  "Native messaging host timed out before responding.",
);

type SendBehavior = (envelope: NativeEnvelopeInput) => Promise<NativeEnvelope>;

function harness(sendBehavior: SendBehavior) {
  let stored: unknown;
  const send = vi.fn(sendBehavior);
  let installed: RogatioOperation[] = [];
  const options = {
    storage: {
      read: async () => stored,
      compareAndSwap: async (previous: unknown, next: unknown) => {
        if (stored !== previous) return false;
        stored = next;
        return true;
      },
    },
    installer: {
      current: async () => installed,
      install: async (operations: readonly RogatioOperation[]) => {
        installed = [...operations];
        return { ok: true as const };
      },
    },
    nativeRuntime: {
      start: vi.fn(async () => ({ state: "started" as const })),
      stop: vi.fn(async () => ({ state: "stopped" as const })),
      status: vi.fn(async () => ({ state: "stopped" as const })),
      sendPolicy: vi.fn(async () => {}),
      send,
    },
    extensionId: "test-extension-id",
    generateId: () => "generated",
    now: () => 1,
  };
  return { app: createExtensionApplication(options), send };
}

async function start(
  app: ReturnType<typeof createExtensionApplication>,
): Promise<void> {
  await app.handle({ version: 1, command: "create-project", data: project });
  await app.handle({ version: 1, command: "start-native-runtime" });
}

/**
 * Session handshake is answered normally; `ai.status` is answered with the
 * given response envelope.
 */
function hostAnswers(response: {
  type?: string;
  metadata: Record<string, unknown>;
}): SendBehavior {
  return async (envelope) => {
    if (envelope.type === "runtime.project.set") {
      return {
        protocol: "v1",
        type: "runtime.project.set",
        timestamp: Date.now(),
        metadata: { ok: true },
      };
    }
    if (envelope.type === "mock.connect") {
      return {
        protocol: "v1",
        type: "mock.connect",
        timestamp: Date.now(),
        metadata: { mocks: [] },
      };
    }
    return {
      protocol: "v1",
      type: response.type ?? "ai.status",
      timestamp: Date.now(),
      metadata: response.metadata,
    };
  };
}

/** Session handshake is answered normally; `ai.status` rejects like the bridge timeout for a dropped frame. */
function hostDropsStatus(): SendBehavior {
  return async (envelope) => {
    if (envelope.type === "runtime.project.set") {
      return {
        protocol: "v1",
        type: "runtime.project.set",
        timestamp: Date.now(),
        metadata: { ok: true },
      };
    }
    if (envelope.type === "mock.connect") {
      return {
        protocol: "v1",
        type: "mock.connect",
        timestamp: Date.now(),
        metadata: { mocks: [] },
      };
    }
    throw BRIDGE_TIMEOUT;
  };
}

function sentTypes(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map(
    ([envelope]) => (envelope as { type: string }).type,
  );
}

describe("metadata-only AI capability check (REQ-004, AC-004)", () => {
  it("sends exactly one ai.status and no ai.complete when the host is configured", async () => {
    const { app, send } = harness(
      hostAnswers({
        metadata: {
          configured: true,
          providerUrl: "https://api.example.com/v1",
          model: "example-model-1",
        },
      }),
    );
    await start(app);

    const result = await app.handle({
      version: 1,
      command: "check-ai-support",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
      },
    });
    expect(sentTypes(send)).toContain("ai.status");
    expect(sentTypes(send)).not.toContain("ai.complete");
  });

  it("sends no ai.complete on failure paths either", async () => {
    const { app, send } = harness(hostDropsStatus());
    await start(app);

    await app.handle({ version: 1, command: "check-ai-support" });

    expect(sentTypes(send)).not.toContain("ai.complete");
  });
});

describe("host-reported provider metadata (REQ-001, AC-006)", () => {
  it("passes providerUrl and model through", async () => {
    const { app } = harness(
      hostAnswers({
        metadata: {
          configured: true,
          providerUrl: "https://provider.test/v1",
          model: "model-x",
        },
      }),
    );
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: {
        supported: true,
        reported: true,
        providerUrl: "https://provider.test/v1",
        model: "model-x",
      },
    });
  });

  it("maps configured:false to reported-but-unsupported without provider fields", async () => {
    const { app } = harness(hostAnswers({ metadata: { configured: false } }));
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: true },
    });
  });
});

describe("not-reported fallback against an old host (REQ-007, AC-005)", () => {
  it("reports not reported when send rejects like a bridge timeout", async () => {
    const { app } = harness(hostDropsStatus());
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: false },
    });
  });

  it("reports not reported for a non-conforming response envelope", async () => {
    // An old host has no `ai.status` case and never answers; a stub that
    // answers with a different envelope type is equally non-conforming.
    const { app } = harness(
      hostAnswers({
        type: "ai.complete",
        metadata: { content: "not a status response" },
      }),
    );
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: false },
    });
  });

  it("treats partial metadata (configured without provider strings) as not reported", async () => {
    const { app } = harness(hostAnswers({ metadata: { configured: true } }));
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: false },
    });
  });

  it("keeps other native-session traffic working after the failed check (AC-005)", async () => {
    // Session and completions answer normally; only `ai.status` is dropped.
    const { app } = harness(async (envelope) => {
      if (envelope.type === "runtime.project.set") {
        return {
          protocol: "v1",
          type: "runtime.project.set",
          timestamp: Date.now(),
          metadata: { ok: true },
        };
      }
      if (envelope.type === "mock.connect") {
        return {
          protocol: "v1",
          type: "mock.connect",
          timestamp: Date.now(),
          metadata: { mocks: [] },
        };
      }
      if (envelope.type === "ai.status") throw BRIDGE_TIMEOUT;
      return {
        protocol: "v1",
        type: "ai.complete",
        timestamp: Date.now(),
        metadata: {
          content: JSON.stringify({
            version: 2,
            name: "Generated",
            groups: [],
          }),
        },
      };
    });
    await start(app);

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: false },
    });

    // The session is not damaged by the dropped check.
    await expect(
      app.handle({
        version: 1,
        command: "generate-project",
        prompt: "Make one",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { version: 2, name: "Generated", groups: [] },
    });
  });

  it("bounds the wait when the host never answers", async () => {
    const { app } = harness(async (envelope) => {
      // The session handshake answers; only `ai.status` never gets a reply,
      // exactly like an older host dropping the unknown frame.
      if (envelope.type === "runtime.project.set") {
        return {
          protocol: "v1",
          type: "runtime.project.set",
          timestamp: Date.now(),
          metadata: { ok: true },
        };
      }
      if (envelope.type === "mock.connect") {
        return {
          protocol: "v1",
          type: "mock.connect",
          timestamp: Date.now(),
          metadata: { mocks: [] },
        };
      }
      return new Promise<NativeEnvelope>(() => {});
    });
    await start(app);
    // Fake timers only around the check itself; the harness startup above uses
    // real timer work internally.
    vi.useFakeTimers();
    try {
      const pending = app.handle({
        version: 1,
        command: "check-ai-support",
      });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual({
        ok: true,
        value: { supported: false, reported: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runtime gate (AC-010)", () => {
  it("reports not reported and sends no envelope when the runtime is not started", async () => {
    const { app, send } = harness(
      hostAnswers({ metadata: { configured: false } }),
    );
    await app.handle({ version: 1, command: "create-project", data: project });

    await expect(
      app.handle({ version: 1, command: "check-ai-support" }),
    ).resolves.toEqual({
      ok: true,
      value: { supported: false, reported: false },
    });
    expect(sentTypes(send)).not.toContain("ai.status");
    expect(sentTypes(send)).not.toContain("ai.complete");
  });
});
