import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const useShell = process.platform === "win32";

interface PackageManifest {
  readonly name?: string;
  readonly private?: boolean;
}

function publishablePackages(): { directory: string; name: string }[] {
  const packagesRoot = join(root, "packages");
  return readdirSync(packagesRoot)
    .filter((name) => existsSync(join(packagesRoot, name, "package.json")))
    .sort()
    .flatMap((name) => {
      const directory = join(packagesRoot, name);
      const manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      ) as PackageManifest;
      if (manifest.private === true) return [];
      return [
        {
          directory,
          name: typeof manifest.name === "string" ? manifest.name : name,
        },
      ];
    });
}

function run(
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, ["exec", ...args], {
      cwd,
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: output.trim() });
    });
  });
}

const packages = publishablePackages();
if (packages.length === 0) {
  console.error("No publishable packages found.");
  process.exit(1);
}

const failures: string[] = [];
for (const pkg of packages) {
  const publint = await run(["publint", "--strict"], pkg.directory);
  if (publint.code !== 0) {
    failures.push(`${pkg.name}: publint --strict failed\n${publint.output}`);
  }
  // The published CLI is ESM-only (`"type": "module"`, no require condition).
  // attw's esm-only profile still checks node10, node16 (CJS and ESM), and
  // bundler, and ignores the expected CJS-resolves-to-ESM result.
  const attw = await run(
    ["attw", "--pack", ".", "--profile", "esm-only"],
    pkg.directory,
  );
  if (attw.code !== 0) {
    failures.push(`${pkg.name}: attw --pack failed\n${attw.output}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(
  `publint --strict and attw --pack passed for ${packages.length} publishable package(s): ${packages.map((pkg) => pkg.name).join(", ")}.`,
);
