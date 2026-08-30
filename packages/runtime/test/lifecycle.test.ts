import { describe, expect, it } from "vitest";
import { RUNTIME_LIMITS } from "../src/index.js";
import { createNativeRuntimeController } from "../src/lifecycle.js";
import type {
  NormalizedRuntimePreset,
  PresetDigest,
  RuntimeMockConfig,
} from "../src/types.js";

function buildPreset(mocks: RuntimeMockConfig[] = []): NormalizedRuntimePreset {
  return {
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: [],
    grants: [],
    canonicalBytes: new Uint8Array([1, 2, 3]),
    digest:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as PresetDigest,
    ...(mocks.length > 0 ? { mocks } : {}),
  };
}

function decodeMockBody(mockBody: string): string {
  return Buffer.from(mockBody, "base64").toString("utf8");
}

describe("createNativeRuntimeController", () => {
  it("does not auto-start; begins idle", () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    expect(controller.status().state).toBe("idle");
  });

  it("starts unconditionally without a capability detector (spec REQ-004)", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    const started = await controller.start();
    expect(started.state).toBe("running");
    expect(started.activation?.state).toBe("running");
  });

  it("stop is idempotent", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    await controller.start();
    await controller.stop();
    const again = await controller.stop();
    expect(again.state).toBe("stopped");
  });

  it("ignores repeated start while already running", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    await controller.start();
    const second = await controller.start();
    expect(second.state).toBe("running");
  });

  it("rejects envelopes before start", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    await expect(
      controller.handleEnvelope({ type: "mock.connect", metadata: {} }),
    ).rejects.toThrow();
  });
});

