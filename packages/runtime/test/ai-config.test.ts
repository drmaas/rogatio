import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync, readSync } from "node:fs";
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
      if (originalPlatform === "win32") {
        // Windows does not support POSIX permission bits via mode; skip
        return;
      }

      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      };

      await writeProviderConfig(config);

      const stat = await fs.stat(configPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("creates the config directory as 0o700", async () => {
      if (originalPlatform === "win32") return;

      await writeProviderConfig({
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      });

      const dirMode = (await fs.lstat(path.dirname(configPath))).mode & 0o777;
      expect(dirMode).toBe(0o700);
    });

    it("sets an existing 0o755 config directory to 0o700", async () => {
      if (originalPlatform === "win32") return;

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true, mode: 0o755 });
      await fs.chmod(configDir, 0o755);
      expect((await fs.lstat(configDir)).mode & 0o777).toBe(0o755);

      await writeProviderConfig({
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-test123",
      });

      expect((await fs.lstat(configDir)).mode & 0o777).toBe(0o700);
    });

    it("sets an existing 0o644 provider file to 0o600 and writes the new key", async () => {
      if (originalPlatform === "win32") return;

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, '{"apiKey":"sk-old"}\n', { mode: 0o644 });
      await fs.chmod(configPath, 0o644);
      expect((await fs.lstat(configPath)).mode & 0o777).toBe(0o644);

      const config = {
        providerUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-replaced",
      };
      await writeProviderConfig(config);

      expect((await fs.lstat(configPath)).mode & 0o777).toBe(0o600);
      expect(await readProviderConfig()).toEqual(config);
    });

    it("does not follow a symlink at provider.json", async () => {
      if (originalPlatform === "win32") return;

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      const sink = path.join(configDir, "sink.json");
      const sinkBytes = '{"apiKey":"sk-sink"}\n';
      await fs.writeFile(sink, sinkBytes);
      await fs.symlink(sink, configPath);

      await expect(
        writeProviderConfig({
          providerUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          apiKey: "sk-should-not-land",
        }),
      ).rejects.toThrow(/not a regular file/);

      expect(await fs.readFile(sink, "utf8")).toBe(sinkBytes);
      expect((await fs.lstat(configPath)).isSymbolicLink()).toBe(true);
    });

    it("does not write into a fifo at provider.json", async () => {
      if (originalPlatform === "win32") return;

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      try {
        execFileSync("mkfifo", [configPath]);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return;
        throw error;
      }

      const reader = openSync(
        configPath,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      try {
        await expect(
          writeProviderConfig({
            providerUrl: "https://api.openai.com/v1",
            model: "gpt-4o-mini",
            apiKey: "sk-should-not-land",
          }),
        ).rejects.toThrow(/not a regular file/);

        const buf = Buffer.alloc(64);
        let bytes = 0;
        try {
          bytes = readSync(reader, buf, 0, buf.length, null);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EAGAIN" && code !== "EWOULDBLOCK") throw error;
        }
        expect(bytes).toBe(0);
        expect((await fs.lstat(configPath)).isFIFO()).toBe(true);
      } finally {
        closeSync(reader);
      }
    });

    it("rejects a symlink when reading provider.json", async () => {
      if (originalPlatform === "win32") return;

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      const sink = path.join(configDir, "sink.json");
      const sinkBytes = '{"apiKey":"sk-sink"}\n';
      await fs.writeFile(sink, sinkBytes);
      await fs.symlink(sink, configPath);

      await expect(readProviderConfig()).rejects.toThrow(/not a regular file/);
      expect(await fs.readFile(sink, "utf8")).toBe(sinkBytes);
      expect((await fs.lstat(configPath)).isSymbolicLink()).toBe(true);
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
