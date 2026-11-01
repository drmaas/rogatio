import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const installRootOverride = vi.hoisted(() => ({
  value: null as string | null,
}));

const fsBehavior = vi.hoisted(() => ({
  openError: null as Error | null,
  writeFileError: null as Error | null,
  chmodError: null as Error | null,
  renameError: null as Error | null,
  rmError: null as Error | null,
}));

const rmMock = vi.hoisted(() =>
  vi.fn(
    async (..._args: Parameters<typeof import("node:fs/promises").rm>) =>
      undefined,
  ),
);
const uninstallMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, state: "uninstalled" as const })),
);

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (fsBehavior.openError) throw fsBehavior.openError;
      const handle = await actual.open(...args);
      const originalWriteFile = handle.writeFile.bind(handle);
      const originalChmod = handle.chmod.bind(handle);
      handle.writeFile = async (...writeArgs) => {
        if (fsBehavior.writeFileError) throw fsBehavior.writeFileError;
        return originalWriteFile(...writeArgs);
      };
      handle.chmod = async (...chmodArgs) => {
        if (fsBehavior.chmodError) throw fsBehavior.chmodError;
        return originalChmod(...chmodArgs);
      };
      return handle;
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fsBehavior.renameError) throw fsBehavior.renameError;
      return actual.rename(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (fsBehavior.rmError) throw fsBehavior.rmError;
      rmMock(...args);
      return actual.rm(...args);
    },
  };
});

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
      uninstall: uninstallMock,
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

afterEach(async () => {
  fsBehavior.openError = null;
  fsBehavior.writeFileError = null;
  fsBehavior.chmodError = null;
  fsBehavior.renameError = null;
  fsBehavior.rmError = null;
  if (installRootOverride.value) {
    await rm(installRootOverride.value, { recursive: true, force: true });
    installRootOverride.value = null;
  }
  rmMock.mockClear();
  uninstallMock.mockClear();
  vi.restoreAllMocks();
});

describe("rogatio runtime install (host wrapper failures)", () => {
  it("exits 1 when exclusive temp open rejects after trust install succeeds", async () => {
    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-fail-"),
    );
    const openError = Object.assign(new Error("disk full"), {
      code: "ENOSPC",
    });
    fsBehavior.openError = openError;

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
    expect(stderr).toContain("rolled back");
    expect(stderr).toContain("rogatio runtime install");
    expect(stderr).toContain("rogatio runtime verify");
    expect(stderr).not.toContain("wrapper created");
    expect(uninstallMock).toHaveBeenCalledTimes(1);
  });

  it("exits 1, rolls back trust, and removes only the temp wrapper when chmod rejects", async () => {
    const chmodError = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });
    fsBehavior.chmodError = chmodError;

    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-fail-"),
    );
    const hostPath = join(installRootOverride.value, "runtime-host");
    await writeFile(hostPath, "#!/bin/sh\nprior wrapper\n", "utf8");
    await chmod(hostPath, 0o755);

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
    expect(uninstallMock).toHaveBeenCalledTimes(1);
    expect(await readFile(hostPath, "utf8")).toBe("#!/bin/sh\nprior wrapper\n");
    const removedPaths = rmMock.mock.calls.map((call) => String(call[0]));
    expect(removedPaths.some((path) => path.endsWith(".tmp"))).toBe(true);
    expect(removedPaths).not.toContain(hostPath);
  });

  it("preserves a prior wrapper when temp write fails before rename", async () => {
    const writeError = Object.assign(new Error("no space left"), {
      code: "ENOSPC",
    });
    fsBehavior.writeFileError = writeError;

    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-fail-"),
    );
    const hostPath = join(installRootOverride.value, "runtime-host");
    await writeFile(hostPath, "#!/bin/sh\nprior wrapper\n", "utf8");
    await chmod(hostPath, 0o755);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);

    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(await readFile(hostPath, "utf8")).toBe("#!/bin/sh\nprior wrapper\n");
    expect(uninstallMock).toHaveBeenCalledTimes(1);
  });

  it("still exits 1 when temp cleanup fails after wrapper write failure", async () => {
    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-fail-"),
    );
    fsBehavior.chmodError = Object.assign(
      new Error("operation not permitted"),
      {
        code: "EPERM",
      },
    );
    fsBehavior.rmError = Object.assign(new Error("cleanup failed"), {
      code: "EIO",
    });

    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);

    expect(code).toBe(1);
    const stderr = err.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(stderr).toContain("operation not permitted (EPERM)");
    expect(stderr).toContain("runtime-host wrapper was not created");
    expect(uninstallMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back trust when rename fails after a clean wrapper write", async () => {
    installRootOverride.value = await mkdtemp(
      join(tmpdir(), "rogatio-wrapper-fail-"),
    );
    fsBehavior.renameError = Object.assign(new Error("rename failed"), {
      code: "EXDEV",
    });

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
    expect(stderr).toContain("rename failed (EXDEV)");
    expect(stderr).toContain("rolled back");
    expect(uninstallMock).toHaveBeenCalledTimes(1);
  });
});
