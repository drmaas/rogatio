import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type {
  NativeEnvelope,
  NativeEnvelopeInput,
} from "../src/native-session.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { project } from "./fixtures.js";

const proposal = {
  rules: [
    {
      kind: "redirect",
      groupId: "group-a",
      name: "Redirect old",
      urlRegex: "^https://example\\.com/old$",
      origins: [],
      resourceTypes: ["main_frame"],
      priority: 100,
      action: { destination: "https://example.com/new" },
    },
  ],
  explanation: "Redirects old to new",
};

function harness(
  aiResponse: unknown = {
    protocol: "v1",
    type: "ai.complete",
    metadata: { content: JSON.stringify(proposal) },
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
  };
}

async function start(
  app: ReturnType<typeof createExtensionApplication>,
): Promise<void> {
  await app.handle({ version: 1, command: "create-project", data: project });
  await app.handle({ version: 1, command: "start-native-runtime" });
}

describe("extension AI Assist", () => {
  it("rejects invalid prompts before contacting the native host", async () => {
    const { app, send } = harness();
    await start(app);

    const result = await app.handle({
      version: 1,
      command: "ai-assist",
      kind: "generate",
      prompt: " ",
      context: { project },
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-prompt" },
    });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai.complete" }),
    );
  });

  it("returns a validated proposal via ai.complete (AC-007)", async () => {
    const { app, send } = harness();
    await start(app);

    const result = await app.handle({
      version: 1,
      command: "ai-assist",
      kind: "generate",
      prompt: "Add a redirect",
      context: { project },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { proposal },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai.complete",
        metadata: expect.objectContaining({
          model: "",
          responseFormat: { type: "json_object" },
        }),
      }),
    );
    // Never uses CLI loopback HTTP (AC-008): only native envelopes.
    expect(send.mock.calls.every((call) => call[0].protocol === "v1")).toBe(
      true,
    );
  });

  it("rejects schema-invalid proposals", async () => {
    const { app } = harness({
      protocol: "v1",
      type: "ai.complete",
      metadata: {
        content: JSON.stringify({
          rules: [
            {
              kind: "redirect",
              groupId: "g1",
              name: "Bad",
              urlRegex: "[",
              action: { destination: "https://example.com/new" },
            },
          ],
          explanation: "bad",
        }),
      },
    });
    await start(app);

    await expect(
      app.handle({
        version: 1,
        command: "ai-assist",
        kind: "generate",
        prompt: "Add a redirect",
        context: { project },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-proposal" },
    });
  });

  it("accepts a fix proposal that repairs the offending rule (AC-001)", async () => {
    const broken = structuredClone(project) as unknown as {
      groups: Array<{ rules: Array<Record<string, unknown>> }>;
    } & Record<string, unknown>;
    broken.groups[0].rules[0].urlRegex = "[";
    const { app } = harness();
    await start(app);

    const result = await app.handle({
      version: 1,
      command: "ai-assist",
      kind: "fix",
      prompt: "Fix the broken rule",
      context: {
        project: broken,
        diagnostics: [
          {
            code: "schema.invalid-regex",
            severity: "error",
            path: "/groups/0/rules/0/urlRegex",
            message: "Invalid regex",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { proposal },
    });
  });

  it("rejects a fix proposal that does not repair the project (AC-002)", async () => {
    const broken = structuredClone(project) as unknown as {
      groups: Array<{ rules: Array<Record<string, unknown>> }>;
    } & Record<string, unknown>;
    broken.groups[0].rules[0].urlRegex = "[";
    // Structurally valid proposal, but targeting a new group: it appends
    // instead of repairing, so the merged project stays invalid.
    const nonRepairing = {
      ...proposal,
      rules: [{ ...proposal.rules[0], groupId: "group-new" }],
    };
    const { app } = harness({
      protocol: "v1",
      type: "ai.complete",
      metadata: { content: JSON.stringify(nonRepairing) },
    });
    await start(app);

    await expect(
      app.handle({
        version: 1,
        command: "ai-assist",
        kind: "fix",
        prompt: "Fix the broken rule",
        context: {
          project: broken,
          diagnostics: [
            {
              code: "schema.invalid-regex",
              severity: "error",
              path: "/groups/0/rules/0/urlRegex",
              message: "Invalid regex",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-proposal" },
    });
  });

  it("keeps append validation for generate requests with a broken draft", async () => {
    const broken = structuredClone(project) as unknown as {
      groups: Array<{ rules: Array<Record<string, unknown>> }>;
    } & Record<string, unknown>;
    broken.groups[0].rules[0].urlRegex = "[";
    const { app } = harness();
    await start(app);

    await expect(
      app.handle({
        version: 1,
        command: "ai-assist",
        kind: "generate",
        prompt: "Add a redirect",
        context: { project: broken },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-invalid-proposal" },
    });
  });

  it("requires a started native runtime", async () => {
    const { app } = harness();
    await app.handle({ version: 1, command: "create-project", data: project });

    await expect(
      app.handle({
        version: 1,
        command: "ai-assist",
        kind: "generate",
        prompt: "Add a redirect",
        context: { project },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-unavailable" },
    });
  });

  it("rejects oversized Assist envelopes before native send", async () => {
    const { app, send } = harness();
    await start(app);
    const hugeProject = {
      ...project,
      description: "x".repeat(70 * 1024),
    };

    await expect(
      app.handle({
        version: 1,
        command: "ai-assist",
        kind: "generate",
        prompt: "Add a redirect",
        context: { project: hugeProject },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "extension.ai-request-too-large" },
    });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai.complete" }),
    );
  });
});
