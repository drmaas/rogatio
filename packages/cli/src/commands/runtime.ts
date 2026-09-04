import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import {
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
       rogatio runtime host [path]

Native messaging runtime control for response-body and request-body rules. The
runtime no longer serves an HTTP mock server; mock delivery happens in the
consolidated native-messaging host (spec REQ-001..REQ-005).

Request-body trust commands:
  install   Install the native-messaging host manifest (requires --extension-id)
  trust     Provision and trust the device-local CA
  untrust   Remove the device-local CA trust (idempotent)
  uninstall Uninstall the native-messaging host manifest (idempotent)

Native host command:
  host [path]  Run the consolidated native-messaging runtime host. The browser
               launches this process via the native-messaging manifest; it reads
               pairing/authorization/mock envelopes from stdin and writes
               responses to stdout.

The lifecycle of the runtime (start/stop) is driven from the extension's
Start/Stop controls, not the CLI. Run 'rogatio runtime install --extension-id
<id>' once to register the host, then use the extension.

Options:
  --extension-id    Extension ID for native messaging manifest (required for install)
  --root <dir>      Root for confined file mocks (default: project directory)
  --help, -h        Show this help

The device-local CA / PAC routing capability only affects request-body
interception, not the host control plane.`);
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
  args: ["install" | "trust" | "untrust" | "uninstall" | "host", ...string[]],
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
  if (first === "host") return runtimeHostCommand(args.slice(1));

  console.error(
    `Error: 'rogatio runtime' no longer starts or stops the runtime. Use 'rogatio runtime install|trust|untrust|uninstall' to manage the host manifest and request-body trust, or 'rogatio runtime host [path]' to run the native-messaging host. Start/stop is driven from the extension's controls.`,
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
