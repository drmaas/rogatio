import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import {
  createNativeRuntimeController,
  createRequestBodyTrustController,
  defaultTrustInstallRoot,
  normalizeRuntimePreset,
  RUNTIME_LIMITS,
  type RuntimeMockConfig,
  runNativeHost,
} from "@rogatio/runtime";
import { validateProjectDetailed } from "@rogatio/schema";
import { readProject } from "../utils/file.js";

export interface RuntimeCommandResult {
  exitCode: Promise<number>;
  shutdown: () => void;
}

function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime <command> [options]

Native messaging runtime control for response-body and request-body rules.

Native runtime commands:
  start     Start the runtime (explicit, no auto-start)
  stop      Stop the runtime (idempotent)
  status    Show the current runtime and trust state

Request-body trust commands:
  install   Install the native-messaging host manifest
             Requires --extension-id <32-char-id>
  trust     Provision and trust the device-local CA
  untrust   Remove the device-local CA trust (idempotent)
  uninstall Uninstall the native-messaging host manifest (idempotent)

Native host command:
  runtime-host [path]  Run the consolidated native-messaging runtime host,
                       reading pairing/authorization/mock envelopes from stdin
                       and writing responses to stdout. This process is what the
                       browser launches via the native-messaging manifest.

Options:
  --extension-id    Extension ID for native messaging manifest (required for install)
  --root <dir>      Root for confined file mocks (default: project directory)
  --help, -h        Show this help

The native runtime activates unconditionally once started (spec REQ-004); the
device-local CA / PAC routing capability only affects request-body interception,
not the host control plane.`);
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

async function nativeRuntimeCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  const controller = createNativeRuntimeController({
    preset: await loadControlPreset(),
  });

  switch (subcommand) {
    case "start": {
      const result = await controller.start();
      if (result.state === "running") {
        console.log("runtime started");
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
  let extensionId: string | undefined;

  if (subcommand === "install") {
    const extIdIndex = args.indexOf("--extension-id");
    if (extIdIndex === -1 || extIdIndex + 1 >= args.length) {
      console.error("Error: --extension-id is required for install command");
      showRuntimeHelp();
      return 2;
    }
    extensionId = args[extIdIndex + 1];

    if (!/^[a-p]{32}$/.test(extensionId)) {
      console.error(
        "Error: --extension-id must be exactly 32 lowercase characters from a through p",
      );
      return 2;
    }
  }

  const controller = makeTrustController();
  switch (subcommand) {
    case "install":
      return reportTrust(
        "install",
        await controller.install(extensionId ?? ""),
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
  console.log(
    `runtime ${createNativeRuntimeController({ preset: await loadControlPreset() }).status().state}`,
  );
  console.log(`trust installed: ${status.installed}`);
  console.log(`trust established: ${status.trusted}`);
  if (!status.installed || !status.trusted) {
    console.error(
      `trust unsupported: ${(status.capabilityReasons ?? ["unknown"]).join(", ")}`,
    );
  }
  return 0;
}

async function loadControlPreset() {
  const { normalizeRuntimePreset } = await import("@rogatio/runtime");
  const result = normalizeRuntimePreset({
    version: 1,
    limits: RUNTIME_LIMITS,
    matchers: [],
    grants: [],
  });
  if (!result.ok) throw new Error("Failed to build control preset");
  return result.value;
}

async function runtimeHostCommand(args: string[]): Promise<number> {
  let root: string | undefined;
  let mockPort: number | undefined;
  const positional: string[] = [];
  let argumentError: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root" && index + 1 < args.length) {
      root = resolve(args[++index]);
    } else if (arg === "--root") {
      argumentError = "--root requires a value";
    } else if (arg === "--mock-port" && index + 1 < args.length) {
      const parsed = Number(args[++index]);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        argumentError = "--mock-port must be an integer port in 1..65535";
      } else {
        mockPort = parsed;
      }
    } else if (arg === "--mock-port") {
      argumentError = "--mock-port requires a value";
    } else if (arg === "-" || !arg.startsWith("-")) {
      positional.push(arg);
    } else {
      argumentError = `Unknown option: ${arg}`;
    }
  }

  if (argumentError) {
    console.error(`Error: ${argumentError}`);
    return 2;
  }

  const inputPath = positional[0];
  let filePath: string;
  let projectData: unknown;
  try {
    if (inputPath === "-") {
      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      }
      filePath = "<stdin>";
      projectData = JSON.parse(chunks.join(""));
    } else {
      filePath = inputPath
        ? resolve(inputPath)
        : resolve(process.cwd(), ".rogatio.json");
      projectData = await readProject(filePath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error: ${message}`);
    return 2;
  }

  const schemaResult = validateProjectDetailed(projectData);
  if (!schemaResult.valid) {
    for (const issue of schemaResult.errors) {
      console.error(
        `${issue.instancePath || "/"}/: ${issue.message} (schema.${issue.keyword})`,
      );
    }
    return 1;
  }
  const compileResult = compileProject(schemaResult.data);
  if (!compileResult.ok) {
    for (const diagnostic of compileResult.diagnostics) {
      console.error(
        `${diagnostic.path}: ${diagnostic.message} (${diagnostic.code})`,
      );
    }
    return 1;
  }

  const rootDir =
    root ?? (inputPath === "-" ? process.cwd() : dirname(filePath));
  const mocksResult = buildMockConfigs(compileResult.operations, rootDir);
  if (!mocksResult.ok) {
    console.error(`Error: ${mocksResult.message}`);
    return 1;
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
    return 2;
  }

  await runNativeHost({
    preset: normalized.value,
    fileRoot: rootDir,
    ...(mockPort !== undefined ? { mockPort } : {}),
    onReady: () => console.error("rogatio runtime-host active"),
  });
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
): Promise<number | RuntimeCommandResult>;
export function runtimeCommand(
  args: string[],
  options?: { stdinInput?: string },
): Promise<number | RuntimeCommandResult>;

export async function runtimeCommand(
  args: string[],
  _options: { stdinInput?: string } = {},
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
  if (first === "runtime-host") return runtimeHostCommand(args.slice(1));

  console.error(
    `Error: 'rogatio runtime' no longer starts an HTTP mock server. Use 'rogatio runtime-host [path]' to run the native-messaging host, or one of: start, stop, status, install, trust, untrust, uninstall.`,
  );
  showRuntimeHelp();
  return 2;
}

/**
 * Native-messaging host entry point. The browser launches the manifest's
 * `runtime-host` executable directly (no subcommand); this routes the process
 * to the runtime host, reading the project from the conventional path.
 */
export async function runRuntimeHostEntry(): Promise<void> {
  const code = await runtimeHostCommand(process.argv.slice(2));
  process.exitCode = code;
}
