import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import {
  createNativeRuntimeController,
  createRequestBodyTrustController,
  createRuntimeServer,
  defaultTrustInstallRoot,
  normalizeRuntimePreset,
  RUNTIME_LIMITS,
  type RuntimeMockConfig,
  type RuntimeServer,
} from "@rogatio/runtime";
import { validateProjectDetailed } from "@rogatio/schema";
import { readProject } from "../utils/file.js";

const DEFAULT_PORT = 8890;

export interface RuntimeCommandResult {
  exitCode: Promise<number>;
  shutdown: () => void;
}

function noopShutdown(): void {}

function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime <command> [options]
       rogatio runtime [options] [path]

Native messaging runtime control for response-body and request-body rules, or
start the local mock runtime for F13 mock rules.

Native runtime commands:
  start     Start the runtime (capability-gated; explicit, no auto-start)
  stop      Stop the runtime (idempotent)
  status    Show the current runtime and trust state

Request-body trust commands:
  install   Install the native-messaging host manifest (capability-gated)
  trust     Provision and trust the device-local CA (capability-gated)
  untrust   Remove the device-local CA trust (idempotent)
  uninstall Uninstall the native-messaging host manifest (idempotent)

Mock runtime arguments:
  path      Path to .rogatio.json (default: .rogatio.json in current directory)
            Use '-' to read project JSON from stdin

Options:
  --port <n>      Port for the mock runtime (default: 8890; use 0 for ephemeral)
  --root <dir>    Root for confined file mocks (default: project directory)
  --help, -h      Show this help

