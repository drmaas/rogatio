import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
import { writeExclusiveCertificate } from "../../src/trust-platform/private-cert-file.js";
import {
  createCertificate,
  generateCaKeyPair,
  signCertificate,
} from "../../src/x509.js";

const mockSpawn = vi.hoisted(() => vi.fn());
const certTempSpy = vi.hoisted(() => ({
  beforeLstat: undefined as
    | ((path: string) => Promise<void> | void)
    | undefined,
  touched: [] as string[],
  dirs: [] as string[],
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: mockSpawn,
    spawnSync: vi.fn(() => ({ status: 0 })),
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    accessSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    lstat: async (path: string) => {
      const hook = certTempSpy.beforeLstat;
      if (hook && (path.endsWith("/ca.crt") || path.endsWith("\\ca.crt"))) {
        certTempSpy.beforeLstat = undefined;
        await hook(path);
      }
      return actual.lstat(path);
    },
    open: async (path: string, flags?: string | number, mode?: number) => {
      certTempSpy.touched.push(String(path));
      return actual.open(path, flags, mode);
    },
    writeFile: async (
      path: string,
      data: string | Buffer,
      options?: BufferEncoding,
    ) => {
      certTempSpy.touched.push(String(path));
      return actual.writeFile(path, data, options);
    },
    mkdtemp: async (prefix: string) => {
      const dir = await actual.mkdtemp(prefix);
      certTempSpy.dirs.push(dir);
      return dir;
    },
  };
});

function toolChild(code: number) {
  return {
    stderr: { on: vi.fn() },
    on: (event: string, cb: (value: number) => void) => {
      if (event === "close") cb(code);
    },
  };
}

function predictableCertPath(stamp: number): string {
  return join(tmpdir(), `rogatio-ca-${stamp}.crt`);
}

function captureToolPath(
  code: number,
  alreadyOpen: ReadonlySet<string> = new Set(),
): { path: string; opened: string[] } {
  const seen = { path: "", opened: [] as string[] };
  mockSpawn.mockImplementation((_command: string, args: string[]) => {
    seen.path = args.at(-1) ?? "";
    seen.opened = descriptorTargets().filter(
      (target) => !alreadyOpen.has(target),
    );
    return toolChild(code);
  });
  return seen;
}

function descriptorTargets(): string[] {
  if (!existsSync("/proc/self/fd")) return [];
  return readdirSync("/proc/self/fd").flatMap((fd) => {
    try {
      return [readlinkSync(join("/proc/self/fd", fd))];
    } catch {
      return [];
    }
  });
}

function fifoBytes(fd: number): number {
  const buf = Buffer.alloc(64);
  try {
    return readSync(fd, buf, 0, buf.length, null);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EAGAIN" || code === "EWOULDBLOCK") return 0;
    throw error;
  }
}

