import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteProviderConfig,
  getProviderConfigPath,
  readProviderConfig,
  writeProviderConfig,
} from "../src/ai-config.js";

describe("ai-config", () => {
  let testConfigDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    testConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "rogatio-ai-test-"),
    );
    originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
    };
  });

  afterEach(async () => {
    // Restore env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Clean up test dir
    try {
      await fs.rm(testConfigDir, { recursive: true, force: true });
    } catch {}
  });

  describe("getProviderConfigPath", () => {
    let originalPlatform: string;

    beforeEach(() => {
      originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("returns Linux path with XDG_CONFIG_HOME", () => {
      process.env.XDG_CONFIG_HOME = path.join(testConfigDir, "xdg");
      process.env.HOME = "/home/user";
      delete process.env.USERPROFILE;
      delete process.env.LOCALAPPDATA;

      const result = getProviderConfigPath();
      expect(result).toBe(
        path.join(testConfigDir, "xdg", "rogatio", "provider.json"),
      );
    });

    it("returns Linux path with HOME fallback", () => {
      delete process.env.XDG_CONFIG_HOME;
      process.env.HOME = "/home/user";
      delete process.env.USERPROFILE;
      delete process.env.LOCALAPPDATA;

      const result = getProviderConfigPath();
      expect(result).toBe(
        path.join("/home/user", ".config", "rogatio", "provider.json"),
      );
    });

    it("returns macOS path", () => {
      process.env.HOME = "/Users/user";
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.USERPROFILE;
      delete process.env.LOCALAPPDATA;

      // Mock process.platform for macOS
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      const result = getProviderConfigPath();
      expect(result).toBe(
        path.join(
          "/Users/user",
          "Library",
          "Application Support",
          "rogatio",
          "provider.json",
        ),
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("returns Windows path with LOCALAPPDATA", () => {
      process.env.LOCALAPPDATA = "C:\\Users\\user\\AppData\\Local";
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.HOME;
      delete process.env.USERPROFILE;

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const result = getProviderConfigPath();
      expect(result).toBe(
        path.join(
          "C:\\Users\\user\\AppData\\Local",
          "rogatio",
          "provider.json",
        ),
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("returns Windows path with USERPROFILE fallback", () => {
      delete process.env.LOCALAPPDATA;
      process.env.USERPROFILE = "C:\\Users\\user";
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.HOME;

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const result = getProviderConfigPath();
      expect(result).toBe(
        path.join(
          "C:\\Users\\user",
          "AppData",
          "Local",
          "rogatio",
          "provider.json",
        ),
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe("writeProviderConfig / readProviderConfig / deleteProviderConfig", () => {
    let configPath: string;
    let originalPlatform: string;

    beforeEach(() => {
      // Use test directory for config
      process.env.HOME = testConfigDir;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.USERPROFILE;
      delete process.env.LOCALAPPDATA;

      // Mock platform as linux for these tests
      originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
      configPath = getProviderConfigPath();
    });

    afterEach(() => {
      // Restore platform
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("writes and reads config", async () => {
      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      };

      await writeProviderConfig(config);
      const read = await readProviderConfig();

      expect(read).toEqual(config);
    });

    it("creates parent directories", async () => {
      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      };

      await writeProviderConfig(config);

      const stat = await fs.stat(path.dirname(configPath));
      expect(stat.isDirectory()).toBe(true);
    });

    it("sets file permissions to 0o600 (owner read/write only)", async () => {
      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      };

      await writeProviderConfig(config);

      const stat = await fs.stat(configPath);
      // Check owner read/write only (0o600 = 0o100600 in stat.mode)
      // Mask with 0o777 to get permission bits, then verify group/other have no access
      const perms = stat.mode & 0o777;
      expect(perms & 0o077).toBe(0); // No group/other permissions
      expect(perms & 0o600).toBe(0o600); // Owner has read/write
    });

    it("returns null when config does not exist", async () => {
      const read = await readProviderConfig();
      expect(read).toBeNull();
    });

    it("deletes config", async () => {
      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      };

      await writeProviderConfig(config);
      await deleteProviderConfig();

      const read = await readProviderConfig();
      expect(read).toBeNull();
    });

    it("delete is idempotent", async () => {
      await deleteProviderConfig(); // Should not throw
      await deleteProviderConfig(); // Should not throw
    });

    it("overwrites existing config", async () => {
      await writeProviderConfig({
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-old",
      });

      await writeProviderConfig({
        providerUrl: "https://api.anthropic.com/v1",
        model: "claude-3-haiku",
        apiKey: "sk-new",
      });

      const read = await readProviderConfig();
      expect(read?.model).toBe("claude-3-haiku");
      expect(read?.apiKey).toBe("sk-new");
    });
  });
});
