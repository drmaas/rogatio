import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

type BuildTarget = {
  entry: string;
  output: string;
  platform: "node" | "browser";
  target: string;
  external?: string[];
};

const targets: BuildTarget[] = [
  {
    entry: "packages/smoke/src/index.ts",
    output: "packages/smoke/dist/node/index.js",
    platform: "node",
    target: "node24",
  },
  {
    entry: "packages/smoke/src/index.ts",
    output: "packages/smoke/dist/browser/index.js",
    platform: "browser",
    target: "es2022",
  },
  {
    entry: "packages/sanity/src/index.ts",
    output: "packages/sanity/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/smoke"],
  },
  {
    entry: "packages/schema/src/index.ts",
    output: "packages/schema/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["ajv"],
  },
];
const manifest: Record<string, { sha256: string; bytes: number }> = {};
for (const target of targets) {
  const output = resolve(root, target.output);
  await mkdir(resolve(output, ".."), { recursive: true });
  await build({
    bundle: true,
    entryPoints: [resolve(root, target.entry)],
    outfile: output,
    external: target.external,
    format: "esm",
    platform: target.platform,
    target: target.target,
    sourcemap: false,
    logLevel: "silent",
  });
  const contents = await readFile(output);
  if (contents.length === 0 || !/\bexport\s*\{/.test(contents.toString()))
    throw new Error(`Build artifact is empty or not ESM: ${target.output}`);
  manifest[target.output] = {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.length,
  };
}
await writeFile(
  resolve(root, "build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Built ${targets.length} ESM artifact(s); manifest: build-manifest.json`,
);
