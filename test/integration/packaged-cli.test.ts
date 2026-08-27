import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packages = ["schema", "compiler", "dry-run", "editor", "runtime", "cli"];

async function run(command: string, args: string[], cwd: string) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, npm_config_offline: "true" },
      maxBuffer: 2 * 1024 * 1024,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("F18 packaged CLI integration", () => {
  it("packs, installs offline, and executes the real CLI binary", async () => {
    const build = await run(pnpm, ["build"], root);
    expect(build.code, build.stderr).toBe(0);
    const temp = await mkdtemp(join(tmpdir(), "rogatio-f18-packaged-"));
    const tarballs = join(temp, "tarballs");
    const consumer = join(temp, "consumer");
    try {
      await mkdir(tarballs, { recursive: true });
      for (const packageName of packages) {
        const result = await run(
          pnpm,
          ["pack", "--pack-destination", tarballs],
          join(root, "packages", packageName),
        );
        expect(result.code, `${packageName} pack failed`).toBe(0);
      }
      await mkdir(consumer, { recursive: true });
      const init = await run("npm", ["init", "-y"], consumer);
      expect(init.code).toBe(0);
      const tarballPaths = packages.map((packageName) =>
        join(tarballs, `rogatio-${packageName}-0.0.0.tgz`),
      );
      const ajvPackage = dirname(require.resolve("ajv/package.json"));
      const install = await run(
        "npm",
        [
          "install",
          "--offline",
          "--no-audit",
          "--no-fund",
          ...tarballPaths,
          ajvPackage,
        ],
        consumer,
      );
      expect(install.code, install.stderr).toBe(0);

      const projectPath = join(consumer, "project.json");
      await writeFile(
        projectPath,
        JSON.stringify({ version: 1, name: "Packaged", groups: [] }),
      );
      const bin = join(
        consumer,
        "node_modules",
        "@rogatio",
        "cli",
        "dist",
        "node",
        "index.js",
      );
      const node = process.execPath;
      const version = await run(node, [bin, "--version"], consumer);
      expect(version.code, `${version.stdout}${version.stderr}`).toBe(0);
      expect(`${version.stdout}${version.stderr}`).toContain("0.0.0");

      const verify = await run(node, [bin, "verify", projectPath], consumer);
      expect(verify.code, verify.stderr).toBe(0);

      const help = await run(node, [bin, "--help"], consumer);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain("Rogatio CLI");

      const casesPath = join(consumer, "cases.json");
      await writeFile(
        casesPath,
        JSON.stringify([{ url: "https://example.com/" }]),
      );
      const dryRun = await run(
        node,
        [bin, "test", "--json", "--urls-file", casesPath, projectPath],
        consumer,
      );
      expect(dryRun.code).toBe(0);
      expect(dryRun.stdout).toContain('"summary"');

      const status = await run(node, [bin, "runtime", "status"], consumer);
      expect([0, 1]).toContain(status.code);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 120_000);
});
