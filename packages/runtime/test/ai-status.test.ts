import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProviderConfig } from "../src/ai-client.js";
import {
  EnvelopeError,
  parseEnvelope,
  serializeEnvelope,
} from "../src/envelope.js";
import { createNativeHost } from "../src/host.js";
import { RUNTIME_LIMITS } from "../src/index.js";
import {
  createNativeRuntimeController,
  type NativeRuntimeController,
  type NativeRuntimeControllerOptions,
} from "../src/lifecycle.js";
import type { NormalizedRuntimePreset, PresetDigest } from "../src/types.js";

const SECRET = "sk-super-secret-key-123";

const FULL_CONFIG: AIProviderConfig = {
  providerUrl: "https://api.example.com/v1",
  model: "example-model-1",
  apiKey: SECRET,
};

const DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

function buildPreset(): NormalizedRuntimePreset {
  return {
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: [],
    grants: [],
    canonicalBytes: new Uint8Array([1, 2, 3]),
    digest: DIGEST as PresetDigest,
  };
}

/**
 * Start a controller and complete the pairing dance so envelope handling is
 * reachable (the same session preconditions `ai.complete` has).
 */
async function startPaired(
  options: Omit<NativeRuntimeControllerOptions, "preset">,
): Promise<NativeRuntimeController> {
  const controller = createNativeRuntimeController({
    preset: buildPreset(),
    ...options,
  });
  await controller.start();
  const bootstrap = controller.getBootstrapCapability();
  if (!bootstrap) throw new Error("Expected bootstrap capability");
  await controller.handleEnvelope({
    type: "pair.request",
    metadata: { capability: bootstrap, presetDigest: DIGEST },
  });
  return controller;
}

type Metadata = Record<string, unknown>;

function responseMetadata(envelope: {
  metadata: Readonly<Record<string, unknown>>;
}): Metadata {
  return envelope.metadata as Metadata;
}

/** Recursively collect every own key name in a JSON-derived structure. */
function collectKeys(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  for (const key of Object.keys(value)) {
    out.push(key);
    collectKeys((value as Record<string, unknown>)[key], out);
  }
  return out;
}