describe("darwin CA installer/remover", () => {
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
    vi.stubEnv("HOME", "/Users/test");
    mockSpawn.mockReset();
    certTempSpy.beforeLstat = undefined;
    certTempSpy.touched = [];
    certTempSpy.dirs = [];
    vi.mocked(writeFileSync).mockClear();
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

    await _adapter.caTrustInstaller(caPem);

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
    await expect(adapter.caTrustInstaller(caPem)).rejects.toThrow(TrustError);
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
      await adapter.caTrustInstaller(caPem);
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
    await adapter.caTrustInstaller(caPem);
    await adapter.caTrustInstaller(caPem);

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
    if (process.platform !== "win32") {
      expect(seen.mode).toBe(0o600);
      expect(seen.dirMode).toBe(0o700);
    }
    const certPath = seen.path ?? "";
    expect(certPath).toBe(join(dirname(certPath), "previous.crt"));
    expect(dirname(dirname(certPath))).toBe(tmpdir());
    expect(dirname(certPath)).toContain("rogatio-ca-");
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

  it("caTrustInstaller writes an exclusive 0o600 file in a private directory", async () => {
    const seen = {
      path: "",
      pem: "",
      mode: 0,
      dirMode: 0,
      regular: false,
    };
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      const certPath = args.at(-1) ?? "";
      const info = lstatSync(certPath);
      seen.path = certPath;
      seen.pem = readFileSync(certPath, "utf8");
      seen.mode = info.mode & 0o777;
      seen.dirMode = statSync(dirname(certPath)).mode & 0o777;
      seen.regular = info.isFile();
      return toolChild(0);
    });
    const adapter = selectTrustPlatformAdapter("darwin");
    await adapter.caTrustInstaller(caPem);

    expect(seen.pem).toBe(caPem);
    expect(seen.regular).toBe(true);
    expect(basename(seen.path)).toBe("ca.crt");
    expect(basename(dirname(seen.path))).toMatch(/^rogatio-ca-/);
    expect(dirname(dirname(seen.path))).toBe(tmpdir());
    expect(seen.path).not.toMatch(/rogatio-ca-\d+\.crt$/);
    if (process.platform !== "win32") {
      expect(seen.mode).toBe(0o600);
      expect(seen.dirMode).toBe(0o700);
    }
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0]?.[0]).toBe("security");
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual([
      "add-trusted-cert",
      "-d",
      "-r",
      "trustRoot",
      "-k",
      "/Users/test/Library/Keychains/login.keychain-db",
      seen.path,
    ]);
    expect(existsSync(seen.path)).toBe(false);
    expect(existsSync(dirname(seen.path))).toBe(false);
  });

  it("caTrustInstaller does not use a pre-created symlink at the old temp name", async (ctx) => {
    const stamp = 1_700_000_000_101;
    const predictable = predictableCertPath(stamp);
    const trap = await mkdtemp(join(tmpdir(), "rogatio-trap-"));
    const sink = join(trap, "sink.crt");
    const now = vi.spyOn(Date, "now").mockReturnValue(stamp);
    await writeFile(sink, "sink-bytes");
    try {
      try {
        await symlink(sink, predictable);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "ENOTSUP") ctx.skip();
        throw error;
      }
      const seen = captureToolPath(0);
      const adapter = selectTrustPlatformAdapter("darwin");
      await adapter.caTrustInstaller(caPem);

      expect(seen.path).not.toBe(predictable);
      expect(mockSpawn.mock.calls[0]?.[1]).not.toContain(predictable);
      expect(certTempSpy.touched).not.toContain(predictable);
      expect(
        vi.mocked(writeFileSync).mock.calls.map((call) => call[0]),
      ).not.toContain(predictable);
      expect(seen.opened).not.toContain(predictable);
      expect(await readFile(sink, "utf8")).toBe("sink-bytes");
      expect((await lstat(predictable)).isSymbolicLink()).toBe(true);
      expect(existsSync(dirname(seen.path))).toBe(false);
    } finally {
      now.mockRestore();
      await rm(predictable, { force: true });
      await rm(trap, { recursive: true, force: true });
    }
  });

  it("caTrustInstaller does not use a pre-created fifo at the old temp name", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const stamp = 1_700_000_000_102;
    const predictable = predictableCertPath(stamp);
    const now = vi.spyOn(Date, "now").mockReturnValue(stamp);
    let reader = -1;
    try {
      try {
        execFileSync("mkfifo", [predictable]);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") ctx.skip();
        throw error;
      }
      reader = openSync(
        predictable,
        fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
      );
      const seen = captureToolPath(0, new Set(descriptorTargets()));
      const adapter = selectTrustPlatformAdapter("darwin");
      await adapter.caTrustInstaller(caPem);

      expect(seen.path).not.toBe(predictable);
      expect(mockSpawn.mock.calls[0]?.[1]).not.toContain(predictable);
      expect(certTempSpy.touched).not.toContain(predictable);
      expect(
        vi.mocked(writeFileSync).mock.calls.map((call) => call[0]),
      ).not.toContain(predictable);
      expect(seen.opened).not.toContain(predictable);
      expect(fifoBytes(reader)).toBe(0);
      expect((await lstat(predictable)).isFIFO()).toBe(true);
      expect(existsSync(dirname(seen.path))).toBe(false);
    } finally {
      now.mockRestore();
      if (reader >= 0) closeSync(reader);
      await rm(predictable, { force: true });
    }
  });

  it("caTrustInstaller does not spawn when the certificate file bytes change", async () => {
    let seen = "";
    certTempSpy.beforeLstat = async (certPath) => {
      seen = certPath;
      await writeFile(certPath, "changed");
    };
    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(adapter.caTrustInstaller(caPem)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TrustError);
        const trustError = error as TrustError;
        expect(trustError.message).toBe(
          "certificate file does not match the certificate to install",
        );
        expect(trustError.message).not.toContain(tmpdir());
        expect(trustError.message).not.toContain("rogatio-ca-");
        return true;
      },
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(seen).not.toBe("");
    expect(existsSync(dirname(seen))).toBe(false);
  });

  it("caTrustInstaller does not spawn when the certificate file is replaced with a symlink", async (ctx) => {
    const trap = await mkdtemp(join(tmpdir(), "rogatio-trap-"));
    const sink = join(trap, "sink.crt");
    await writeFile(sink, "sink-bytes");
    let seen = "";
    const probe = join(trap, "probe");
    try {
      try {
        await symlink(sink, probe);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "ENOTSUP") ctx.skip();
        throw error;
      }
      certTempSpy.beforeLstat = async (certPath) => {
        seen = certPath;
        await rm(certPath);
        await symlink(sink, certPath);
      };
      const adapter = selectTrustPlatformAdapter("darwin");
      await expect(adapter.caTrustInstaller(caPem)).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TrustError);
          const trustError = error as TrustError;
          expect(trustError.message).toBe(
            "certificate file is not a regular file",
          );
          expect(trustError.message).not.toContain(tmpdir());
          return true;
        },
      );
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(await readFile(sink, "utf8")).toBe("sink-bytes");
      expect(existsSync(dirname(seen))).toBe(false);
    } finally {
      await rm(trap, { recursive: true, force: true });
    }
  });

  it("caTrustInstaller rejects a PEM that is not a single CA certificate", async () => {
    const leaf = await signCertificate("leaf.example", caPem, caKeyPem, 30);
    const adapter = selectTrustPlatformAdapter("darwin");
    const cases = [
      leaf,
      `${caPem}${caPem}`,
      "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
      "",
    ];
    for (const pem of cases) {
      mockSpawn.mockClear();
      certTempSpy.touched = [];
      certTempSpy.dirs = [];
      await expect(adapter.caTrustInstaller(pem)).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TrustError);
          const trustError = error as TrustError;
          expect(trustError.message).toBe("invalid-ca-certificate");
          expect(trustError.reasons).toContain("invalid-ca-certificate");
          expect(trustError.message).not.toContain("BEGIN CERTIFICATE");
          expect(trustError.message).not.toContain(tmpdir());
          return true;
        },
      );
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(certTempSpy.touched).toEqual([]);
      expect(certTempSpy.dirs).toEqual([]);
    }
  });

  it("caTrustInstaller removes the temp directory when the tool exits non-zero", async () => {
    const seen = captureToolPath(1);
    const adapter = selectTrustPlatformAdapter("darwin");
    await expect(adapter.caTrustInstaller(caPem)).rejects.toThrow(TrustError);
    expect(seen.path).not.toBe("");
    expect(existsSync(seen.path)).toBe(false);
    expect(existsSync(dirname(seen.path))).toBe(false);
  });

  it("writeExclusiveCertificate leaves an existing file in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
    const certPath = join(dir, "ca.crt");
    try {
      await writeFile(certPath, "keep");
      await expect(
        writeExclusiveCertificate(certPath, caPem),
      ).rejects.toThrow();
      expect(await readFile(certPath, "utf8")).toBe("keep");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
