import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
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
  kind?: "css";
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
    entry: "packages/dry-run/src/index.ts",
    output: "packages/dry-run/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema", "@rogatio/compiler"],
  },
  {
    entry: "packages/browser-core/src/index.ts",
    output: "packages/browser-core/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema", "@rogatio/compiler"],
  },
  {
    entry: "packages/runtime/src/index.ts",
    output: "packages/runtime/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["@rogatio/schema", "@rogatio/compiler"],
  },
  {
    entry: "packages/cli/src/index.ts",
    output: "packages/cli/dist/node/index.js",
    platform: "node",
    target: "node24",
    external: ["ajv"],
    alias: {
      "@rogatio/schema": resolve(root, "packages/schema/dist/node/index.js"),
      "@rogatio/compiler": resolve(
        root,
        "packages/compiler/dist/node/index.js",
      ),
      "@rogatio/dry-run": resolve(root, "packages/dry-run/dist/node/index.js"),
      "@rogatio/runtime": resolve(root, "packages/runtime/dist/node/index.js"),
    },
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
  {
    entry: "packages/extension/src/popup.ts",
    output: "packages/extension/dist/popup.js",
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
    entry: "packages/editor/src/editor.css",
    output: "packages/editor/dist/browser/index.css",
    platform: "browser",
    target: "es2022",
    kind: "css",
    external: ["*.woff2"],
  },
  {
    entry: "packages/extension/src/extension.css",
    output: "packages/extension/dist/extension-page.css",
    platform: "browser",
    target: "es2022",
    kind: "css",
    external: ["*.woff2"],
  },
  {
    entry: "packages/extension/src/popup.css",
    output: "packages/extension/dist/popup.css",
    platform: "browser",
    target: "es2022",
    kind: "css",
    external: ["*.woff2"],
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
    loader: target.kind === "css" ? { ".css": "css" } : undefined,
  });
  const contents = await readFile(output);
  if (target.kind === "css") {
    if (contents.length === 0)
      throw new Error(`Build artifact is empty: ${target.output}`);
  } else if (
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
await copyFile(
  resolve(root, "packages/extension/public/popup.html"),
  resolve(root, "packages/extension/dist/popup.html"),
);
await writeFile(
  resolve(root, "build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

// Copy bundled fonts into the editor and extension browser dists so
// @font-face url("fonts/...") references resolve offline next to the stylesheets.
// Copy the editor stylesheet into the extension dist so index.html can link
// it alongside the shell and popup stylesheets.
await copyFile(
  resolve(root, "packages/editor/dist/browser/index.css"),
  resolve(root, "packages/extension/dist/editor.css"),
);
const fontSource = resolve(root, "packages/editor/assets/fonts");
const fontTargets = [
  resolve(root, "packages/editor/dist/browser/fonts"),
  resolve(root, "packages/extension/dist/fonts"),
];
const fontFiles = await readdir(fontSource);
await Promise.all(
  fontTargets.flatMap((target) =>
    fontFiles.map(async (file) => {
      await mkdir(target, { recursive: true });
      await copyFile(resolve(fontSource, file), resolve(target, file));
    }),
  ),
);

// Mirror the editor's browser artifacts into the CLI tarball so the published
// @rogatio/cli can locate the editor assets at runtime without depending on
// the @rogatio/editor package being installed.
const editorBrowserDir = resolve(root, "packages/editor/dist/browser");
try {
  await access(editorBrowserDir);
} catch {
  throw new Error(
    `Editor browser dist missing: ${editorBrowserDir} — run the full pnpm build first.`,
  );
}
const cliEditorDir = resolve(root, "packages/cli/dist/editor");
await mkdir(cliEditorDir, { recursive: true });
await copyFile(
  resolve(editorBrowserDir, "index.js"),
  resolve(cliEditorDir, "index.js"),
);
await copyFile(
  resolve(editorBrowserDir, "index.css"),
  resolve(cliEditorDir, "index.css"),
);
await mkdir(resolve(cliEditorDir, "fonts"), { recursive: true });
for (const file of fontFiles) {
  await copyFile(
    resolve(editorBrowserDir, "fonts", file),
    resolve(cliEditorDir, "fonts", file),
  );
}

console.log(
  `Built ${targets.length} ESM artifact(s); manifest: build-manifest.json`,
);
