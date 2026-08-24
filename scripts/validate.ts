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
    "packages/schema/dist/node/index.js",
    "packages/schema/dist/browser/index.js",
    "packages/editor/dist/browser/index.js",
    "packages/sanity/dist/node/index.js",
    "packages/compiler/dist/node/index.js",
    "packages/browser-core/dist/node/index.js",
    "packages/cli/dist/node/index.js",
    "packages/dry-run/dist/node/index.js",
    "packages/extension/dist/browser/index.js",
    "packages/extension/dist/background.js",
    "packages/extension/dist/extension-page.js",
  ];
  if (
    expected.length !== Object.keys(manifest).length ||
    expected.some((artifact) => !(artifact in manifest))
  )
    throw new Error("Build manifest does not contain the expected artifacts");
  const extensionManifest = JSON.parse(
    await readFile(
      resolve(root, "packages/extension/dist/manifest.json"),
      "utf8",
    ),
  ) as {
    manifest_version?: number;
    background?: { service_worker?: string };
    action?: { default_popup?: string };
    permissions?: string[];
    optional_host_permissions?: string[];
    content_security_policy?: { extension_pages?: string };
  };
  if (
    extensionManifest.manifest_version !== 3 ||
    extensionManifest.background?.service_worker !== "background.js" ||
    extensionManifest.action?.default_popup !== "index.html" ||
    !extensionManifest.permissions?.includes("storage") ||
    JSON.stringify(extensionManifest.optional_host_permissions) !==
      JSON.stringify(["http://*/*", "https://*/*"]) ||
    extensionManifest.content_security_policy?.extension_pages !==
      "script-src 'self'; object-src 'self'"
  )
    throw new Error("Extension manifest does not meet the MV3 shell contract");
  for (const artifact of [
    "packages/extension/dist/background.js",
    "packages/extension/dist/extension-page.js",
  ]) {
    const contents = await readFile(resolve(root, artifact), "utf8");
    if (
      /new Function|eval\(|node:|process\.|Buffer|ajv|Ajv2020|@rogatio\//u.test(
        contents,
      )
    )
      throw new Error(
        `MV3 artifact contains a forbidden runtime dependency: ${artifact}`,
      );
  }
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

  const compiler = (await import(
    pathToFileURL(resolve(root, "packages/compiler/dist/node/index.js")).href
  )) as {
    compileProject?: (
      value: unknown,
    ) =>
      | { ok: true; operations: unknown[]; diagnostics: unknown[] }
      | { ok: false; operations: []; diagnostics: unknown[] };
  };
  const compiled = compiler.compileProject?.(project);
  if (!compiled?.ok || compiled.operations.length !== 1)
    throw new Error("Compiler emitted Node module did not compile a project");
  const rejected = compiler.compileProject?.({ ...project, unexpected: true });
  if (rejected?.ok !== false || rejected.operations.length !== 0)
    throw new Error(
      "Compiler emitted Node module accepted an unknown property",
    );

  const core = (await import(
    pathToFileURL(resolve(root, "packages/browser-core/dist/node/index.js"))
      .href
  )) as {
    ProjectRepository?: new (options: {
      storage: {
        read: () => Promise<unknown>;
        compareAndSwap: (previous: unknown, next: unknown) => Promise<boolean>;
      };
      generateId?: () => string;
      now?: () => number;
    }) => {
      createProject: (
        data: unknown,
        options?: { id?: string },
      ) => Promise<{ ok: boolean; value?: { id: string } }>;
      switchProject: (id: string) => Promise<{
        ok: boolean;
        value?: { activeProjectId: string | null };
      }>;
    };
    computeRuleStatuses?: (input: {
      operations: readonly unknown[];
      enabledGroupIds: readonly string[];
      grantedOrigins: readonly string[];
      installedRuleIds: readonly string[];
    }) => readonly { status: string }[];
    computeBadge?: (statuses: readonly { status: string }[]) => {
      text: string;
      attention: boolean;
    };
  };
  if (typeof core.ProjectRepository !== "function")
    throw new Error(
      "Browser-core emitted Node module did not export a repository",
    );
  const memory: { value: unknown } = { value: undefined };
  const repository = new core.ProjectRepository({
    storage: {
      read: async () => memory.value,
      compareAndSwap: async (previous, next) => {
        if (JSON.stringify(memory.value) !== JSON.stringify(previous))
          return false;
        memory.value = next;
        return true;
      },
    },
    generateId: () => "emitted-project",
    now: () => 1,
  });
  const created = await repository.createProject(project, {
    id: "emitted-project",
  });
  if (!created.ok || created.value?.id !== "emitted-project")
    throw new Error(
      "Browser-core emitted Node module did not create a project",
    );
  const switched = await repository.switchProject("emitted-project");
  if (!switched.ok || switched.value?.activeProjectId !== "emitted-project")
    throw new Error(
      "Browser-core emitted Node module did not switch the active project",
    );
  if (!compiled?.ok || typeof core.computeRuleStatuses !== "function")
    throw new Error("Browser-core emitted module needs compiler operations");
  const statuses = core.computeRuleStatuses({
    operations: compiled.operations,
    enabledGroupIds: [],
    grantedOrigins: [],
    installedRuleIds: [],
  });
  if (statuses.length !== 1 || statuses[0]?.status !== "disabled")
    throw new Error(
      "Browser-core emitted Node module computed unexpected rule statuses",
    );
  const badge = core.computeBadge?.(statuses);
  if (badge?.text !== "0" || badge.attention !== false)
    throw new Error(
      "Browser-core emitted Node module computed an unexpected badge",
    );

  const editor = (await import(
    pathToFileURL(resolve(root, "packages/editor/dist/browser/index.js")).href
  )) as {
    urlToExactRegex?: (value: string) => { ok: boolean; source?: string };
  };
  const converted = editor.urlToExactRegex?.("https://example.com/path");
  if (!converted?.ok || converted.source !== "^https://example\\.com/path$")
    throw new Error(
      "Editor emitted browser module did not execute as expected",
    );
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
  if ("@rogatio/compiler" in (schemaManifest.dependencies ?? {}))
    throw new Error("Schema must not depend on the compiler");
  const compilerManifest = JSON.parse(
    await readFile(resolve(root, "packages/compiler/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const compilerDependencies = compilerManifest.dependencies ?? {};
  if (
    Object.keys(compilerDependencies).length !== 1 ||
    compilerDependencies["@rogatio/schema"] !== "workspace:*"
  )
    throw new Error(
      "Compiler must depend only on the schema workspace package",
    );
  const extensionManifest = JSON.parse(
    await readFile(resolve(root, "packages/extension/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const extensionDependencies = extensionManifest.dependencies ?? {};
  if (
    Object.keys(extensionDependencies).length !== 4 ||
    extensionDependencies["@rogatio/browser-core"] !== "workspace:*" ||
    extensionDependencies["@rogatio/compiler"] !== "workspace:*" ||
    extensionDependencies["@rogatio/editor"] !== "workspace:*" ||
    extensionDependencies["@rogatio/schema"] !== "workspace:*"
  )
    throw new Error(
      "Extension must declare its four upstream workspace dependencies",
    );

  const browserCoreManifest = JSON.parse(
    await readFile(resolve(root, "packages/browser-core/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const browserCoreDependencies = browserCoreManifest.dependencies ?? {};
  if (
    Object.keys(browserCoreDependencies).length !== 2 ||
    browserCoreDependencies["@rogatio/schema"] !== "workspace:*" ||
    browserCoreDependencies["@rogatio/compiler"] !== "workspace:*"
  )
    throw new Error(
      "Browser-core must depend only on the schema and compiler workspace packages",
    );
  if ("@rogatio/browser-core" in (schemaManifest.dependencies ?? {}))
    throw new Error("Schema must not depend on browser-core");
  if ("@rogatio/browser-core" in compilerDependencies)
    throw new Error("Compiler must not depend on browser-core");
  const forbidden = await readFile(
    resolve(root, "test/fixtures/forbidden-direction.ts"),
    "utf8",
  );
  if (!forbidden.includes("@rogatio/extension"))
    throw new Error("Forbidden-direction fixture was altered");

  const editorManifest = JSON.parse(
    await readFile(resolve(root, "packages/editor/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const editorDependencies = editorManifest.dependencies ?? {};
  if (
    Object.keys(editorDependencies).length !== 2 ||
    editorDependencies["@rogatio/compiler"] !== "workspace:*" ||
    editorDependencies["@rogatio/schema"] !== "workspace:*"
  )
    throw new Error(
      "Editor must depend only on the schema and compiler packages",
    );

  const editorSources = await Promise.all(
    ["index.ts", "types.ts", "url.ts", "editor.ts"].map((file) =>
      readFile(resolve(root, "packages/editor/src", file), "utf8"),
    ),
  );
  const editorSource = editorSources.join("\n");
  if (
    /node:|process\.|Buffer|from ["'](?:fs|path|url)["']/.test(editorSource) ||
    /@rogatio\/(browser-core|extension|cli|runtime)/.test(editorSource)
  )
    throw new Error(
      "Editor source contains a forbidden runtime or downstream import",
    );

  const editorArtifact = await readFile(
    resolve(root, "packages/editor/dist/browser/index.js"),
    "utf8",
  );
  if (
    /node:|process\.|Buffer|from ["'](?:fs|path|url)["']/.test(
      editorArtifact,
    ) ||
    /@rogatio\/(browser-core|extension|cli|runtime)/.test(editorArtifact)
  )
    throw new Error(
      "Editor browser artifact contains a forbidden import or global",
    );
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
