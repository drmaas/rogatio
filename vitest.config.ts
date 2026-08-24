import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@rogatio/dry-run": resolve(
        __dirname,
        "packages/dry-run/dist/node/index.js",
      ),
      "@rogatio/compiler": resolve(
        __dirname,
        "packages/compiler/dist/node/index.js",
      ),
      "@rogatio/schema": resolve(
        __dirname,
        "packages/schema/dist/node/index.js",
      ),
      "@rogatio/editor": resolve(
        __dirname,
        "packages/editor/dist/browser/index.js",
      ),
      "@rogatio/runtime": resolve(
        __dirname,
        "packages/runtime/dist/node/index.js",
      ),
    },
  },
});
