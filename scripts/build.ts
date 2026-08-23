import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

type BuildTarget = {
  entry: string;
  output: string;
  platform: "node" | "browser";
  target: string;
  external?: string[];
  alias?: Record<string, string>;
  requireExports?: boolean;
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
    entry: "packages/schema/src/index.ts",
    output: "packages/schema/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["ajv"],
  },
  {
    entry: "packages/schema/src/browser-index.ts",
    output: "packages/schema/dist/browser/index.js",
    platform: "browser",
    target: "es2022",
  },
  {
    entry: "packages/editor/src/index.ts",
    output: "packages/editor/dist/browser/index.js",
    platform: "browser",
    target: "es2022",
    alias: {
      "@rogatio/schema": resolve(root, "packages/schema/dist/browser/index.js"),
    },
  },
  {
    entry: "packages/sanity/src/index.ts",
    output: "packages/sanity/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/smoke"],
  },
  {
    entry: "packages/compiler/src/index.ts",
    output: "packages/compiler/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema"],
  },
  {
    entry: "packages/browser-core/src/index.ts",
    output: "packages/browser-core/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema", "@rogatio/compiler"],
  },
  {
    entry: "packages/cli/src/index.ts",
    output: "packages/cli/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema", "@rogatio/compiler", "@rogatio/editor"],
  },
  {
    entry: "packages/extension/src/index.ts",
    output: "packages/extension/dist/browser/index.js",
    platform: "browser",
    target: "es2022",
    alias: {
      "@rogatio/schema": resolve(
        root,
        "packages/extension/src/browser-schema.ts",
      ),
      "@rogatio/compiler": resolve(root, "packages/compiler/src/index.ts"),
      "@rogatio/browser-core": resolve(
        root,
        "packages/browser-core/src/index.ts",
      ),
      "@rogatio/editor": resolve(root, "packages/editor/src/index.ts"),
    },
  },
  {
    entry: "packages/extension/src/background.ts",
    output: "packages/extension/dist/background.js",
    platform: "browser",
    target: "es2022",
    alias: {
      "@rogatio/schema": resolve(
        root,
        "packages/extension/src/browser-schema.ts",
      ),
      "@rogatio/compiler": resolve(root, "packages/compiler/src/index.ts"),
      "@rogatio/browser-core": resolve(
        root,
        "packages/browser-core/src/index.ts",
      ),
      "@rogatio/editor": resolve(root, "packages/editor/src/index.ts"),
    },
    requireExports: false,
  },
  {
    entry: "packages/extension/src/extension-page-entry.ts",
    output: "packages/extension/dist/extension-page.js",
    platform: "browser",
    target: "es2022",
    alias: {
      "@rogatio/schema": resolve(
        root,
        "packages/extension/src/browser-schema.ts",
      ),
      "@rogatio/compiler": resolve(root, "packages/compiler/src/index.ts"),
      "@rogatio/browser-core": resolve(
        root,
        "packages/browser-core/src/index.ts",
      ),
      "@rogatio/editor": resolve(root, "packages/editor/src/index.ts"),
    },
    requireExports: false,
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
    alias: target.alias,
    format: "esm",
    platform: target.platform,
    target: target.target,
    sourcemap: false,
    logLevel: "silent",
  });
  const contents = await readFile(output);
  if (
    contents.length === 0 ||
    (target.requireExports !== false &&
      !/\bexport\s*\{/.test(contents.toString()))
  )
    throw new Error(`Build artifact is empty or invalid ESM: ${target.output}`);
  manifest[target.output] = {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.length,
  };
}
await copyFile(
  resolve(root, "packages/extension/public/manifest.json"),
  resolve(root, "packages/extension/dist/manifest.json"),
);
await copyFile(
  resolve(root, "packages/extension/public/index.html"),
  resolve(root, "packages/extension/dist/index.html"),
);
await writeFile(
  resolve(root, "build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Built ${targets.length} ESM artifact(s); manifest: build-manifest.json`,
);
