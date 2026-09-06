import { afterEach, describe, expect, it, vi } from "vitest";
import { selectTrustPlatformAdapter } from "../../src/trust-platform/index.js";

describe("TrustPlatformAdapter paths", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("darwin defaultManifestDir returns correct path", () => {
    vi.stubEnv("HOME", "/Users/test");
    const adapter = selectTrustPlatformAdapter("darwin");
    expect(adapter.defaultManifestDir()).toBe(
      "/Users/test/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
  });

  it("darwin defaultCaInstallPath returns correct path", () => {
    vi.stubEnv("HOME", "/Users/test");
    const adapter = selectTrustPlatformAdapter("darwin");
    expect(adapter.defaultCaInstallPath()).toBe(
      "/Users/test/Library/Keychains/login.keychain-db",
    );
  });

  it("linux defaultManifestDir returns correct path", () => {
    vi.stubEnv("HOME", "/home/test");
    const adapter = selectTrustPlatformAdapter("linux");
    expect(adapter.defaultManifestDir()).toBe(
      "/home/test/.config/google-chrome/NativeMessagingHosts",
    );
  });

  it("linux defaultCaInstallPath returns correct path", () => {
    vi.stubEnv("HOME", "/home/test");
    const adapter = selectTrustPlatformAdapter("linux");
    expect(adapter.defaultCaInstallPath()).toBe(
      "/home/test/.local/share/ca-certificates",
    );
  });

  it("win32 defaultManifestDir returns correct path", () => {
    vi.stubEnv("APPDATA", "/mnt/c/Users/test/AppData/Roaming");
    const adapter = selectTrustPlatformAdapter("win32");
    expect(adapter.defaultManifestDir()).toBe(
      "/mnt/c/Users/test/AppData/Roaming/Google/Chrome/NativeMessagingHosts",
    );
  });

  it("win32 defaultCaInstallPath returns cert store path", () => {
    const adapter = selectTrustPlatformAdapter("win32");
    expect(adapter.defaultCaInstallPath()).toBe("Cert:\\CurrentUser\\Root");
  });

  it("returns empty string when HOME/APPDATA is unset", () => {
    delete process.env.HOME;
    delete process.env.APPDATA;
    const darwin = selectTrustPlatformAdapter("darwin");
    const linux = selectTrustPlatformAdapter("linux");
    const win32 = selectTrustPlatformAdapter("win32");
    // On Linux (test environment), join uses forward slashes
    expect(darwin.defaultManifestDir()).toBe(
      "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
    expect(linux.defaultManifestDir()).toBe(
      ".config/google-chrome/NativeMessagingHosts",
    );
    expect(win32.defaultManifestDir()).toBe(
      "Google/Chrome/NativeMessagingHosts",
    );
  });
});
