import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: false,
    setupFiles: [resolve(root, "test/setup.ts")],
    projects: [
      {
        // Vitest 4 inline projects do not inherit the root config (including
        // `resolve.alias`) unless they opt in.
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts"],
          setupFiles: [resolve(root, "test/setup.ts")],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["test/integration/**/*.test.ts"],
          setupFiles: [resolve(root, "test/setup.ts")],
          // Integration suites each invoke `pnpm build`; parallel file runs
          // race on dist artifacts and fail spuriously under validate.
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@rogatio/dry-run": resolve(root, "packages/dry-run/dist/node/index.js"),
      "@rogatio/compiler": resolve(
        root,
        "packages/compiler/dist/node/index.js",
      ),
      "@rogatio/schema": resolve(root, "packages/schema/dist/node/index.js"),
      "@rogatio/editor": resolve(root, "packages/editor/dist/browser/index.js"),
      "@rogatio/runtime": resolve(root, "packages/runtime/dist/node/index.js"),
    },
  },
});
