import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const packageRoot = resolve(import.meta.dirname, "..");

export default defineConfig({
  resolve: {
    alias: {
      "@rogatio/schema": resolve(packageRoot, "schema/src/index.ts"),
      "@rogatio/compiler": resolve(packageRoot, "compiler/src/index.ts"),
      "@rogatio/browser-core": resolve(
        packageRoot,
        "browser-core/src/index.ts",
      ),
      "@rogatio/editor": resolve(packageRoot, "editor/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: false,
  },
});
