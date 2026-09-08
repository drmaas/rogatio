import { describe, expect, it, vi } from "vitest";

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
  };
});

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

describe("rogatio runtime install (unified success)", () => {
  it("prints the unified install success message when install succeeds", async () => {
    const { runtimeCommand } = await import("../src/commands/runtime.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
    expect(code).toBe(0);
    expect(log.mock.calls.join("\n")).toContain(
      "runtime install complete: manifest + device-local CA trusted",
    );
    expect(err).not.toHaveBeenCalled();
  });
});
