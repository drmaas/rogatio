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
});
