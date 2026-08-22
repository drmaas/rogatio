import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const useShell = process.platform === "win32";
function run(label: string, command: string, args: string[]): void {
  console.log(`\n[${label}]`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error)
    throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status === null)
    throw new Error(`${label} ended without an exit status`);
  if (result.status !== 0)
    throw new Error(`${label} failed with status ${result.status}`);
}
async function expectTypeFailure(
  label: string,
  fixture: string,
): Promise<void> {
  console.log(`\n[${label}]`);
  const result = spawnSync(
    pnpm,
    [
      "exec",
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      fixture,
    ],
    { cwd: root, stdio: "pipe", encoding: "utf8", shell: useShell },
  );
  if (result.error)
    throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status === null)
    throw new Error(`${label} ended without an exit status`);
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
  console.log(result.stderr || result.stdout);
}
async function checkArtifacts(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(resolve(root, "build-manifest.json"), "utf8"),
  ) as Record<string, { bytes: number }>;
  const expected = [
    "packages/smoke/dist/node/index.js",
    "packages/smoke/dist/browser/index.js",
    "packages/sanity/dist/node/index.js",
    "packages/schema/dist/node/index.js",
  ];
  if (
    expected.length !== Object.keys(manifest).length ||
    expected.some((artifact) => !(artifact in manifest))
  )
    throw new Error("Build manifest does not contain the expected artifacts");
  for (const [artifact, metadata] of Object.entries(manifest)) {
    if (metadata.bytes <= 0)
      throw new Error(`Empty artifact in manifest: ${artifact}`);
    await access(resolve(root, artifact));
  }
}
async function checkEmittedModules(): Promise<void> {
  const smoke = (await import(
    pathToFileURL(resolve(root, "packages/smoke/dist/node/index.js")).href
  )) as { composeSmokeMessage?: (name: string) => string };
  if (smoke.composeSmokeMessage?.("emitted") !== "emitted -> smoke")
    throw new Error("Smoke emitted Node module did not execute as expected");

  const sanity = (await import(
    pathToFileURL(resolve(root, "packages/sanity/dist/node/index.js")).href
  )) as { composeSanityMessage?: () => string };
  if (sanity.composeSanityMessage?.() !== "sanity -> smoke")
    throw new Error("Sanity emitted Node module did not execute as expected");

  const schema = (await import(
    pathToFileURL(resolve(root, "packages/schema/dist/node/index.js")).href
  )) as {
    validateProject?: (value: unknown) => boolean;
  };
  const project = {
    version: 1,
    name: "Emitted schema check",
    groups: [
      {
        id: "group-check",
        name: "Check",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule-check",
            name: "Check",
            urlRegex: "^https://example\\.com/",
            origins: [],
            resourceTypes: ["main_frame"],
            priority: 100,
          },
        ],
      },
    ],
  };
  if (schema.validateProject?.(project) !== true)
    throw new Error("Schema emitted Node module did not validate a project");
  if (schema.validateProject?.({ ...project, unexpected: true }) !== false)
    throw new Error("Schema emitted Node module accepted an unknown property");
}
async function checkBoundaries(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(resolve(root, "packages/sanity/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  if (manifest.dependencies?.["@rogatio/smoke"] !== "workspace:*")
    throw new Error("Sanity must declare its workspace dependency explicitly");
  const schemaManifest = JSON.parse(
    await readFile(resolve(root, "packages/schema/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  if (schemaManifest.dependencies?.ajv !== "8.17.1")
    throw new Error("Schema must declare its exact Ajv runtime dependency");
  const forbidden = await readFile(
    resolve(root, "test/fixtures/forbidden-direction.ts"),
    "utf8",
  );
  if (!forbidden.includes("@rogatio/compiler"))
    throw new Error("Forbidden-direction fixture was altered");
}
run("format", pnpm, ["format:check"]);
run("lint", pnpm, ["lint"]);
run("typecheck", pnpm, ["typecheck"]);
run("build", pnpm, ["build"]);
run("vitest", pnpm, ["exec", "vitest", "run"]);
await checkArtifacts();
await checkEmittedModules();
await checkBoundaries();
await expectTypeFailure(
  "invalid type fixture",
  "test/fixtures/invalid-type.ts",
);
await expectTypeFailure(
  "undeclared import fixture",
  "test/fixtures/undeclared-import.ts",
);
await expectTypeFailure(
  "forbidden direction fixture",
  "test/fixtures/forbidden-direction.ts",
);
run("playwright", pnpm, ["test:browser"]);
console.log("\nValidation completed successfully.");
