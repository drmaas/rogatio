import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@rogatio/runtime", async () => {
  const actual =
    await vi.importActual<typeof import("@rogatio/runtime")>(
      "@rogatio/runtime",
    );
  return {
    ...actual,
    createRequestBodyTrustController: () => ({
      install: async () => ({ ok: true, state: "installed" as const }),
      uninstall: async () => ({ ok: true, state: "uninstalled" as const }),
      status: async () => ({
        installed: true,
        trusted: true,
        platform: "linux",
        capabilityReasons: [],
      }),
    }),
    selectTrustPlatformAdapter: () => ({
      platform: "linux",
      defaultManifestDir: () => "/mock/manifest",
      defaultCaInstallPath: () => "/mock/ca",
      detect: () => ({ manifest: true, caTrust: true, reasons: [] }),
      caTrustInstaller: async () => {},
      caTrustRemover: async () => {},
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
  it("requires explicit extension ID for install", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
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
    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
    // Should not fail with extension-id error (may fail on missing trust/manifest)
    expect(code).not.toBe(2);
  });
});
