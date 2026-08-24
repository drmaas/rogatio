import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@rogatio/dry-run": resolve(__dirname, "../dry-run/dist/node/index.js"),
      "@rogatio/compiler": resolve(__dirname, "../compiler/dist/node/index.js"),
      "@rogatio/schema": resolve(__dirname, "../schema/dist/node/index.js"),
    },
  },
});