/** Recursively collect every string value in a JSON-derived structure. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  for (const key of Object.keys(value)) {
    collectStrings((value as Record<string, unknown>)[key], out);
  }
  return out;
}

function createMockCompletionResponse(content: string): Response {
  const body = JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestedModel(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex = 0,
): string {
  const call = fetchMock.mock.calls[callIndex];
  const init = call?.[1] as { body?: string } | undefined;
  const parsed = JSON.parse(String(init?.body)) as { model?: unknown };
  return String(parsed.model);
}

describe("ai.status envelope registry (REQ-001, T1)", () => {
  it("round-trips an ai.status envelope through serialize/parse", () => {
    const serialized = serializeEnvelope({
      type: "ai.status",
      requestId: "req-1",
      metadata: {
        configured: true,
        providerUrl: "https://x.test/v1",
        model: "m",
      },
    });
    const parsed = parseEnvelope(serialized);
    expect(parsed.type).toBe("ai.status");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.metadata).toEqual({
      configured: true,
      providerUrl: "https://x.test/v1",
      model: "m",
    });
  });

  it("accepts an empty request metadata object", () => {
    expect(() =>
      serializeEnvelope({ type: "ai.status", metadata: {} }),
    ).not.toThrow();
  });

  it("still rejects unknown envelope types", () => {
    expect(() =>
      serializeEnvelope({
        type: "ai.unknown" as never,
        metadata: {},
      }),
    ).toThrow(EnvelopeError);
  });
});

describe("ai.status session preconditions match ai.complete", () => {
  it("rejects ai.status before start, like every non-bootstrap envelope", async () => {
    const controller = createNativeRuntimeController({
      aiConfigReader: async () => ({ ...FULL_CONFIG }),
    });
    await expect(
      controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    ).rejects.toThrow("runtime not started");
  });
});

describe("ai.status metadata reporting (REQ-001, AC-001)", () => {
  it("reports providerUrl and model from the config reader", async () => {
    const controller = await startPaired({
      aiConfigReader: async () => ({ ...FULL_CONFIG }),
    });
    const response = await controller.handleEnvelope({
      type: "ai.status",
      requestId: "r1",
      metadata: {},
    });
    expect(response.type).toBe("ai.status");
    expect(response.requestId).toBe("r1");
    expect(responseMetadata(response)).toEqual({
      configured: true,
      providerUrl: FULL_CONFIG.providerUrl,
      model: FULL_CONFIG.model,
    });
  });

  it("reports configured:false with no provider keys when no config exists", async () => {
    const controller = await startPaired({ aiConfigReader: async () => null });
    const response = await controller.handleEnvelope({
      type: "ai.status",
      metadata: {},
    });
    const metadata = responseMetadata(response);
    expect(metadata).toEqual({ configured: false });
    expect("providerUrl" in metadata).toBe(false);
    expect("model" in metadata).toBe(false);
    expect("apiKey" in metadata).toBe(false);
  });

  it("reports configured:false without throwing when the reader rejects (malformed config)", async () => {
    const controller = await startPaired({
      aiConfigReader: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });
    const response = await controller.handleEnvelope({
      type: "ai.status",
      metadata: {},
    });
    expect(responseMetadata(response)).toEqual({ configured: false });
  });

  it("reports configured:false for a partial config (missing apiKey)", async () => {
    const controller = await startPaired({
      aiConfigReader: async () =>
        ({
          providerUrl: "https://api.example.com/v1",
          model: "m",
        }) as AIProviderConfig,
    });
    const response = await controller.handleEnvelope({
      type: "ai.status",
      metadata: {},
    });
    expect(responseMetadata(response)).toEqual({ configured: false });
  });

  it("reports configured:false for non-object reader results", async () => {
    for (const weird of [
      42,
      "config",
      [],
      { providerUrl: 1, model: 2, apiKey: 3 },
    ]) {
      const controller = await startPaired({
        aiConfigReader: async () => weird as unknown as AIProviderConfig,
      });
      const response = await controller.handleEnvelope({
        type: "ai.status",
        metadata: {},
      });
      expect(responseMetadata(response)).toEqual({ configured: false });
    }
  });
});

describe("the API key never crosses the host boundary (REQ-002, AC-002)", () => {
  it.each([
    ["configured", async () => ({ ...FULL_CONFIG })],
    ["unconfigured", async () => null],
    ["malformed", async () => Promise.reject(new Error("bad json"))],
    [
      "partial",
      async () =>
        ({
          providerUrl: "https://api.example.com/v1",
          model: "m",
        }) as AIProviderConfig,
    ],
    [
      "hostile extra fields",
      async () =>
        ({
          ...FULL_CONFIG,
          apiKey: SECRET,
          extra: { apiKey: SECRET, nested: [{ ApiKey: SECRET }] },
        }) as unknown as AIProviderConfig,
    ],
  ])(
    "response carries no apiKey key and no key value (%s)",
    async (_label, reader) => {
      const controller = await startPaired({ aiConfigReader: reader });
      const response = await controller.handleEnvelope({
        type: "ai.status",
        metadata: {},
      });
      const serialized = serializeEnvelope({
        type: "ai.status",
        metadata: response.metadata as Record<string, unknown>,
      });
      const keys = collectKeys(JSON.parse(serialized));
      const strings = collectStrings(JSON.parse(serialized));
      expect(keys.every((key) => !/api[-_ ]?key/i.test(key))).toBe(true);
      expect(strings).not.toContain(SECRET);
    },
  );

  it("an ai.error response during completion carries no key value either", async () => {
    const originalFetch = global.fetch;
    try {
      const fetchMock = vi.fn();
      fetchMock.mockRejectedValue(new Error("boom"));
      global.fetch = fetchMock as unknown as typeof global.fetch;
      const controller = await startPaired({
        aiConfigReader: async () => ({ ...FULL_CONFIG }),
      });
      const response = await controller.handleEnvelope({
        type: "ai.complete",
        metadata: {
          messages: [{ role: "user", content: "hi" }],
          model: "",
        },
      });
      const strings = collectStrings(
        JSON.parse(
          serializeEnvelope({
            type: response.type,
            metadata: response.metadata as Record<string, unknown>,
          }),
        ),
      );
      expect(strings).not.toContain(SECRET);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("config refresh without host restart (REQ-003, AC-003)", () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(createMockCompletionResponse("ok"));
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it("reflects a rewritten config on the next ai.status and rebuilds the client", async () => {
    let current: AIProviderConfig | null = { ...FULL_CONFIG };
    const controller = await startPaired({
      aiConfigReader: async () => (current === null ? null : { ...current }),
    });

    const first = responseMetadata(
      await controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    );
    expect(first).toEqual({
      configured: true,
      providerUrl: FULL_CONFIG.providerUrl,
      model: FULL_CONFIG.model,
    });

    // Simulate `rogatio ai setup` rewriting the file while the host runs.
    current = {
      providerUrl: "https://other.example.com/v2",
      model: "example-model-2",
      apiKey: SECRET,
    };

    const second = responseMetadata(
      await controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    );
    expect(second).toEqual({
      configured: true,
      providerUrl: "https://other.example.com/v2",
      model: "example-model-2",
    });

    // The next completion uses the new config (client rebuilt).
    await controller.handleEnvelope({
      type: "ai.complete",
      metadata: {
        messages: [{ role: "user", content: "hi" }],
        model: "",
      },
    });
    expect(requestedModel(fetchMock)).toBe("example-model-2");
  });

  it("uses the refreshed config model for completions that supply no model", async () => {
    const controller = await startPaired({
      aiConfigReader: async () => ({ ...FULL_CONFIG }),
    });
    await controller.handleEnvelope({
      type: "ai.complete",
      metadata: {
        messages: [{ role: "user", content: "hi" }],
        model: "",
      },
    });
    expect(requestedModel(fetchMock)).toBe(FULL_CONFIG.model);
  });

  it("keeps an explicit request model over the configured model (AC-009)", async () => {
    const controller = await startPaired({
      aiConfigReader: async () => ({ ...FULL_CONFIG }),
    });
    await controller.handleEnvelope({
      type: "ai.complete",
      metadata: {
        messages: [{ role: "user", content: "hi" }],
        model: "explicit-model",
      },
    });
    expect(requestedModel(fetchMock)).toBe("explicit-model");
  });

  it("degrades to not-configured after the config is deleted", async () => {
    let current: AIProviderConfig | null = { ...FULL_CONFIG };
    const controller = await startPaired({
      aiConfigReader: async () => (current === null ? null : { ...current }),
    });
    await controller.handleEnvelope({ type: "ai.status", metadata: {} });

    current = null;

    const status = responseMetadata(
      await controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    );
    expect(status).toEqual({ configured: false });

    const response = await controller.handleEnvelope({
      type: "ai.complete",
      metadata: {
        messages: [{ role: "user", content: "hi" }],
        model: "",
      },
    });
    expect(response.type).toBe("ai.error");
    expect(responseMetadata(response).code).toBe("ai.not-configured");
  });

  it("treats a reader failure as unconfigured without throwing", async () => {
    const controller = await startPaired({
      aiConfigReader: async () => {
        throw new Error("EACCES");
      },
    });
    const status = responseMetadata(
      await controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    );
    expect(status).toEqual({ configured: false });
  });
});

describe("host drops an unknown envelope frame and keeps serving (AC-005, A1)", () => {
  it("returns no frame for an unknown type and answers the next envelope", async () => {
    const host = createNativeHost({
      aiConfigReader: async () => ({ ...FULL_CONFIG }),
    });

    // Length-prefixed JSON frame, as the native wire carries them.
    const encode = (json: string): Uint8Array => {
      const bytes = new TextEncoder().encode(json);
      const frame = new Uint8Array(4 + bytes.byteLength);
      new DataView(frame.buffer).setUint32(0, bytes.byteLength, true);
      frame.set(bytes, 4);
      return frame;
    };

    // Hand-rolled unknown type: serializeEnvelope refuses unknown types exactly
    // like an older host's parser refuses `ai.status`, so this is the wire the
    // old host sees.
    await expect(
      host.processFrame(
        encode(
          JSON.stringify({
            protocol: "v1",
            type: "ai.unknown",
            requestId: "u1",
            timestamp: Date.now(),
            metadata: {},
          }),
        ),
      ),
    ).resolves.toBeNull();

    // Later traffic is unaffected: a normal envelope still gets an answer.
    const response = await host.processFrame(
      encode(
        serializeEnvelope({
          type: "runtime.project.set",
          requestId: "p1",
          metadata: { project: { version: 2, name: "x", groups: [] } },
        }),
      ),
    );
    expect(response).not.toBeNull();
    const length = new DataView(
      (response as Uint8Array).buffer,
      (response as Uint8Array).byteOffset,
      4,
    ).getUint32(0, true);
    const envelope = parseEnvelope(
      new TextDecoder().decode((response as Uint8Array).slice(4, 4 + length)),
    );
    expect(envelope.type).toBe("runtime.project.set");
    expect(envelope.metadata.ok).toBe(true);
  });
});

describe("no reader: launch config stays in force (regression guard)", () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    fetchMock.mockResolvedValue(createMockCompletionResponse("ok"));
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it("reports the injected launch config from ai.status", async () => {
    const controller = await startPaired({
      aiProviderConfig: { ...FULL_CONFIG },
    });
    const metadata = responseMetadata(
      await controller.handleEnvelope({ type: "ai.status", metadata: {} }),
    );
    expect(metadata).toEqual({
      configured: true,
      providerUrl: FULL_CONFIG.providerUrl,
      model: FULL_CONFIG.model,
    });
  });

  it("uses the injected launch config for completions", async () => {
    const controller = await startPaired({
      aiProviderConfig: { ...FULL_CONFIG },
    });
    await controller.handleEnvelope({
      type: "ai.complete",
      metadata: {
        messages: [{ role: "user", content: "hi" }],
        model: "",
      },
    });
    expect(requestedModel(fetchMock)).toBe(FULL_CONFIG.model);
  });
});