describe("mock delivery over the envelope", () => {
  const mocks: RuntimeMockConfig[] = [
    {
      ruleId: "m1",
      status: 200,
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{"ok":true}',
    },
  ];

  it("mock.connect returns per-rule tokens for a matching preset digest", async () => {
    const controller = createNativeRuntimeController({
      preset: buildPreset(mocks),
    });
    await controller.start();
    const connect = await controller.handleEnvelope({
      type: "mock.connect",
      metadata: {
        presetDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    expect(connect.type).toBe("mock.connect");
    const meta = connect.metadata as {
      protocol: string;
      presetDigest: string;
      mocks: readonly { ruleId: string; token: string }[];
    };
    expect(meta.mocks).toHaveLength(1);
    expect(meta.mocks[0]?.ruleId).toBe("m1");
    expect(typeof meta.mocks[0]?.token).toBe("string");
  });

  it("mock.request delivers the rendered body as base64 mockBody", async () => {
    const controller = createNativeRuntimeController({
      preset: buildPreset(mocks),
    });
    await controller.start();
    const connect = await controller.handleEnvelope({
      type: "mock.connect",
      metadata: {
        presetDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    const token = (connect.metadata as { mocks: readonly { token: string }[] })
      .mocks[0]?.token;
    const response = await controller.handleEnvelope({
      type: "mock.request",
      metadata: { token },
    });
    expect(response.type).toBe("mock.response");
    const meta = response.metadata as {
      status: number;
      headers: readonly (readonly [string, string])[];
      mockBody: string;
    };
    expect(meta.status).toBe(200);
    expect(decodeMockBody(meta.mockBody)).toBe('{"ok":true}');
  });

  it("mock.request for an unknown token returns 404", async () => {
    const controller = createNativeRuntimeController({
      preset: buildPreset(mocks),
    });
    await controller.start();
    const response = await controller.handleEnvelope({
      type: "mock.request",
      metadata: { token: "deadbeef" },
    });
    const meta = response.metadata as { status: number };
    expect(meta.status).toBe(404);
  });
});

describe("pairing and authorization envelopes", () => {
  it("pair.request with a non-matching preset digest is denied", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    await controller.start();
    const response = await controller.handleEnvelope({
      type: "pair.request",
      metadata: {
        capability: "x",
        presetDigest: "sha256:wrong",
      },
    });
    expect(response.type).toBe("pair.response");
    const meta = response.metadata as { error?: string };
    expect(meta.error).toBeDefined();
  });

  it("authorize.request with an unknown session is denied", async () => {
    const controller = createNativeRuntimeController({ preset: buildPreset() });
    await controller.start();
    const response = await controller.handleEnvelope({
      type: "authorize.request",
      metadata: {
        sessionCapability: "x",
        presetDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        descriptor: {
          groupId: "g",
          ruleId: "r",
          operationId: "o",
          kind: "outbound-http",
          target: "https://example.com/",
          method: "GET",
        },
      },
    });
    const meta = response.metadata as { authorized: boolean; error?: string };
    expect(meta.authorized).toBe(false);
    expect(meta.error).toBeDefined();
  });
});

const DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

function buildGrantedPreset(): NormalizedRuntimePreset {
  return {
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: [
      {
        kind: "matcher",
        groupId: "g",
        ruleId: "r",
        matcher: {
          urlRegex: { source: ".*", flags: "" },
          origins: ["https://example.com"],
          resourceTypes: ["main_frame"],
          priority: 1,
        },
      },
    ],
    grants: [
      {
        groupId: "g",
        ruleId: "r",
        operationId: "o",
        kind: "outbound-http",
        target: "https://example.com/",
        method: "GET",
      },
    ],
    canonicalBytes: new Uint8Array([1, 2, 3]),
    digest: DIGEST,
  };
}

describe("pairing and authorization success (spec REQ-005)", () => {
  it("exposes a single-use bootstrap capability after start", async () => {
    const controller = createNativeRuntimeController({
      preset: buildGrantedPreset(),
    });
    expect(controller.getBootstrapCapability()).toBeUndefined();
    await controller.start();
    const bootstrap = controller.getBootstrapCapability();
    expect(typeof bootstrap).toBe("string");
    expect(bootstrap?.length).toBeGreaterThan(0);
  });

  it("pair.request with the bootstrap capability yields a session capability", async () => {
    const controller = createNativeRuntimeController({
      preset: buildGrantedPreset(),
    });
    await controller.start();
    const bootstrap = controller.getBootstrapCapability();
    if (!bootstrap) throw new Error("Expected bootstrap capability");
    const response = await controller.handleEnvelope({
      type: "pair.request",
      metadata: { capability: bootstrap, presetDigest: DIGEST },
    });
    expect(response.type).toBe("pair.response");
    const meta = response.metadata as {
      sessionCapability: string;
      expiresInMs: number;
      error?: string;
    };
    expect(meta.error).toBeUndefined();
    expect(meta.sessionCapability.length).toBeGreaterThan(0);
    expect(meta.expiresInMs).toBeGreaterThan(0);
  });

  it("the bootstrap capability is single-use", async () => {
    const controller = createNativeRuntimeController({
      preset: buildGrantedPreset(),
    });
    await controller.start();
    const bootstrap = controller.getBootstrapCapability();
    if (!bootstrap) throw new Error("Expected bootstrap capability");
    await controller.handleEnvelope({
      type: "pair.request",
      metadata: { capability: bootstrap, presetDigest: DIGEST },
    });
    expect(controller.getBootstrapCapability()).toBeUndefined();
    const second = await controller.handleEnvelope({
      type: "pair.request",
      metadata: { capability: bootstrap, presetDigest: DIGEST },
    });
    expect((second.metadata as { error?: string }).error).toBeDefined();
  });

  it("authorize.request succeeds for a granted descriptor after pairing (grant e2e)", async () => {
    const controller = createNativeRuntimeController({
      preset: buildGrantedPreset(),
    });
    await controller.start();
    const bootstrap = controller.getBootstrapCapability();
    if (!bootstrap) throw new Error("Expected bootstrap capability");
    const paired = await controller.handleEnvelope({
      type: "pair.request",
      metadata: { capability: bootstrap, presetDigest: DIGEST },
    });
    const sessionCapability = (paired.metadata as { sessionCapability: string })
      .sessionCapability;
    const response = await controller.handleEnvelope({
      type: "authorize.request",
      metadata: {
        sessionCapability,
        presetDigest: DIGEST,
        descriptor: {
          groupId: "g",
          ruleId: "r",
          operationId: "o",
          kind: "outbound-http",
          target: "https://example.com/",
          method: "GET",
        },
      },
    });
    const meta = response.metadata as {
      authorized: boolean;
      groupId?: string;
      ruleId?: string;
      operationId?: string;
      kind?: string;
      target?: string;
      method?: string;
      error?: string;
    };
    expect(meta.authorized).toBe(true);
    expect(meta.error).toBeUndefined();
    expect(meta.groupId).toBe("g");
    expect(meta.ruleId).toBe("r");
    expect(meta.operationId).toBe("o");
    expect(meta.kind).toBe("outbound-http");
    expect(meta.target).toBe("https://example.com/");
    expect(meta.method).toBe("GET");
  });
});

describe("mock faucet port and serveMock", () => {
  const faucetMocks: RuntimeMockConfig[] = [
    {
      ruleId: "m1",
      status: 201,
      headers: [{ name: "Content-Type", value: "text/plain" }],
      body: "stored",
    },
  ];

  it("mock.connect reports the configured loopback faucet port (REQ-003)", async () => {
    const controller = createNativeRuntimeController({
      preset: buildPreset(faucetMocks),
      mockPort: 9123,
    });
    await controller.start();
    const connect = await controller.handleEnvelope({
      type: "mock.connect",
      metadata: { presetDigest: DIGEST },
    });
    const meta = connect.metadata as { port?: number };
    expect(meta.port).toBe(9123);
  });

  it("serveMock returns runtime.mock-unknown for an unknown token", async () => {
    const controller = createNativeRuntimeController({
      preset: buildPreset(faucetMocks),
      mockPort: 9123,
    });
    await controller.start();
    const result = await controller.serveMock("nope");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("runtime.mock-unknown");
  });
});
