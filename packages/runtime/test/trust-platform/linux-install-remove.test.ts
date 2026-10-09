import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TrustError } from "../../src/trust.js";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";
import {
  createCertificate,
  generateCaKeyPair,
  signCertificate,
} from "../../src/x509.js";

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

const CERT_PATH = "/usr/local/share/ca-certificates/rogatio-ca.crt";

function createChild(code: number, stderrText = "") {
  return {
    stdin: { end: vi.fn(), on: vi.fn() },
    stderr: {
      on: (event: string, cb: (data: string) => void) => {
        if (event === "data" && stderrText) cb(stderrText);
      },
    },
    on: (event: string, cb: (value: number) => void) => {
      if (event === "close") cb(code);
    },
  };
}

function expectNoShell(): void {
  for (const call of mockSpawn.mock.calls) {
    expect(call[0]).not.toBe("sh");
    const args = call[1] as readonly string[];
    expect(args).not.toContain("sh");
    expect(args).not.toContain("-c");
    expect(args.join(" ")).not.toContain("BEGIN CERTIFICATE");
  }
}

describe("linux CA installer/remover", () => {
  let caPem = "";
  let caKeyPem = "";

  beforeAll(async () => {
    const created = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair().privateKey,
      3650,
    );
    caPem = created.certPem;
    caKeyPem = created.keyPem;
  });

  beforeEach(() => {
    vi.stubEnv("HOME", "/home/test");
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
    mockSpawn.mockImplementation(() => createChild(0));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes the cert with sudo tee on stdin and never spawns a shell", async () => {
    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(caPem);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[0]).toEqual([
      "sudo",
      ["tee", CERT_PATH],
      { stdio: ["pipe", "ignore", "pipe"] },
    ]);
    const writer = mockSpawn.mock.results[0]?.value as ReturnType<
      typeof createChild
    >;
    expect(writer.stdin.end).toHaveBeenCalledWith(caPem);
    expect(mockSpawn.mock.calls[1]).toEqual([
      "sudo",
      ["update-ca-certificates"],
      { stdio: ["ignore", "ignore", "pipe"] },
    ]);
    expectNoShell();
  });

  it("rejects a PEM containing an EOF line before spawning", async () => {
    const lines = caPem.split("\n");
    const malicious = [lines[0], "EOF", ...lines.slice(1)].join("\n");
    const adapter = selectTrustPlatformAdapter("linux");

    await expect(adapter.caTrustInstaller(malicious)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TrustError);
        const trustError = error as TrustError;
        expect(trustError.reasons).toContain("invalid-ca-certificate");
        expect(trustError.message).not.toContain("EOF");
        expect(trustError.message).not.toContain("BEGIN CERTIFICATE");
        return true;
      },
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects a non-CA certificate before spawning", async () => {
    const leaf = await signCertificate("leaf.example", caPem, caKeyPem, 30);
    const adapter = selectTrustPlatformAdapter("linux");

    await expect(adapter.caTrustInstaller(leaf)).rejects.toBeInstanceOf(
      TrustError,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects more than one certificate before spawning", async () => {
    const adapter = selectTrustPlatformAdapter("linux");
    await expect(
      adapter.caTrustInstaller(`${caPem}\n${caPem}`),
    ).rejects.toBeInstanceOf(TrustError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("caTrustInstaller throws on non-zero exit", async () => {
    mockSpawn.mockImplementation(() => createChild(1));

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustInstaller(caPem)).rejects.toThrow(TrustError);
    expectNoShell();
  });

  it("caTrustInstaller throws elevation-required on permission denied", async () => {
    mockSpawn.mockImplementation(() =>
      createChild(1, "sudo: a terminal is required\n"),
    );

    const adapter = selectTrustPlatformAdapter("linux");
    try {
      await adapter.caTrustInstaller(caPem);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TrustError);
      expect((e as TrustError).reasons).toContain("elevation-required");
    }
  });

  it("caTrustRemover removes cert without calling update-ca-certificates", async () => {
    mockSpawn.mockClear();

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustRemover();

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("caTrustRemover ignores non-zero exit (idempotent)", async () => {
    mockSpawn.mockImplementation(() => createChild(1));

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).resolves.not.toThrow();
  });

  it("caTrustInstaller error message hygiene - no stderr/cert paths", async () => {
    mockSpawn.mockImplementation(() => createChild(1));

    const adapter = selectTrustPlatformAdapter("linux");
    try {
      await adapter.caTrustInstaller(caPem);
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
    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(caPem);
    await adapter.caTrustInstaller(caPem);

    expect(mockSpawn).toHaveBeenCalledTimes(4);
    expectNoShell();
  });

  it("caTrustAnchorRemover does not spawn; the bundle rebuild replaces the file", async () => {
    const adapter = selectTrustPlatformAdapter("linux");
    await expect(
      adapter.caTrustAnchorRemover(
        "ab".repeat(20),
        "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      ),
    ).resolves.toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