The native runtime activates only where a trusted device-local CA can be provisioned
and Chrome PAC routing does not collide with an existing controlling proxy/PAC/extension
or enterprise policy. On incapable platforms 'start' reports 'unsupported'.
The mock runtime prints connection instructions; open the extension and click
"Check and connect" to install mock rules.`);
}

function toMatcherOperations(
  operations: readonly RogatioOperation[],
): MatcherOperation[] {
  return operations.map(({ groupId, ruleId, matcher }) => ({
    kind: "matcher",
    groupId,
    ruleId,
    matcher,
  }));
}

function resolveMockFile(root: string, filePath: string): string | null {
  if (filePath.includes("\0")) return null;
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  const logical = rel.split(sep).join("/");
  return logical.length === 0 ? null : logical;
}

function buildMockConfigs(
  operations: readonly RogatioOperation[],
  root: string,
): { ok: true; value: RuntimeMockConfig[] } | { ok: false; message: string } {
  const configs: RuntimeMockConfig[] = [];
  for (const operation of operations) {
    if (operation.kind !== "mock") continue;
    const mock = operation.mock;
    let file: string | undefined;
    if (mock.file !== undefined) {
      const resolved = resolveMockFile(root, mock.file);
      if (resolved === null) {
        return {
          ok: false,
          message: `Mock rule "${operation.ruleId}" file "${mock.file}" resolves outside the configured root (${root}).`,
        };
      }
      file = resolved;
    }
    configs.push({
      ruleId: operation.ruleId,
      status: mock.status,
      ...(mock.headers !== undefined ? { headers: mock.headers } : {}),
      ...(mock.delayMs !== undefined ? { delayMs: mock.delayMs } : {}),
      ...(mock.body !== undefined ? { body: mock.body } : {}),
      ...(file !== undefined ? { file } : {}),
    });
  }
  return { ok: true, value: configs };
}

function looksLikeProjectPath(value: string): boolean {
  return (
    value === "-" ||
    value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.endsWith(".json")
  );
}

async function nativeRuntimeCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  const controller = createNativeRuntimeController();

  switch (subcommand) {
    case "start": {
      const result = await controller.start();
      if (result.state === "running") {
        console.log("runtime started");
        return 0;
      }
      if (result.state === "unsupported") {
        console.error(
          `runtime unsupported: ${(result.reasons ?? ["unknown"]).join(", ")}`,
        );
        return 0;
      }
      console.error(`runtime start failed: ${result.state}`);
      return 1;
    }
    case "stop": {
      const result = await controller.stop();
      console.log(`runtime ${result.state}`);
      return 0;
    }
    case "status": {
      console.log(`runtime ${controller.status().state}`);
      return 0;
    }
    default: {
      console.error(`Error: unknown runtime subcommand: ${subcommand ?? ""}`);
      showRuntimeHelp();
      return 2;
    }
  }
}

function makeTrustController() {
  const platform = process.platform;
  const installRoot = defaultTrustInstallRoot(platform);
  return createRequestBodyTrustController({
    platform,
    installRoot,
    hostPath: join(installRoot, "runtime-host"),
    hostName: "com.rogatio.runtime",
    allowedOrigins: [],
  });
}

function reportTrust(
  subcommand: string,
  result: { ok: boolean; state: string; reasons?: readonly string[] },
  okMessage: string,
): number {
  if (result.ok) {
    console.log(okMessage);
    return 0;
  }
  if (result.state === "unsupported") {
    console.error(
      `trust unsupported: ${(result.reasons ?? ["unknown"]).join(", ")}`,
    );
    return 0;
  }
  console.error(
    `trust ${subcommand} failed: ${(result.reasons ?? ["unknown"]).join(", ")}`,
  );
  return 1;
}

async function trustRuntimeCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  const controller = makeTrustController();
  switch (subcommand) {
    case "install":
      return reportTrust(
        "install",
        await controller.install(),
        "trust installed",
      );
    case "trust":
      return reportTrust(
        "trust",
        await controller.trust(),
        "trust established",
      );
    case "untrust":
      return reportTrust(
        "untrust",
        await controller.untrust(),
        "trust removed",
      );
    case "uninstall":
      return reportTrust(
        "uninstall",
        await controller.uninstall(),
        "trust manifest uninstalled",
      );
    default:
      console.error(`Error: unknown runtime subcommand: ${subcommand ?? ""}`);
      showRuntimeHelp();
      return 2;
  }
}

async function runtimeStatusCommand(_args: string[]): Promise<number> {
  const controller = makeTrustController();
  const status = await controller.status();
  console.log(`runtime ${createNativeRuntimeController().status().state}`);
  console.log(`trust installed: ${status.installed}`);
  console.log(`trust established: ${status.trusted}`);
  if (!status.installed || !status.trusted) {
    console.error(
      `trust unsupported: ${(status.capabilityReasons ?? ["unknown"]).join(", ")}`,
    );
  }
  return 0;
}

export function runtimeCommand(
  args: ["start" | "stop" | "status", ...string[]],
  options?: { stdinInput?: string },
): Promise<number>;
export function runtimeCommand(
  args: ["--help" | "-h", ...string[]],
  options?: { stdinInput?: string },
): Promise<number>;
export function runtimeCommand(
  args: [string, ...string[]],
  options?: { stdinInput?: string },
): Promise<RuntimeCommandResult>;
export function runtimeCommand(
  args: string[],
  options?: { stdinInput?: string },
): Promise<number | RuntimeCommandResult>;
export async function runtimeCommand(
  args: string[],
  options: { stdinInput?: string } = {},
): Promise<number | RuntimeCommandResult> {
  if (args.includes("--help") || args.includes("-h")) {
    showRuntimeHelp();
    return 0;
  }

  const first = args[0];
  if (
    first === "install" ||
    first === "trust" ||
    first === "untrust" ||
    first === "uninstall"
  )
    return trustRuntimeCommand(args);
  if (first === "status") return runtimeStatusCommand(args);
  if (first === "start" || first === "stop") return nativeRuntimeCommand(args);
  if (
    first !== undefined &&
    !first.startsWith("-") &&
    !looksLikeProjectPath(first)
  )
    return nativeRuntimeCommand(args);

  let port = DEFAULT_PORT;
  let root: string | undefined;
  const positional: string[] = [];
  let argumentError: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" && index + 1 < args.length) {
      port = Number(args[++index]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        argumentError = "--port must be an integer between 0 and 65535";
      }
    } else if (arg === "--root" && index + 1 < args.length) {
      root = resolve(args[++index]);
    } else if (arg === "--port" || arg === "--root") {
      argumentError = `${arg} requires a value`;
    } else if (arg === "-" || !arg.startsWith("-")) {
      positional.push(arg);
    } else {
      argumentError = `Unknown option: ${arg}`;
    }
  }

  if (argumentError) {
    console.error(`Error: ${argumentError}`);
    return { exitCode: Promise.resolve(2), shutdown: noopShutdown };
  }
  if (positional.length > 1) {
    console.error("Error: Too many arguments");
    return { exitCode: Promise.resolve(2), shutdown: noopShutdown };
  }

  const inputPath = positional[0];
  let filePath: string;
  let projectData: unknown;
  try {
    if (inputPath === "-") {
      if (!options.stdinInput) throw new Error("No stdin input provided");
      filePath = "<stdin>";
      projectData = JSON.parse(options.stdinInput);
    } else {
      filePath = inputPath
        ? resolve(inputPath)
        : resolve(process.cwd(), ".rogatio.json");
      projectData = await readProject(filePath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error: ${message}`);
    return { exitCode: Promise.resolve(2), shutdown: noopShutdown };
  }

  const schemaResult = validateProjectDetailed(projectData);
  if (!schemaResult.valid) {
    for (const issue of schemaResult.errors) {
      console.error(
        `${issue.instancePath || "/"}: ${issue.message} (schema.${issue.keyword})`,
      );
    }
    return { exitCode: Promise.resolve(1), shutdown: noopShutdown };
  }
  const compileResult = compileProject(schemaResult.data);
  if (!compileResult.ok) {
    for (const diagnostic of compileResult.diagnostics) {
      console.error(
        `${diagnostic.path}: ${diagnostic.message} (${diagnostic.code})`,
      );
    }
    return { exitCode: Promise.resolve(1), shutdown: noopShutdown };
  }

  const rootDir =
    root ?? (inputPath === "-" ? process.cwd() : dirname(filePath));
  const mocksResult = buildMockConfigs(compileResult.operations, rootDir);
  if (!mocksResult.ok) {
    console.error(`Error: ${mocksResult.message}`);
    return { exitCode: Promise.resolve(1), shutdown: noopShutdown };
  }

  const normalized = normalizeRuntimePreset({
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: toMatcherOperations(compileResult.operations),
    grants: [],
    ...(mocksResult.value.length > 0 ? { mocks: mocksResult.value } : {}),
  });
  if (!normalized.ok) {
    console.error("Error: Failed to build runtime preset");
    return { exitCode: Promise.resolve(2), shutdown: noopShutdown };
  }

  let server: RuntimeServer;
  try {
    const result = await createRuntimeServer({
      preset: normalized.value,
      fileRoot: rootDir,
      port,
    });
    if (!result.ok) throw new Error(result.error.code);
    server = result.value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "startup failed";
    console.error(
      `Error: Failed to start mock runtime on port ${port} (${detail})`,
    );
    return { exitCode: Promise.resolve(2), shutdown: noopShutdown };
  }

  console.log(
    `Rogatio mock runtime listening on http://127.0.0.1:${server.bootstrap.port}`,
  );
  console.log(`Project digest: ${server.bootstrap.presetDigest}`);
  console.log(`Mock rules: ${mocksResult.value.length}`);
  console.log(
    'Open the extension and click "Check and connect" to install mock rules.',
  );
  console.log("Press Ctrl+C to stop.");

  let shutdownCalled = false;
  let resolveExit!: (code: number) => void;
  const exitCode = new Promise<number>((resolvePromise) => {
    resolveExit = resolvePromise;
  });
  const handleSignal = () => shutdown();
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  function shutdown(): void {
    if (shutdownCalled) return;
    shutdownCalled = true;
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    server.stop().then(
      () => resolveExit(0),
      () => resolveExit(0),
    );
  }

  return { exitCode, shutdown };
}
