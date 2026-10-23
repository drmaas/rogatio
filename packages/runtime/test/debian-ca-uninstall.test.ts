import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestBodyTrustController } from "../src/trust.js";
import { selectTrustPlatformAdapter } from "../src/trust-platform/index.js";

const CERT_PATH = "/usr/local/share/ca-certificates/rogatio-ca.crt";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

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

describe("debian uninstall when the trust refresh fails", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rogatio-debian-uninstall-"));
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
    mockSpawn.mockImplementation((_command: string, args: readonly string[]) =>
      args[0] === "update-ca-certificates" ? createChild(1) : createChild(0),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns unsupported, keeps the pending marker, and retries removal", async () => {
    const adapter = selectTrustPlatformAdapter("linux");
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      platform: "linux",
      detectCapabilities: () => ({
        manifest: true,
        caTrust: true,
        reasons: [],
      }),
      caTrustInstaller: async () => {},
      caTrustRemover: () => adapter.caTrustRemover(),
    });
    await controller.install(EXTENSION_ID);

    const failed = await controller.uninstall();
    expect(failed).toEqual({
      ok: false,
      state: "unsupported",
      reasons: ["ca-store-unwritable"],
    });
    expect(
      await readFile(join(root, ".rogatio-ca-store-pending"), "utf8"),
    ).toBe("1\n");
    await expect(
      readFile(join(root, ".rogatio-ca.key"), "utf8"),
    ).rejects.toThrow();
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", CERT_PATH],
      ["update-ca-certificates"],
    ]);
    for (const call of mockSpawn.mock.calls) {
      const args = call[1] as readonly string[];
      expect(args.join(" ")).not.toContain("BEGIN CERTIFICATE");
    }

    mockSpawn.mockImplementation(() => createChild(0));
    const retried = await controller.uninstall();
    expect(retried).toEqual({ ok: true, state: "uninstalled" });
    expect(mockSpawn.mock.calls.map((call) => call[1])).toEqual([
      ["rm", "-f", CERT_PATH],
      ["update-ca-certificates"],
      ["rm", "-f", CERT_PATH],
      ["update-ca-certificates"],
    ]);
    await expect(
      readFile(join(root, ".rogatio-ca-store-pending"), "utf8"),
    ).rejects.toThrow();
  });
});
