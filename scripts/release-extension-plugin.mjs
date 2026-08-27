import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "packages/extension");
const distDir = resolve(extensionDir, "dist");
const zipPath = resolve(distDir, "rogatio-extension.zip");

/**
 * semantic-release plugin (F20): stamps the extension package with the release
 * version and produces the unsigned MV3 ZIP attached to the GitHub Release.
 * Runs during the `prepare` phase after the monorepo build has emitted dist/.
 */
export default {
  async prepare(_config, context) {
    const version = context.nextRelease?.version;
    if (!version) return;

    const pkgPath = resolve(extensionDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    if (!existsSync(distDir)) {
      throw new Error(`Extension dist missing: ${distDir}`);
    }
    if (existsSync(zipPath)) rmSync(zipPath);

    execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], {
      cwd: distDir,
      stdio: "inherit",
    });
    context.logger?.log(`Built extension ZIP: ${zipPath}`);
  },
};
