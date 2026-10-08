import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const nodePin = "26.11.1";

describe("toolchain pins", () => {
  it("uses the same Node pin in nvm and every workflow", async () => {
    const nodeVersion = (
      await readFile(join(root, ".node-version"), "utf8")
    ).trim();
    expect(nodeVersion).toBe(nodePin);

    const workflowDir = join(root, ".github/workflows");
    const files = (await readdir(workflowDir)).filter((name) =>
      name.endsWith(".yml"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(workflowDir, file), "utf8");
      const pins = [...text.matchAll(/^ {2}NODE_VERSION: (.+)$/gm)].map(
        (match) => match[1],
      );
      expect(pins, file).toEqual([nodePin]);
    }
  });

  it("pins current pnpm and a Node 26 engine floor", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as {
      packageManager: string;
      engines: { node: string };
    };
    expect(manifest.packageManager).toBe("pnpm@12.10.1");
    expect(manifest.engines.node).toBe(">=26");
  });
});
