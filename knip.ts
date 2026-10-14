import type { KnipConfig } from "knip";

/**
 * Workspace entries knip cannot see from package.json alone:
 * - CLI bin compiles from src/index.ts to dist/node/index.js.
 * - Extension manifest and HTML pages load the built background, popup, and
 *   management scripts, plus their stylesheets.
 * - The schema browser bundle is a second entry beside package exports.
 * - Browser journeys live in vitest.browser.config.ts, not vitest.config.ts.
 * - scripts/ and the basic sample are invoked directly.
 */
const config: KnipConfig = {
  ignore: [
    // Negative fixtures are outside typecheck on purpose and must keep failing.
    "test/fixtures/**",
  ],
  ignoreBinaries: [
    // Windows trust installation shells out to these system tools.
    "where",
    "certutil",
    // POSIX FIFO helper used by the runtime mock test.
    "mkfifo",
    // Release checksum test calls the system hash tool.
    "sha256sum",
  ],
  ignoreDependencies: [
    // scripts/check-exports.ts spawns these CLIs; it does not import them.
    "publint",
    "@arethetypeswrong/cli",
    // test/integration/packaged-cli.test.ts resolves this dynamically while
    // packing the published CLI. Nothing imports it from TypeScript.
    "@peculiar/x509",
  ],
  ignoreIssues: {
    // MOCK_GUARD_ID is the top of the mock-redirect id band, so it aliases
    // MOCK_REDIRECT_ID_MAX. Both names are part of the rule-id contract.
    "packages/extension/src/mock-redirect-ids.ts": ["duplicates"],
    // esbuild aliases @rogatio/schema to this module for the whole extension
    // bundle, including browser-core, compiler, and dry-run. Knip only sees
    // imports written in the extension workspace.
    "packages/extension/src/browser-schema.ts": ["exports", "types"],
  },
  workspaces: {
    ".": {
      entry: [
        "scripts/*.{ts,mjs}",
        "samples/basic/validate-server.mjs",
        // vitest.browser.config.ts is picked up by the Vitest plugin, including
        // its globalSetup. Test files under test/browser/ are not in the root
        // vitest.config.ts include list.
        "test/browser/**/*.test.ts",
      ],
    },
    "packages/cli": {
      entry: ["src/index.ts"],
      // esbuild externalizes ajv and koffi into the published bundle. The
      // editor is hosted as a copied browser bundle plus an import map, not
      // as a TypeScript import.
      ignoreDependencies: ["ajv", "koffi", "@rogatio/editor"],
    },
    "packages/editor": {
      entry: ["src/editor.css"],
      // scripts/validate.ts requires this edge. The editor receives compiler
      // diagnostics through the host validator and does not import it.
      ignoreDependencies: ["@rogatio/compiler"],
    },
    "packages/extension": {
      entry: [
        // manifest background.service_worker → dist/background.js
        "src/background.ts",
        // popup.html → dist/popup.js
        "src/popup.ts",
        "src/popup.css",
        // index.html → dist/extension-page.js and extension-page.css
        "src/extension-page-entry.ts",
        "src/extension.css",
      ],
      // The extension build aliases @rogatio/schema to this browser-safe mirror.
      paths: {
        "@rogatio/schema": ["src/browser-schema.ts"],
      },
    },
    "packages/schema": {
      // esbuild browser target; not listed in package.json exports.
      entry: ["src/browser-index.ts"],
    },
    "packages/docs-site": {
      // `astro check` wants @astrojs/check, whose peer range stops at
      // TypeScript 6. This repo pins TypeScript 7, so the package stays out.
      ignoreDependencies: ["@astrojs/check"],
    },
  },
};

export default config;
