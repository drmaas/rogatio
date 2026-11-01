import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const installRootOverride = vi.hoisted(() => ({
  value: null as string | null,
}));

vi.mock("@rogatio/runtime", async () => {
  const actual =
    await vi.importActual<typeof import("@rogatio/runtime")>(
      "@rogatio/runtime",
    );
  return {
    ...actual,
    defaultTrustInstallRoot: () =>
      installRootOverride.value ??
      actual.defaultTrustInstallRoot(process.platform),
    createInstalledTrustController: () => ({
      install: async () => ({ ok: true, state: "installed" as const }),
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

afterEach(async () => {
  if (installRootOverride.value) {
    await rm(installRootOverride.value, { recursive: true, force: true });
    installRootOverride.value = null;
  }
  vi.restoreAllMocks();
});

describe("rogatio runtime install (unified success)", () => {
  it("prints the unified install success message when install succeeds", async () => {
    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-success-"),
    );
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
