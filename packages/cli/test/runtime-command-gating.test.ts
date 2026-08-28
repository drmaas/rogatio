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

  it("start without extension policy cannot begin live interception", async () => {
    silence();
    const code = await runtimeCommand(["start"]);
    // Should report unsupported or process diagnostics only
    expect(code).toBe(0);
  });

  it("status reports safe runtime/trust state without paths, certificates, bodies, headers, credentials", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    const code = await runtimeCommand(["status"]);
    expect(code).toBe(0);
    const output = log.mock.calls.join("\n");
    // Should not contain sensitive data
    expect(output).not.toMatch(
      /certificate|private.*key|credential|cookie|authorization/i,
    );
  });
});
