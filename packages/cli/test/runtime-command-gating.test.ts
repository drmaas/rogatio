import { RELEASE_EXTENSION_ID } from "@rogatio/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  extensionIds: [] as string[],
}));

// Never touch the real install root (~/.local/share/rogatio): the CLI writes
// the runtime-host wrapper outside the mocked trust controller.
vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    chmod: async () => undefined,
    rm: async () => undefined,
  };
});

vi.mock("@rogatio/runtime", async () => {
  const actual =
    await vi.importActual<typeof import("@rogatio/runtime")>(
      "@rogatio/runtime",
    );
  return {
    ...actual,
    createInstalledTrustController: () => ({
      install: async (extensionId: string) => {
        recorded.extensionIds.push(extensionId);
        return { ok: true, state: "installed" as const };
      },
      uninstall: async () => ({ ok: true, state: "uninstalled" as const }),
      status: async () => ({
        installed: true,
        trusted: true,
        platform: "linux",
        capabilityReasons: [],
      }),
    }),
  };
});

import { runtimeCommand } from "../src/commands/runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function silence(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("rogatio runtime command ()", () => {
  it("defaults install to the pinned release extension ID", async () => {
    silence();
    recorded.extensionIds.length = 0;
    const code = await runtimeCommand(["install"]);
    expect(code).toBe(0);
    expect(recorded.extensionIds).toEqual([RELEASE_EXTENSION_ID]);
  });

  it("rejects invalid extension ID format", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install", "--extension-id", "invalid"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
  });

  it("rejects wildcard extension ID", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install", "--extension-id", "*"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
  });

  it("accepts valid 32-character lowercase a-p extension ID", async () => {
    silence();
    recorded.extensionIds.length = 0;
    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
    expect(code).toBe(0);
    expect(recorded.extensionIds).toEqual(["abcdefghijklmnopabcdefghijklmnop"]);
  });
});
