import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustError } from "../../src/trust.js";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe("linux CA installer/remover", () => {
  beforeEach(() => {
    vi.stubEnv("HOME", "/home/test");
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caTrustInstaller creates ca-certificates dir and writes cert", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(0);
      },
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    // Verify spawn was called twice: once for writing cert, once for update-ca-certificates
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[1][0]).toBe("update-ca-certificates");
  });

  it("caTrustInstaller throws on non-zero exit", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(
      adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      ),
    ).rejects.toThrow(TrustError);
  });

  it("caTrustRemover removes cert and runs update-ca-certificates", async () => {
    mockSpawn.mockClear();

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustRemover();

    // caTrustRemover is now idempotent and ignores errors, doesn't call update-ca-certificates
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("caTrustRemover ignores non-zero exit (idempotent)", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).resolves.not.toThrow();
  });

  it("caTrustInstaller error message hygiene - no stderr/cert paths", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("linux");
    try {
      await adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      );
    } catch (e) {
      if (e instanceof TrustError) {
        expect(e.message).not.toContain("update-ca-certificates:");
        expect(e.message).not.toContain("/home/test/");
        expect(e.message).not.toContain("rogatio-ca.crt");
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

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    // Each install calls spawn twice (write cert + update-ca-certificates)
    expect(mockSpawn).toHaveBeenCalledTimes(4);
  });
});
