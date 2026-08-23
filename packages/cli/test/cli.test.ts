import { describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";

describe("CLI entry point", () => {
  it("shows help for edit command", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cli(["edit", "--help"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: rogatio edit"),
    );
    consoleSpy.mockRestore();
  });

  it("shows help for verify command", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cli(["verify", "--help"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: rogatio verify"),
    );
    consoleSpy.mockRestore();
  });

  it("shows help for runtime command", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cli(["runtime", "--help"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: rogatio runtime"),
    );
    consoleSpy.mockRestore();
  });

  it("shows global help", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cli(["--help"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("rogatio"));
    consoleSpy.mockRestore();
  });

  it("shows version", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cli(["--version"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\d+\.\d+\.\d+/),
    );
    consoleSpy.mockRestore();
  });

  it("handles unknown command", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await cli(["unknown"]);
    expect(exitCode).toBe(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown command"),
    );
    consoleSpy.mockRestore();
  });
});
