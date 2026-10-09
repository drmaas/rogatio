import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustError } from "../../src/trust.js";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

describe("darwin CA installer/remover", () => {
  beforeEach(() => {
    vi.stubEnv("HOME", "/Users/test");
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caTrustInstaller calls security add-trusted-cert with correct args", async () => {
    const _adapter = selectTrustPlatformAdapter("darwin");
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: vi.fn((_event, cb) => {
        if (_event === "close") cb(0);
      }),
    });

    await _adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    expect(mockSpawn).toHaveBeenCalled();
    const call = mockSpawn.mock.calls[0];
    expect(call[0]).toBe("security");
    expect(call[1]).toContain("add-trusted-cert");
    expect(call[1]).toContain("-d");
    expect(call[1]).toContain("-r");
    expect(call[1]).toContain("trustRoot");
    expect(call[1]).toContain("-k");
    expect(call[1]).toContain(
      "/Users/test/Library/Keychains/login.keychain-db",
    );
  });

  it("caTrustInstaller throws on non-zero exit", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(
      adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      ),
    ).rejects.toThrow(TrustError);
  });

  it("caTrustRemover calls security delete-certificate with correct args", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(0);
      },
    });

    const adapter = selectTrustPlatformAdapter("darwin");
    await adapter.caTrustRemover();

    expect(mockSpawn).toHaveBeenCalled();
    const call = mockSpawn.mock.calls[0];
    expect(call[0]).toBe("security");
    expect(call[1]).toContain("delete-certificate");
    expect(call[1]).toContain("-c");
    expect(call[1]).toContain("CN=Rogatio Request-Body CA");
    expect(call[1]).toContain(
      "/Users/test/Library/Keychains/login.keychain-db",
    );
  });

  it("caTrustRemover ignores not-found errors", async () => {
    mockSpawn.mockReturnValue({
      stderr: {
        on: vi.fn((_event: string, cb: (msg: string) => void) =>
          cb("certificate not found"),
        ),
      },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(adapter.caTrustRemover()).resolves.not.toThrow();
  });

  it("caTrustInstaller error message hygiene - no stderr/cert paths", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("darwin");
    try {
      await adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      );
    } catch (e) {
      if (e instanceof TrustError) {
        expect(e.message).not.toContain("security:");
        expect(e.message).not.toContain("/tmp/");
        expect(e.message).not.toContain("rogatio-ca-");
        expect(e.message).not.toContain("stderr");
      }
    }
  });

  it("idempotent: second install call succeeds", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(0);
      },
    });

    const adapter = selectTrustPlatformAdapter("darwin");
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    // Both calls should complete without throwing
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("caTrustAnchorRemover clears the admin trust setting and deletes by SHA-1", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const previousPem =
      "-----BEGIN CERTIFICATE-----\nMIIPREVIOUS\n-----END CERTIFICATE-----\n";
    const seen: {
      path?: string;
      pem?: string;
      mode?: number;
      dirMode?: number;
    } = {};
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "remove-trusted-cert") {
        const certPath = args[2] ?? "";
        seen.path = certPath;
        seen.pem = fs.readFileSync(certPath, "utf8");
        seen.mode = fs.statSync(certPath).mode & 0o777;
        seen.dirMode = fs.statSync(dirname(certPath)).mode & 0o777;
      }
      return {
        stderr: { on: vi.fn() },
        on: (event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        },
      };
    });
    const fingerprint = "ab".repeat(20);
    const adapter = selectTrustPlatformAdapter("darwin");
    await adapter.caTrustAnchorRemover(fingerprint, previousPem);

    expect(seen.pem).toBe(previousPem);
    expect(seen.mode).toBe(0o600);
    expect(seen.dirMode).toBe(0o700);
    expect(seen.path).toContain("rogatio-ca-");
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[0]?.[0]).toBe("security");
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual([
      "remove-trusted-cert",
      "-d",
      seen.path,
    ]);
    expect(mockSpawn.mock.calls[0]?.[2]).toBeUndefined();
    expect(mockSpawn.mock.calls[1]?.[1]).toEqual([
      "delete-certificate",
      "-Z",
      fingerprint,
      "/Users/test/Library/Keychains/login.keychain-db",
    ]);
    for (const call of mockSpawn.mock.calls) {
      expect(call[1]).not.toContain("sh");
      expect(call[1]).not.toContain("-c");
    }
    expect(fs.existsSync(dirname(seen.path ?? ""))).toBe(false);
  });

  it("caTrustAnchorRemover still deletes the keychain item when trust removal fails", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    let certPath = "";
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      const fail = args[0] === "remove-trusted-cert";
      if (fail) certPath = args[2] ?? "";
      return {
        stderr: {
          on: (_event: string, cb: (chunk: Buffer) => void) => {
            if (fail) cb(Buffer.from("permission denied"));
          },
        },
        on: (event: string, cb: (code: number) => void) => {
          if (event === "close") cb(fail ? 1 : 0);
        },
      };
    });
    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(
      adapter.caTrustAnchorRemover(
        "ab".repeat(20),
        "-----BEGIN CERTIFICATE-----\nMIIPREVIOUS\n-----END CERTIFICATE-----\n",
      ),
    ).rejects.toThrow(TrustError);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[1]?.[1]?.[0]).toBe("delete-certificate");
    expect(fs.existsSync(dirname(certPath))).toBe(false);
  });

  it("caTrustAnchorRemover rejects a fingerprint that is not SHA-1 hex", async () => {
    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(
      adapter.caTrustAnchorRemover(
        "EOF",
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      ),
    ).rejects.toThrow(TrustError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("caTrustAnchorRemover rejects an empty certificate before spawning", async () => {
    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(
      adapter.caTrustAnchorRemover("ab".repeat(20), ""),
    ).rejects.toThrow(TrustError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
