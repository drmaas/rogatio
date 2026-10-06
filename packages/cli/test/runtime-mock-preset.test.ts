import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@rogatio/runtime", async () => {
  const actual =
    await vi.importActual<typeof import("@rogatio/runtime")>(
      "@rogatio/runtime",
    );
  return {
    ...actual,
    runNativeHost: vi.fn(async () => undefined),
  };
});

import { runNativeHost } from "@rogatio/runtime";
import { runtimeCommand } from "../src/commands/runtime.js";

const directories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("runtime host preset mocks", () => {
  it("puts compiled mock rules on the preset and defaults the root to the project directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-cli-mock-"));
    directories.push(directory);
    const projectPath = join(directory, "project.rogatio.json");
    await writeFile(
      projectPath,
      JSON.stringify({
        version: 2,
        name: "mocks",
        groups: [
          {
            id: "g1",
            name: "G",
            rules: [
              {
                id: "r1",
                name: "Mock",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
                type: "mock",
                mock: { status: 200, body: "hello", file: undefined },
              },
            ],
          },
        ],
      }),
    );

    const code = await runtimeCommand(["host", projectPath]);
    expect(code).toBe(0);
    expect(runNativeHost).toHaveBeenCalledOnce();
    const options = vi.mocked(runNativeHost).mock.calls[0]?.[0];
    expect(options?.fileRoot).toBe(dirname(projectPath));
    expect(options?.preset?.mocks).toEqual([
      expect.objectContaining({ ruleId: "r1", status: 200, body: "hello" }),
    ]);
  });

  it("requires --root for a stdin project that contains a file mock", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const project = JSON.stringify({
      version: 2,
      name: "mocks",
      groups: [
        {
          id: "g1",
          name: "G",
          rules: [
            {
              id: "r1",
              name: "Mock",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 1,
              type: "mock",
              mock: { status: 200, file: "payload.bin" },
            },
          ],
        },
      ],
    });

    const missing = await runtimeCommand(["host", "-"], {
      stdinInput: project,
    });
    expect(missing).toBe(2);
    expect(error.mock.calls.join("\n")).toContain("runtime.root-required");
    expect(runNativeHost).not.toHaveBeenCalled();

    const directory = await mkdtemp(join(tmpdir(), "rogatio-cli-root-"));
    directories.push(directory);
    const present = await runtimeCommand(["host", "--root", directory, "-"], {
      stdinInput: project,
    });
    expect(present).toBe(0);
    expect(vi.mocked(runNativeHost).mock.calls.at(-1)?.[0].fileRoot).toBe(
      directory,
    );
    error.mockRestore();
  });

  it("starts a stdin inline mock without a root", async () => {
    const code = await runtimeCommand(["host", "-"], {
      stdinInput: JSON.stringify({
        version: 2,
        name: "mocks",
        groups: [
          {
            id: "g1",
            name: "G",
            rules: [
              {
                id: "r1",
                name: "Mock",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
                type: "mock",
                mock: { status: 200, body: "hello" },
              },
            ],
          },
        ],
      }),
    });
    expect(code).toBe(0);
    expect(
      vi.mocked(runNativeHost).mock.calls.at(-1)?.[0].fileRoot,
    ).toBeUndefined();
  });

  it("uses a saved device-local root instead of the project directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-cli-saved-root-"));
    directories.push(directory);
    const projectPath = join(directory, "project.rogatio.json");
    await writeFile(
      projectPath,
      JSON.stringify({
        version: 2,
        name: "mocks",
        groups: [
          {
            id: "g1",
            name: "G",
            rules: [
              {
                id: "r1",
                name: "Mock",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
                type: "mock",
                mock: { status: 200, body: "hello" },
              },
            ],
          },
        ],
      }),
    );
    const previous = process.env.ROGATIO_CONFIG_DIR;
    process.env.ROGATIO_CONFIG_DIR = join(directory, "config");
    try {
      const { writeSavedMockRoot } = await import("../src/mock-root-config.js");
      const saved = join(directory, "mocks");
      await writeSavedMockRoot(projectPath, saved);
      const code = await runtimeCommand(["host", projectPath]);
      expect(code).toBe(0);
      expect(vi.mocked(runNativeHost).mock.calls.at(-1)?.[0].fileRoot).toBe(
        saved,
      );
    } finally {
      if (previous === undefined) delete process.env.ROGATIO_CONFIG_DIR;
      else process.env.ROGATIO_CONFIG_DIR = previous;
    }
  });
});
