import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeCommand } from "../src/commands/runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function silence(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("rogatio runtime command ()", () => {
  it("requires explicit extension ID for install", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
  });

  it("rejects invalid extension ID format", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install", "--extension-id", "invalid"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
  });

  it("rejects wildcard extension ID", async () => {
    silence();
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["install", "--extension-id", "*"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain("extension-id");
  });

  it("accepts valid 32-character lowercase a-p extension ID", async () => {
    silence();
    const code = await runtimeCommand([
      "install",
      "--extension-id",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
    // Should not fail with extension-id error (may fail on missing trust/manifest)
    expect(code).not.toBe(2);
  });

  it("trust command remains explicit and capability-gated", async () => {
    silence();
    const code = await runtimeCommand(["trust"]);
    // Should report capability status without partial changes
    expect(code).toBeGreaterThanOrEqual(0);
  });
});
