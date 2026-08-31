import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { editorAssetPaths, isDistBuild } from "../src/utils/asset-paths.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

describe("editorAssetPaths", () => {
  it("isDistBuild detects the published dist layout", () => {
    expect(isDistBuild("/repo/packages/cli/dist/node"), "forward slashes").toBe(
      true,
    );
    expect(
      isDistBuild("/repo/packages/cli/src"),
      "src layout is not dist",
    ).toBe(false);
    expect(
      isDistBuild("C:\\repo\\packages\\cli\\dist\\node"),
      "backslashes (Windows)",
    ).toBe(true);
    expect(
      isDistBuild("/repo/dist/node"),
      "any /dist/ in the path counts",
    ).toBe(true);
  });

  it("resolves the dist-layout editor bundle to packages/cli/dist/editor/", () => {
    const paths = editorAssetPaths(`${repoRoot}/packages/cli/dist/node`);
    expect(paths.bundle).toBe(`${repoRoot}/packages/cli/dist/editor/index.js`);
    expect(paths.css).toBe(`${repoRoot}/packages/cli/dist/editor/index.css`);
    expect(paths.fonts).toBe(`${repoRoot}/packages/cli/dist/editor/fonts`);
  });

  it("resolves the src-layout editor bundle to packages/editor/dist/browser/", () => {
    const paths = editorAssetPaths(`${repoRoot}/packages/cli/src/commands`);
    expect(paths.bundle).toBe(
      `${repoRoot}/packages/editor/dist/browser/index.js`,
    );
    expect(paths.css).toBe(
      `${repoRoot}/packages/editor/dist/browser/index.css`,
    );
    expect(paths.fonts).toBe(`${repoRoot}/packages/editor/dist/browser/fonts`);
  });
});
