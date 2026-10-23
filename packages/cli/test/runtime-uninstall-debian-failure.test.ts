import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

import { runtimeCommand } from "../src/commands/runtime.js";

function createChild(code: number, stderrText = "") {
  return {
    stdin: { end: vi.fn(), on: vi.fn() },
    stderr: {
      on: (event: string, cb: (data: string) => void) => {
        if (event === "data" && stderrText) cb(stderrText);
      },
    },
    on: (event: string, cb: (value: number) => void) => {
      if (event === "close") cb(code);
    },
  };
}

describe("rogatio runtime uninstall when the Debian trust refresh fails", () => {
  let home = "";

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (home.length > 0) await rm(home, { recursive: true, force: true });
  });

  it("exits 1 and does not print runtime uninstall complete", async () => {
    home = await mkdtemp(join(tmpdir(), "rogatio-cli-uninstall-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    const installRoot = join(home, ".local", "share", "rogatio");
    await mkdir(installRoot, { recursive: true });
    await writeFile(join(installRoot, ".rogatio-ca.key"), "key\n", {
      mode: 0o600,
    });

    mockSpawnSync.mockReturnValue({ status: 0 });
    mockSpawn.mockImplementation((_command: string, args: readonly string[]) =>
      args[0] === "update-ca-certificates" ? createChild(1) : createChild(0),
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runtimeCommand(["uninstall"]);

    expect(code).toBe(1);
    expect(log.mock.calls.join("\n")).not.toContain(
      "runtime uninstall complete",
    );
    expect(err.mock.calls.join("\n")).toContain(
      "trust unsupported: ca-store-unwritable",
    );
  });
});
