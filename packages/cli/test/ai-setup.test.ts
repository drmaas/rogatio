import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiCommand } from "../src/commands/ai.js";

/**
 * Regression: `rogatio ai setup` asks several prompts in sequence. Reading the
 * first answer must not destroy `process.stdin` (the old `for await` early
 * return aborted every following prompt with `AbortError`), and a pasted
 * multi-line batch must be delivered to the right prompts.
 */
describe("rogatio ai setup stdin prompts", () => {
  let temp: string | undefined;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");

  afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalStdin) {
      Object.defineProperty(process, "stdin", originalStdin);
    }
    vi.restoreAllMocks();
    if (temp) await rm(temp, { recursive: true, force: true });
    temp = undefined;
  });

  it("reads URL, model, and key sequentially and writes the config (0600)", async () => {
    temp = await mkdtemp(join(tmpdir(), "rogatio-ai-"));
    process.env.XDG_CONFIG_HOME = temp;

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

    const done = aiCommand(["setup"]);
    // The whole answer batch is available up front (pasted input): each prompt
    // must still receive exactly its own line.
    fakeStdin.write("https://provider.test/v1\ntest-model\ntest-key-123\n");

    await expect(done).resolves.toBe(0);

    const configPath = join(temp, "rogatio", "provider.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    expect(config).toEqual({
      providerUrl: "https://provider.test/v1",
      model: "test-model",
      apiKey: "test-key-123",
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it("reads answers typed as separate chunks", async () => {
    temp = await mkdtemp(join(tmpdir(), "rogatio-ai-"));
    process.env.XDG_CONFIG_HOME = temp;

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

    const done = aiCommand(["setup"]);
    fakeStdin.write("https://provider.test/v1\n");
    fakeStdin.write("test-model\n");
    fakeStdin.write("test-key-456\n");

    await expect(done).resolves.toBe(0);

    const configPath = join(temp, "rogatio", "provider.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      apiKey?: unknown;
    };
    expect(config.apiKey).toBe("test-key-456");
  });
});
