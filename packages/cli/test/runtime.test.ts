import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function httpJson(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text() };
}

describe("rogatio runtime command (F13)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-runtime-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("starts the mock runtime, serves a mock, prints connection info, and stops cleanly", async () => {
    const projectPath = join(testDir, ".rogatio.json");
    await writeProject(projectPath, mockProject());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const { exitCode, shutdown } = await runtimeCommand([
      projectPath,
      "--port",
      "0",
    ]);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    const portMatch = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    expect(portMatch).not.toBeNull();
    const port = Number(portMatch?.[1]);
    expect(output).toContain("mock");

    const connection = await httpJson(port, "/v1/connection");
    expect(connection.status).toBe(200);
    const info = JSON.parse(connection.body) as {
      protocol: string;
      mocks: Array<{ ruleId: string; token: string }>;
    };
    expect(info.protocol).toBe("f13-v1");
    const token = info.mocks[0]?.token;
    expect(token).toBeDefined();

    const served = await httpJson(port, `/mock/${token}`);
    expect(served.status).toBe(200);
    expect(served.body).toBe("hello");

    shutdown();
    const code = await exitCode;
    expect(code).toBe(0);
    log.mockRestore();
  });

  it("exits 1 for an invalid project with diagnostics-style output", async () => {
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
                mock: { status: 200, body: "x", file: "a.txt" },
              },
            ],
          },
        ],
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { exitCode, shutdown } = await runtimeCommand([projectPath]);
    const code = await exitCode;
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("mock"));
    shutdown();
    error.mockRestore();
  });

  it("exits 2 when the fixed port is already occupied", async () => {
    const projectPath = join(testDir, ".rogatio.json");
    await writeProject(projectPath, mockProject());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await runtimeCommand([projectPath, "--port", "0"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    const port = Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1]);

    const second = await runtimeCommand([projectPath, "--port", String(port)]);
    const secondCode = await second.exitCode;
    expect(secondCode).toBe(2);
    expect(error).toHaveBeenCalled();

    first.shutdown();
    const firstCode = await first.exitCode;
    expect(firstCode).toBe(0);
    log.mockRestore();
    error.mockRestore();
  });

  it("rejects a file mock resolved outside the configured root", async () => {
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

    const { exitCode, shutdown } = await runtimeCommand([
      projectPath,
      "--root",
      testDir,
    ]);
    const code = await exitCode;
    expect(code).toBe(1);
    shutdown();
    error.mockRestore();
  });
});
