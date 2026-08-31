import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(import.meta.dirname, "..");
const bundlePath = resolve(cliRoot, "dist", "node", "index.js");
const editorBundlePath = resolve(cliRoot, "dist", "editor", "index.js");
const editorCssPath = resolve(cliRoot, "dist", "editor", "index.css");
const editorFontsPath = resolve(cliRoot, "dist", "editor", "fonts");

describe("bundled CLI editor asset paths", () => {
  it("resolves editor assets relative to dist/node, not via @rogatio/editor", async () => {
    const bundle = await readFile(bundlePath, "utf8");

    expect(
      bundle,
      "bundled cli must not call import.meta.resolve('@rogatio/editor') at runtime",
    ).not.toMatch(/import\.meta\.resolve\(\s*["']@rogatio\/editor["']/u);

    expect(
      bundle,
      "bundled cli must derive editor assets from a path relative to its own dist location",
    ).toMatch(/["']editor["']/u);
  });

  it("ships the in-place editor bundle, css, and fonts next to dist/node", async () => {
    const bundle = await readFile(editorBundlePath, "utf8");
    expect(bundle.length).toBeGreaterThan(0);
    expect(
      bundle,
      "bundled cli dist/editor/index.js must be the editor browser bundle (contains @rogatio-free source-mapped paths)",
    ).toMatch(/packages\/schema\/dist\/browser\/index\.js/u);
    const css = await readFile(editorCssPath, "utf8");
    expect(css).toContain(".rogatio-editor");

    const { readdir, stat } = await import("node:fs/promises");
    const fonts = await readdir(editorFontsPath);
    const woffFiles = fonts.filter((f) => f.endsWith(".woff2"));
    expect(
      woffFiles.length,
      "bundled cli must ship at least one .woff2 font under dist/editor/fonts/",
    ).toBeGreaterThan(0);
    for (const font of woffFiles) {
      const fileStat = await stat(resolve(editorFontsPath, font));
      expect(fileStat.size).toBeGreaterThan(0);
    }
  });
});
