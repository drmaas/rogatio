import { join } from "node:path";
import { defaultTrustInstallRoot } from "@rogatio/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsBehavior = vi.hoisted(() => ({
  writeFileError: null as Error | null,
  chmodError: null as Error | null,
}));

const rmMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    mkdir: async () => undefined,
    writeFile: async (..._args: Parameters<typeof actual.writeFile>) => {
      if (fsBehavior.writeFileError) throw fsBehavior.writeFileError;
      return undefined;
    },
    chmod: async (..._args: Parameters<typeof actual.chmod>) => {
      if (fsBehavior.chmodError) throw fsBehavior.chmodError;
      return undefined;
    },
    rm: rmMock,
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

import { runtimeCommand } from "../src/commands/runtime.js";

afterEach(() => {
  fsBehavior.writeFileError = null;
  fsBehavior.chmodError = null;
  rmMock.mockClear();
  vi.restoreAllMocks();
});

describe("rogatio runtime install (host wrapper failures)", () => {
  it("exits 1 when writeFile rejects after trust install succeeds", async () => {
    const writeError = Object.assign(new Error("disk full"), {
      code: "ENOSPC",
    });
    fsBehavior.writeFileError = writeError;

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);

    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    const stderr = err.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(stderr).toContain("disk full (ENOSPC)");
    expect(stderr).toContain("runtime-host wrapper was not created");
    expect(stderr).toContain("rogatio runtime install");
    expect(stderr).toContain("rogatio runtime verify");
    expect(stderr).not.toContain("wrapper created");
  });

  it("exits 1 and removes a partial wrapper when chmod rejects", async () => {
    const chmodError = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });
    fsBehavior.chmodError = chmodError;

    const installRoot = defaultTrustInstallRoot(process.platform);
    const hostPath = join(installRoot, "runtime-host");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);

    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    const stderr = err.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(stderr).toContain("operation not permitted (EPERM)");
    expect(stderr).toContain("runtime-host wrapper was not created");
    expect(stderr).toContain("rogatio runtime install");
    expect(stderr).toContain("rogatio runtime verify");
    expect(stderr).not.toContain("wrapper created");
    expect(rmMock).toHaveBeenCalledWith(hostPath, { force: true });
  });
});
