import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "packages/extension");
const distDir = resolve(extensionDir, "dist");
const zipName = "rogatio-extension.zip";
const zipPath = resolve(distDir, zipName);
const checksumPath = resolve(distDir, `${zipName}.sha256`);

/**
 * GNU `sha256sum` text-mode line: 64 lowercase hex digits, two spaces, the
 * file name, and a trailing newline. `sha256sum -c` accepts this when the
 * named file sits next to the checksum file.
 *
 * @param {Uint8Array} contents
 * @param {string} filename
 * @returns {string}
 */
export function sha256sumLine(contents, filename) {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    /[\r\n]/.test(filename)
  ) {
    throw new Error("Checksum filename must be a non-empty single line");
  }
  const hash = createHash("sha256").update(contents).digest("hex");
  return `${hash}  ${filename}\n`;
}

/**
 * semantic-release plugin (F20): stamps the extension package with the release
 * version and produces the unsigned MV3 ZIP attached to the GitHub Release,
 * plus a `sha256sum` checksum of that ZIP. Runs during the `prepare` phase
 * after the monorepo build has emitted dist/.
 */
export default {
  async prepare(_config, context) {
    const version = context.nextRelease?.version;
    if (!version) return;

    const pkgPath = resolve(extensionDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const manifestPath = resolve(distDir, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.version = version;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    if (!existsSync(distDir)) {
      throw new Error(`Extension dist missing: ${distDir}`);
    }
    if (existsSync(zipPath)) rmSync(zipPath);

    execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], {
      cwd: distDir,
      stdio: "inherit",
    });
    writeFileSync(checksumPath, sha256sumLine(readFileSync(zipPath), zipName));
    context.logger?.log(`Built extension ZIP: ${zipPath}`);
    context.logger?.log(`Wrote extension checksum: ${checksumPath}`);
  },
};
