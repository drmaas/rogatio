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
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

describe("win32 CA installer/remover", () => {
  beforeEach(() => {
    vi.stubEnv("APPDATA", "/home/test/AppData/Roaming");
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caTrustInstaller calls certutil -addstore -f Root with correct args", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(0);
      },
    });

    const adapter = selectTrustPlatformAdapter("win32");
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    expect(mockSpawn).toHaveBeenCalled();
    const call = mockSpawn.mock.calls[0];
    expect(call[0]).toBe("certutil");
    expect(call[1]).toContain("-addstore");
    expect(call[1]).toContain("-f");
    expect(call[1]).toContain("Root");
  });

  it("caTrustInstaller throws on non-zero exit", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("win32");
    await expect(
      adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      ),
    ).rejects.toThrow(TrustError);
  });

  it("caTrustRemover calls certutil -delstore Root with correct args", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(0);
      },
    });

    const adapter = selectTrustPlatformAdapter("win32");
    await adapter.caTrustRemover();

    expect(mockSpawn).toHaveBeenCalled();
    const call = mockSpawn.mock.calls[0];
    expect(call[0]).toBe("certutil");
    expect(call[1]).toContain("-delstore");
    expect(call[1]).toContain("Root");
    expect(call[1]).toContain("CN=Rogatio Request-Body CA");
  });

  it("caTrustRemover ignores not-found errors", async () => {
    mockSpawn.mockReturnValue({
      stderr: {
        on: vi.fn((_event: string, cb: (msg: string) => void) =>
          cb("cannot find certificate"),
        ),
      },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("win32");
    await expect(adapter.caTrustRemover()).resolves.not.toThrow();
  });

  it("caTrustInstaller error message hygiene - no stderr/cert paths", async () => {
    mockSpawn.mockReturnValue({
      stderr: { on: vi.fn() },
      on: (_event: string, cb: (code: number) => void) => {
        if (_event === "close") cb(1);
      },
    });

    const adapter = selectTrustPlatformAdapter("win32");
    try {
      await adapter.caTrustInstaller(
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      );
    } catch (e) {
      if (e instanceof TrustError) {
        expect(e.message).not.toContain("certutil:");
        expect(e.message).not.toContain("\\tmp\\");
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

    const adapter = selectTrustPlatformAdapter("win32");
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );
    await adapter.caTrustInstaller(
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
    );

    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
