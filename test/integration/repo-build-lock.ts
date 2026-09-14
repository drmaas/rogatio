import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lockDir = join(root, "node_modules/.cache/rogatio-repo-build.lock");

/**
 * Serialize pnpm build across integration files that share package dist dirs.
 * Concurrent esbuild writes race and produce empty/invalid ESM artifacts.
 */
export async function withRepoBuildLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - started > 120_000) {
        throw new Error("timed out waiting for repo build lock");
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
