import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserLaunchError, launchBrowser } from "../src/utils/browser.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("browser launch utility", () => {
  const mockSpawn = vi.mocked(spawn);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("process", { ...process, platform: "linux" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createMockChild(
    options: { closeCode?: number; error?: Error } = {},
  ): {
    on: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  } {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    return {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
        // Immediately invoke close callback if provided
        if (event === "close" && options.closeCode !== undefined) {
          setImmediate(() => cb(options.closeCode));
        }
        if (event === "error" && options.error) {
          setImmediate(() => cb(options.error));
        }
      }),
      unref: vi.fn(),
    };
  }

  it("launches browser on Linux with xdg-open", async () => {
    const mockChild = createMockChild({ closeCode: 0 });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    await expect(launchBrowser("http://localhost:1234")).resolves.toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      "xdg-open",
      ["http://localhost:1234"],
      expect.any(Object),
    );
  });

  it("launches browser on macOS with open", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });

    const mockChild = createMockChild({ closeCode: 0 });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    await expect(launchBrowser("http://localhost:1234")).resolves.toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      "open",
      ["http://localhost:1234"],
      expect.any(Object),
    );
  });

  it("launches browser on Windows with start", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });

    const mockChild = createMockChild({ closeCode: 0 });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    await expect(launchBrowser("http://localhost:1234")).resolves.toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "http://localhost:1234"],
      expect.any(Object),
    );
  });

  it("returns false on spawn error", async () => {
    const mockChild = createMockChild({ error: new Error("ENOENT") });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    await expect(launchBrowser("http://localhost:1234")).resolves.toBe(false);
  });

  it("returns false on non-zero exit code", async () => {
    const mockChild = createMockChild({ closeCode: 1 });
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    await expect(launchBrowser("http://localhost:1234")).resolves.toBe(false);
  });

  it("throws BrowserLaunchError on unknown platform", async () => {
    vi.stubGlobal("process", { ...process, platform: "unknown" });

    await expect(launchBrowser("http://localhost:1234")).rejects.toThrow(
      BrowserLaunchError,
    );
  });
});
