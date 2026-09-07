import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type {
  NativeEnvelope,
  NativeEnvelopeInput,
} from "../src/native-session.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { project } from "./fixtures.js";

function harness(
  aiResponse: unknown = {
    protocol: "v1",
    type: "ai.complete",
    metadata: {
      content: JSON.stringify({ version: 1, name: "Generated", groups: [] }),
    },
  },
) {
  let stored: unknown;
  let nextId = 0;
  const send = vi.fn(
    async (envelope: NativeEnvelopeInput): Promise<NativeEnvelope> => {
      if (envelope.type === "runtime.project.set") {
        return {
          protocol: "v1" as const,
          type: "runtime.project.set",
          timestamp: Date.now(),
          metadata: { ok: true },
        };
      }
      if (envelope.type === "mock.connect") {
        return {
          protocol: "v1" as const,
          type: "mock.connect",
          timestamp: Date.now(),
          metadata: { mocks: [] },
        };
      }
      return {
        ...(aiResponse as NativeEnvelope),
        timestamp: Date.now(),
      };
    },
  );
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
    permissions: {
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
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
    generateId: () => `generated-project-${++nextId}`,
    now: () => 1,
  };
  return {
    app: createExtensionApplication(options),
    send,
    getStored: () => stored,
  };
}

async function start(
  app: ReturnType<typeof createExtensionApplication>,
): Promise<void> {
  await app.handle({ version: 1, command: "create-project", data: project });
  await app.handle({ version: 1, command: "start-native-runtime" });
}

describe("extension AI project generation", () => {
  it("rejects an invalid or oversized prompt before contacting the native host", async () => {
    const { app, send } = harness();
    await start(app);

    const result = await app.handle({
      version: 1,
      command: "generate-project",
      prompt: " ",
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-prompt" },
    });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai.complete" }),
    );
  });

  it("returns a detached validated preview without persisting it", async () => {
    const { app, getStored, send } = harness();
    await start(app);
    const before = getStored();

    const result = await app.handle({
      version: 1,
      command: "generate-project",
      prompt: "Create a simple redirect project",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { version: 1, name: "Generated", groups: [] },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai.complete",
        metadata: expect.objectContaining({
          responseFormat: { type: "json_object" },
        }),
      }),
    );
    expect(getStored()).toEqual(before);
  });

  it("rejects malformed or schema-invalid AI output without persistence", async () => {
    const { app: malformed, getStored: malformedStored } = harness({
      protocol: "v1",
      type: "ai.complete",
      metadata: { content: "not json" },
    });
    await start(malformed);
    const malformedBefore = malformedStored();
    await expect(
      malformed.handle({
        version: 1,
        command: "generate-project",
        prompt: "Create a project",
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-response" },
    });
    expect(malformedStored()).toEqual(malformedBefore);

    const { app: invalid, getStored: invalidStored } = harness({
      protocol: "v1",
      type: "ai.complete",
      metadata: {
        content: JSON.stringify({ version: 1, name: "", groups: [] }),
      },
    });
    await start(invalid);
    const invalidBefore = invalidStored();
    await expect(
      invalid.handle({
        version: 1,
        command: "generate-project",
        prompt: "Create a project",
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-project" },
    });
    expect(invalidStored()).toEqual(invalidBefore);
  });

  it("persists a generated project only when the caller explicitly imports the preview", async () => {
    const { app, getStored } = harness();
    await start(app);
    const generated = await app.handle({
      version: 1,
      command: "generate-project",
      prompt: "Create a project",
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const beforeImport = getStored();
    expect(beforeImport).toMatchObject({
      projects: { "generated-project-1": {} },
    });
    const imported = await app.handle({
      version: 1,
      command: "import-project",
      data: generated.value,
    });
    expect(imported.ok).toBe(true);
    expect(getStored()).toMatchObject({
      projects: {
        "generated-project-1": {},
        "generated-project-2": { data: { name: "Generated" } },
      },
    });
  });
});
