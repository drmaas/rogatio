import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeCommand } from "../src/commands/runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function silence(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("rogatio runtime command", () => {
  it("prints help and returns 0 with --help", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    const code = await runtimeCommand(["--help"]);
    expect(code).toBe(0);
    expect(log.mock.calls.join("\n")).toContain("rogatio runtime");
  });

  it("help text does not advertise the removed activate/deactivate/status subcommands", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    await runtimeCommand(["--help"]);
    const output = log.mock.calls.join("\n");
    expect(output).not.toMatch(/activate/);
    expect(output).not.toMatch(/deactivate/);
  });

  it("rejects activate with exit code 2", async () => {
    silence();
    const code = await runtimeCommand(["activate"]);
    expect(code).toBe(2);
  });

  it("rejects deactivate with exit code 2", async () => {
    silence();
    const code = await runtimeCommand(["deactivate"]);
    expect(code).toBe(2);
  });

  it("rejects status with exit code 2", async () => {
    silence();
    const code = await runtimeCommand(["status"]);
    expect(code).toBe(2);
  });

  it("returns 2 for an unknown subcommand", async () => {
    silence();
    const code = await runtimeCommand(["bogus"]);
    expect(code).toBe(2);
  });
});
