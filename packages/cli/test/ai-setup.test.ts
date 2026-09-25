import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { getProviderConfigPath } from "@rogatio/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiCommand } from "../src/commands/ai.js";

/**
 * `getConfigDir` is platform-specific (XDG_CONFIG_HOME on Linux,
 * `~/Library/Application Support` on macOS, `%LOCALAPPDATA%` on Windows), so
 * the test redirects whichever variable the current platform honors — never
 * the real user config. The expected path comes from `getProviderConfigPath`
 * so the platform branches stay in the product, not in the test.
 */
function configEnvKey(): "LOCALAPPDATA" | "HOME" | "XDG_CONFIG_HOME" {
  if (process.platform === "win32") return "LOCALAPPDATA";
  if (process.platform === "darwin") return "HOME";
  return "XDG_CONFIG_HOME";
}

/**
 * Regression: `rogatio ai setup` asks several prompts in sequence. Reading the
 * first answer must not destroy `process.stdin` (the old `for await` early
 * return aborted every following prompt with `AbortError`), and a pasted
 * multi-line batch must be delivered to the right prompts.
 */
describe("rogatio ai setup stdin prompts", () => {
  let temp: string | undefined;
  let originalEnvValue: string | undefined;
  const envKey = configEnvKey();
  const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");

  afterEach(async () => {
    if (originalEnvValue === undefined) delete process.env[envKey];
    else process.env[envKey] = originalEnvValue;
    if (originalStdin) {
      Object.defineProperty(process, "stdin", originalStdin);
    }
    vi.restoreAllMocks();
    if (temp) await rm(temp, { recursive: true, force: true });
    temp = undefined;
  });

  async function isolateConfigDir(): Promise<void> {
    temp = await mkdtemp(join(tmpdir(), "rogatio-ai-"));
    originalEnvValue = process.env[envKey];
    process.env[envKey] = temp;
  }

  function installFakeStdin(): PassThrough & {
    setRawMode: (mode: boolean) => void;
  } {
    const fakeStdin = new PassThrough() as PassThrough & {
      setRawMode: (mode: boolean) => void;
    };
    fakeStdin.setRawMode = () => {
      // Echo suppression is not observable on a pipe.
    };
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: fakeStdin,
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    return fakeStdin;
  }

  it("reads URL, model, and key sequentially and writes the config (0600)", async () => {
    await isolateConfigDir();
    const fakeStdin = installFakeStdin();

    const done = aiCommand(["setup"]);
    // The whole answer batch is available up front (pasted input): each prompt
    // must still receive exactly its own line.
    fakeStdin.write("https://provider.test/v1\ntest-model\ntest-key-123\n");

    await expect(done).resolves.toBe(0);

    const configPath = getProviderConfigPath();
    const config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    expect(config).toEqual({
      providerUrl: "https://provider.test/v1",
      model: "test-model",
      apiKey: "test-key-123",
    });
    if (process.platform !== "win32") {
      // Windows maps chmod to the read-only bit; POSIX modes are meaningless
      // there and `stat().mode` reports 0666.
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("reads answers typed as separate chunks", async () => {
    await isolateConfigDir();
    const fakeStdin = installFakeStdin();

    const done = aiCommand(["setup"]);
    fakeStdin.write("https://provider.test/v1\n");
    fakeStdin.write("test-model\n");
    fakeStdin.write("test-key-456\n");

    await expect(done).resolves.toBe(0);

    const configPath = getProviderConfigPath();
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      apiKey?: unknown;
    };
    expect(config.apiKey).toBe("test-key-456");
  });
});
