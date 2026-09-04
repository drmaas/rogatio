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

  it("help text does not advertise the removed activate/deactivate/status/trust subcommands", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    await runtimeCommand(["--help"]);
    const output = log.mock.calls.join("\n");
    expect(output).not.toMatch(/activate/);
    expect(output).not.toMatch(/deactivate/);
    expect(output).not.toMatch(/status/);
    expect(output).not.toMatch(/^ {2}trust\b/m);
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

  it("rejects trust with exit code 2 and prints the help text", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const code = await runtimeCommand(["trust"]);
    expect(code).toBe(2);
    expect(err.mock.calls.join("\n")).toContain(
      "unknown runtime subcommand: trust",
    );
    expect(log.mock.calls.join("\n")).toContain("rogatio runtime");
  });

  it("returns 2 for an unknown subcommand", async () => {
    silence();
    const code = await runtimeCommand(["bogus"]);
    expect(code).toBe(2);
  });
});
