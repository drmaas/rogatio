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
});
