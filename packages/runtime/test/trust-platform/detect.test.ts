import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";

const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockAccessSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock("node:fs", () => ({
  accessSync: mockAccessSync,
  constants: { W_OK: 2 },
}));

describe("TrustPlatformAdapter detect()", () => {
  beforeEach(() => {
    vi.stubEnv("HOME", "/home/test");
    vi.stubEnv("APPDATA", "/home/test/AppData/Roaming");
    mockSpawnSync.mockReset();
    mockAccessSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
    mockAccessSync.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("darwin", () => {
    it("returns manifest:true, caTrust:true when tooling present and dirs writable", () => {
      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it("returns tooling-missing when security not found", () => {
      mockSpawnSync.mockReturnValue({ status: 1 });

      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("tooling-missing");
    });

    it("returns manifest-dir-unwritable when manifest dir not writable", () => {
      mockAccessSync.mockImplementation((path) => {
        if (String(path).includes("NativeMessagingHosts"))
          throw new Error("EACCES");
      });

      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(true); // caTrust not affected by manifest-dir-unwritable
      expect(result.reasons).toContain("manifest-dir-unwritable");
    });

    it("returns keychain-unwritable when keychain dir not writable", () => {
      mockAccessSync.mockImplementation((path) => {
        if (String(path).includes("Keychains")) throw new Error("EACCES");
      });

      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("keychain-unwritable");
    });

    it("returns sorted, de-duplicated reasons", () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockAccessSync.mockImplementation((path) => {
        if (String(path).includes("NativeMessagingHosts"))
          throw new Error("EACCES");
        if (String(path).includes("Keychains")) throw new Error("EACCES");
      });

      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.reasons).toEqual(
        [
          "keychain-unwritable",
          "manifest-dir-unwritable",
          "tooling-missing",
        ].sort(),
      );
    });
  });

  describe("linux", () => {
    it("returns manifest:true, caTrust:true when tooling present, dirs writable, and sudo available", () => {
      // sudo -n true succeeds (passwordless sudo available)
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "sudo") return { status: 0 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it("returns tooling-missing when update-ca-certificates not found", () => {
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "which") return { status: 1 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("tooling-missing");
    });

    it("returns manifest-dir-unwritable when manifest dir not writable", () => {
      mockAccessSync.mockImplementation((path) => {
        if (String(path).includes("NativeMessagingHosts"))
          throw new Error("EACCES");
      });
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "sudo") return { status: 0 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(true); // caTrust not affected by manifest-dir-unwritable
      expect(result.reasons).toContain("manifest-dir-unwritable");
    });

    it("returns elevation-required when ca dir not writable and no sudo", () => {
      mockAccessSync.mockImplementation((path) => {
        const p = String(path);
        if (p === "/usr/local/share/ca-certificates") throw new Error("EACCES");
      });
      // sudo not installed
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "which" && _args?.[0] === "sudo") return { status: 1 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("elevation-required");
    });

    it("returns caTrust:true when ca dir not writable but sudo available", () => {
      mockAccessSync.mockImplementation((path) => {
        const p = String(path);
        if (p === "/usr/local/share/ca-certificates") throw new Error("EACCES");
      });
      // sudo installed (which sudo succeeds)
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "which" && _args?.[0] === "sudo") return { status: 0 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).not.toContain("elevation-required");
    });

    it("does not report elevation-required when ca dir missing but parent writable", () => {
      mockAccessSync.mockImplementation((path) => {
        const p = String(path);
        if (p === "/usr/local/share/ca-certificates") {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
      });
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "sudo") return { status: 0 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).not.toContain("elevation-required");
    });

    it("returns elevation-required when neither ca dir nor parent writable and no sudo", () => {
      mockAccessSync.mockImplementation((path) => {
        const p = String(path);
        if (
          p === "/usr/local/share/ca-certificates" ||
          p === "/usr/local/share"
        )
          throw new Error("EACCES");
      });
      // sudo not installed
      mockSpawnSync.mockImplementation((cmd: string, _args?: string[]) => {
        if (cmd === "which" && _args?.[0] === "sudo") return { status: 1 };
        return { status: 0 };
      });

      const adapter = selectTrustPlatformAdapter("linux");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("elevation-required");
    });
  });

  describe("win32", () => {
    it("returns manifest:true, caTrust:true when tooling present and dir writable", () => {
      const adapter = selectTrustPlatformAdapter("win32");
      const result = adapter.detect();

      expect(result.manifest).toBe(true);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it("returns tooling-missing when certutil not found", () => {
      mockSpawnSync.mockReturnValue({ status: 1 });

      const adapter = selectTrustPlatformAdapter("win32");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(false);
      expect(result.reasons).toContain("tooling-missing");
    });

    it("returns manifest-dir-unwritable when manifest dir not writable", () => {
      mockAccessSync.mockImplementation((path) => {
        if (String(path).includes("NativeMessagingHosts"))
          throw new Error("EACCES");
      });

      const adapter = selectTrustPlatformAdapter("win32");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.caTrust).toBe(true);
      expect(result.reasons).toContain("manifest-dir-unwritable");
    });

    it("does not probe CA store writability (not a filesystem path)", () => {
      const adapter = selectTrustPlatformAdapter("win32");
      adapter.detect();

      const accessCalls = mockAccessSync.mock.calls.map((c) => String(c[0]));
      expect(
        accessCalls.some(
          (p) => p.includes("Cert:") || p.includes("CurrentUser"),
        ),
      ).toBe(false);
    });
  });

  describe("capability-based (not OS-name-based)", () => {
    it("darwin with missing tooling returns manifest:false (not darwin-specific reason)", () => {
      mockSpawnSync.mockReturnValue({ status: 1 });

      const adapter = selectTrustPlatformAdapter("darwin");
      const result = adapter.detect();

      expect(result.manifest).toBe(false);
      expect(result.reasons).not.toContain("darwin-unsupported");
      expect(result.reasons).not.toContain("macos-unsupported");
    });
  });

  describe("locked vocabulary", () => {
    const validVocab = new Set([
      "no-capability-provider",
      "tooling-missing",
      "manifest-dir-unwritable",
      "ca-store-unwritable",
      "keychain-unwritable",
      "elevation-required",
    ]);

    it("only uses locked vocabulary", () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockAccessSync.mockImplementation(() => {
        throw new Error("EACCES");
      });

      const platforms = ["darwin", "linux", "win32"] as const;
      for (const platform of platforms) {
        const adapter = selectTrustPlatformAdapter(platform);
        const result = adapter.detect();
        for (const reason of result.reasons) {
          expect(validVocab.has(reason)).toBe(true);
        }
      }
    });
  });
});
