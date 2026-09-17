import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    name: "browser",
    environment: "node",
    include: ["test/browser/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: [resolve(root, "test/browser/global-setup.ts")],
    // Avoid unit/integration setup that assumes package dist aliases only.
    setupFiles: [],
  },
});
