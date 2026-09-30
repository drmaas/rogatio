import { RELEASE_EXTENSION_ID } from "@rogatio/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  verifyExtensionSeen: false,
}));

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
    createRequestBodyTrustController: () => ({
      install: async () => ({ ok: true, state: "installed" as const }),
      uninstall: async () => ({ ok: true, state: "uninstalled" as const }),
      status: async () => ({
        installed: true,
        trusted: true,
        platform: "linux",
        capabilityReasons: [],
      }),
      verify: async () => {
        recorded.verifyExtensionSeen = true;
        return {
          ok: true,
          manifestExists: true,
          manifestValid: true,
          binaryExists: true,
          binaryExecutable: true,
          caTrusted: true,
          allowedOriginsCount: 1,
          allowedOrigins: [
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
          ],
          reasons: [],
        };
      },
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

describe("rogatio runtime verify extension ID", () => {
  it("fails when allowed_origins omits the release ID and prints the re-pin command", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runtimeCommand(["verify"]);
    expect(code).toBe(1);
    expect(recorded.verifyExtensionSeen).toBe(true);
    const text = err.mock.calls.join("\n");
    expect(text).toContain(
      `Extension ID ${RELEASE_EXTENSION_ID} is not in the host manifest allowed_origins.`,
    );
    expect(text).toContain(
      "The host manifest allows: chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.",
    );
    expect(text).toContain(
      "Access to the specified native messaging host is forbidden",
    );
    expect(text).toContain("Run: rogatio runtime install");
    expect(text).not.toContain("--extension-id");
    expect(log).not.toHaveBeenCalled();
  });

  it("names the explicit dev ID in the re-pin command", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const devId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const code = await runtimeCommand(["verify", "--extension-id", devId]);
    expect(code).toBe(1);
    expect(err.mock.calls.join("\n")).toContain(
      `Run: rogatio runtime install --extension-id ${devId}`,
    );
  });
});
