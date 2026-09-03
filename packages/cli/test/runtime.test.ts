import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeHost,
  type NormalizedRuntimePreset,
  type PresetDigest,
  RUNTIME_LIMITS,
} from "@rogatio/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeCommand } from "../src/commands/runtime.js";
import { writeProject } from "../src/utils/file.js";

function mockProject(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    name: "Runtime test",
    groups: [
      {
        id: "group-main",
        name: "Main",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule-mock",
            name: "Mock rule",
            urlRegex: "^https://example\\.com/",
            origins: [],
            resourceTypes: ["main_frame"],
            priority: 100,
            type: "mock",
            mock: { status: 200, body: "hello" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function frame(obj: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

function parseFrame(buffer: Uint8Array): Record<string, unknown> {
  const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(
    0,
    true,
  );
  const json = new TextDecoder("utf-8").decode(buffer.subarray(4, 4 + length));
  return JSON.parse(json) as Record<string, unknown>;
}

function normalizeMockPreset(): NormalizedRuntimePreset {
  return {
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: [],
    grants: [],
    canonicalBytes: new Uint8Array([1, 2, 3]),
    digest:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as PresetDigest,
    mocks: [{ ruleId: "rule-mock", status: 200, body: "hello" }],
  };
}

describe("rogatio runtime command ()", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-runtime-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("rejects starting the runtime via `rogatio runtime <path>`", async () => {
    const projectPath = join(testDir, ".rogatio.json");
    await writeProject(projectPath, mockProject());
    const error = (console as unknown as { error: (m: string) => void }).error;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runtimeCommand([projectPath]);
    expect(code).toBe(2);
    expect(spy.mock.calls.join("\n")).toMatch(
      /no longer starts|unknown runtime subcommand/,
    );
    spy.mockRestore();
    void error;
  });

  it("exits 1 for a schema-invalid project via runtime host", async () => {
    const projectPath = join(testDir, ".rogatio.json");
    await writeFile(projectPath, JSON.stringify({ version: 1, name: "x" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runtimeCommand(["host", projectPath]);
    expect(code).toBe(1);
    error.mockRestore();
  });

  it("rejects a file mock resolved outside the configured root via runtime host", async () => {
    const projectPath = join(testDir, ".rogatio.json");
    await writeProject(
      projectPath,
      mockProject({
        groups: [
          {
            id: "group-main",
            name: "Main",
            origins: ["https://example.com"],
            rules: [
              {
                id: "rule-mock",
                name: "Mock rule",
                urlRegex: "^https://example\\.com/",
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 100,
                type: "mock",
                mock: { status: 200, file: "../outside.txt" },
              },
            ],
          },
        ],
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runtimeCommand(["host", "--root", testDir, projectPath]);
    expect(code).toBe(1);
    error.mockRestore();
  });

  it("serves a mock end-to-end through the native host envelope loop", async () => {
    const preset = normalizeMockPreset();
    const host = createNativeHost({ preset });
    await host.start();

    const connectResp = await host.processFrame(
      frame({
        protocol: "v1",
        type: "mock.connect",
        metadata: { presetDigest: preset.digest },
      }),
    );
    if (!connectResp) throw new Error("Expected connect frame");
    const connectMeta = parseFrame(connectResp).metadata as {
      mocks: Array<{ ruleId: string; token: string }>;
    };
    expect(connectMeta.mocks[0]?.ruleId).toBe("rule-mock");
    const token = connectMeta.mocks[0]?.token;

    const served = await host.processFrame(
      frame({
        protocol: "v1",
        type: "mock.request",
        metadata: { token },
      }),
    );
    await host.stop();

    if (!served) throw new Error("Expected served frame");
    const meta = parseFrame(served).metadata as {
      status: number;
      headers: Array<[string, string]>;
      mockBody: string;
    };
    expect(meta.status).toBe(200);
    const body = Buffer.from(meta.mockBody, "base64").toString("utf8");
    expect(body).toBe("hello");
  });
});
