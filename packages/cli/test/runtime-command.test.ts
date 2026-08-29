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

  it("starts the runtime without capability gating", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    const code = await runtimeCommand(["start"]);
    expect(code).toBe(0);
    expect(log.mock.calls.join("\n")).toContain("runtime started");
  });

  it("prints a state on status", async () => {
    silence();
    const log = vi.spyOn(console, "log");
    const code = await runtimeCommand(["status"]);
    expect(code).toBe(0);
    expect(log.mock.calls.join("\n")).toMatch(
      /runtime (idle|unsupported|running|stopped)/,
    );
  });

  it("stops and returns 0", async () => {
    silence();
    const code = await runtimeCommand(["stop"]);
    expect(code).toBe(0);
  });

  it("returns 2 for an unknown subcommand", async () => {
    silence();
    const code = await runtimeCommand(["bogus"]);
    expect(code).toBe(2);
  });
});
