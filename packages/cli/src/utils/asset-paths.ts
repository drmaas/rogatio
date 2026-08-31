import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface EditorAssetPaths {
  bundle: string;
  css: string;
  fonts: string;
}

// True when the running cli is executing the published dist bundle
// (packages/cli/dist/node/index.js). False when running from the source tree
// (packages/cli/src/commands/edit.ts). The published tarball ships a copy of
// packages/editor/dist/browser/* at packages/cli/dist/editor/*.
export function isDistBuild(
  here: string = dirname(fileURLToPath(import.meta.url)),
): boolean {
  return here.includes("/dist/") || here.includes("\\dist\\");
}

// Locate the editor assets next to the running cli, regardless of whether
// we are executing the published dist bundle (packages/cli/dist/node/) or
// the source files during development (packages/cli/src/commands/).
export function editorAssetPaths(
  here: string = dirname(fileURLToPath(import.meta.url)),
): EditorAssetPaths {
  const editorRoot = isDistBuild(here)
    ? resolve(here, "..", "editor")
    : resolve(here, "..", "..", "..", "editor", "dist", "browser");
  return {
    bundle: resolve(editorRoot, "index.js"),
    css: resolve(editorRoot, "index.css"),
    fonts: resolve(editorRoot, "fonts"),
  };
}
