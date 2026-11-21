import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MINIMUM_NODE_VERSION } from "../../packages/runtime/src/doctor.js";

const root = resolve(import.meta.dirname, "../..");

function compareVersions(version: string, minimum: string): number {
  const left = version.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

const nodeOk =
  compareVersions(process.versions.node, MINIMUM_NODE_VERSION) >= 0;

describe("semantic-release 26 release toolchain", () => {
  it("does not pin a global npm CLI in release.yml", async () => {
    const release = await readFile(
      join(root, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(release).not.toMatch(/NPM_VERSION:/);
    expect(release).not.toMatch(/npm install -g/);
    expect(release).toContain("assert-release-toolchain.mjs");
  });

  it.skipIf(!nodeOk)(
    "assert-release-toolchain accepts Node and bundled npm 12 from @semantic-release/npm",
    () => {
      const result = spawnSync(
        process.execPath,
        ["scripts/assert-release-toolchain.mjs"],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toMatch(/@semantic-release\/npm npm 12\./);
    },
  );

  it.skipIf(!nodeOk)(
    "semantic-release --dry-run --no-ci loads custom prepare and generateNotes plugins without tokens",
    () => {
      const env = { ...process.env };
      delete env.GITHUB_TOKEN;
      delete env.GH_TOKEN;
      const result = spawnSync(
        "pnpm",
        ["exec", "semantic-release", "--dry-run", "--no-ci"],
        { cwd: root, encoding: "utf8", env, shell: false },
      );
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(result.status, combined).toBe(0);
      expect(combined).toContain(
        'Loaded plugin "prepare" from "./scripts/release-extension-plugin.mjs"',
      );
      expect(combined).toContain(
        'Loaded plugin "generateNotes" from "./scripts/release-notes-plugin.mjs"',
      );
    },
  );
});
