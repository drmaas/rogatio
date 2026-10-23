import { accessSync } from "node:fs";
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
}));

const CERT_PATH = "/usr/local/share/ca-certificates/rogatio-ca.crt";
const ARCH_ANCHORS = "/etc/ca-certificates/trust-source/anchors";
const FEDORA_ANCHORS = "/etc/pki/ca-trust/source/anchors";

function enoent(): never {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  throw err;
}

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

function createSpawnError(code: string) {
  return {
    stderr: { on: vi.fn() },
    on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => {
      if (event !== "error") return;
      const err = new Error(`spawn sudo ${code}`) as NodeJS.ErrnoException;
      err.code = code;
      cb(err);
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
    vi.mocked(accessSync).mockImplementation((path) => {
      const target = String(path);
      if (
        target.startsWith("/etc/ca-certificates/trust-source") ||
        target.startsWith("/etc/pki/ca-trust")
      ) {
        enoent();
      }
    });
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

  it("caTrustRemover removes the Debian cert with sudo rm and update-ca-certificates", async () => {
    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustRemover();

    expect(mockSpawn.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["sudo", ["rm", "-f", CERT_PATH]],
      ["sudo", ["update-ca-certificates"]],
    ]);
    for (const call of mockSpawn.mock.calls) {
      expect(call[2]).toEqual({ stdio: ["ignore", "ignore", "pipe"] });
    }
    expectNoShell();
  });

  it("caTrustRemover throws TrustError when sudo fails with EACCES", async () => {
    mockSpawn.mockImplementation(() => createSpawnError("EACCES"));

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TrustError);
        const trustError = error as TrustError;
        expect(trustError.reasons).toContain("ca-store-unwritable");
        expect(trustError.message).not.toContain(CERT_PATH);
        expect(trustError.message).not.toContain("EACCES");
        expect(trustError.message).not.toContain("BEGIN CERTIFICATE");
        return true;
      },
    );
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", CERT_PATH],
    ]);
    expectNoShell();
  });

  it("caTrustRemover throws when update-ca-certificates exits non-zero", async () => {
    const codes = [0, 1];
    let index = 0;
    mockSpawn.mockImplementation(() =>
      createChild(
        codes[index++] ?? 1,
        `update-ca-certificates: failed ${CERT_PATH}\n`,
      ),
    );

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TrustError);
        const trustError = error as TrustError;
        expect(trustError.reasons).toContain("ca-store-unwritable");
        expect(trustError.message).not.toContain(CERT_PATH);
        expect(trustError.message).not.toContain("update-ca-certificates");
        expect(trustError.message).not.toContain("BEGIN CERTIFICATE");
        return true;
      },
    );
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", CERT_PATH],
      ["update-ca-certificates"],
    ]);
    expectNoShell();
  });

  it("caTrustRemover throws elevation-required when the refresh needs a terminal", async () => {
    let index = 0;
    mockSpawn.mockImplementation(() => {
      index += 1;
      if (index === 1) return createChild(0);
      return createChild(1, "sudo: a terminal is required\n");
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TrustError);
        expect((error as TrustError).reasons).toContain("elevation-required");
        return true;
      },
    );
    expectNoShell();
  });

  it("refreshes Debian trust when the source file is already gone", async () => {
    vi.mocked(accessSync).mockImplementation((path) => {
      const target = String(path);
      if (
        target === CERT_PATH ||
        target.startsWith("/etc/ca-certificates/trust-source") ||
        target.startsWith("/etc/pki/ca-trust")
      ) {
        enoent();
      }
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustRemover()).resolves.toBeUndefined();
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", CERT_PATH],
      ["update-ca-certificates"],
    ]);
    expectNoShell();
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

  it("drops the cert into the Arch anchors directory and runs update-ca-trust", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which" && args?.[0] === "update-ca-certificates") {
        return { status: 1 };
      }
      return { status: 0 };
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      if (String(path).startsWith("/etc/pki/ca-trust")) enoent();
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(caPem);

    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["mkdir", "-p", ARCH_ANCHORS],
      ["tee", `${ARCH_ANCHORS}/rogatio-ca.crt`],
      ["update-ca-trust"],
    ]);
    const writer = mockSpawn.mock.results[1]?.value as ReturnType<
      typeof createChild
    >;
    expect(writer.stdin.end).toHaveBeenCalledWith(caPem);
    expectNoShell();
    for (const call of mockSpawn.mock.calls) {
      const args = call[1] as readonly string[];
      expect(args).not.toContain("--store");
      expect(args).not.toContain("--remove");
      expect(args[0]).not.toBe("trust");
    }
  });

  it("drops the cert into the Fedora anchors directory when the Arch tree is absent", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which" && args?.[0] === "update-ca-certificates") {
        return { status: 1 };
      }
      return { status: 0 };
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      if (String(path).startsWith("/etc/ca-certificates/trust-source"))
        enoent();
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustInstaller(caPem);

    expect(mockSpawn.mock.calls[1]?.[1]).toEqual([
      "tee",
      `${FEDORA_ANCHORS}/rogatio-ca.crt`,
    ]);
    expect(mockSpawn.mock.calls[2]?.[1]).toEqual(["update-ca-trust"]);
    expectNoShell();
  });

  it("removes the Arch anchor when update-ca-trust fails", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which" && args?.[0] === "update-ca-certificates") {
        return { status: 1 };
      }
      return { status: 0 };
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      if (String(path).startsWith("/etc/pki/ca-trust")) enoent();
    });
    const codes = [0, 0, 1, 0, 0];
    let index = 0;
    mockSpawn.mockImplementation(() => createChild(codes[index++] ?? 1));

    const adapter = selectTrustPlatformAdapter("linux");
    await expect(adapter.caTrustInstaller(caPem)).rejects.toBeInstanceOf(
      TrustError,
    );
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["mkdir", "-p", ARCH_ANCHORS],
      ["tee", `${ARCH_ANCHORS}/rogatio-ca.crt`],
      ["update-ca-trust"],
      ["rm", "-f", `${ARCH_ANCHORS}/rogatio-ca.crt`],
      ["update-ca-trust"],
    ]);
    expectNoShell();
  });

  it("removes an Arch anchor with sudo rm and update-ca-trust", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which" && args?.[0] === "update-ca-certificates") {
        return { status: 1 };
      }
      return { status: 0 };
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      const target = String(path);
      if (target === `${ARCH_ANCHORS}/rogatio-ca.crt`) return;
      if (
        target.startsWith("/etc/ca-certificates/trust-source") ||
        target.startsWith("/etc/pki/ca-trust")
      ) {
        enoent();
      }
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustRemover();

    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", `${ARCH_ANCHORS}/rogatio-ca.crt`],
      ["update-ca-trust"],
    ]);
    expectNoShell();
  });

  it("refreshes p11-kit trust when the anchor file is already gone", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which" && args?.[0] === "update-ca-certificates") {
        return { status: 1 };
      }
      return { status: 0 };
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      if (
        String(path).startsWith("/etc/ca-certificates/trust-source") ||
        String(path).startsWith("/etc/pki/ca-trust")
      ) {
        enoent();
      }
    });

    const adapter = selectTrustPlatformAdapter("linux");
    await adapter.caTrustRemover();

    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["update-ca-trust"],
    ]);
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
