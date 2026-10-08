import { resolve } from "node:path";
import {
  DOCTOR_PAC_TIMEOUT_MS,
  type DoctorProjectRead,
  type DoctorReport,
  formatDoctorReport,
  type InstalledDoctorOptions,
  RELEASE_EXTENSION_ID,
  runInstalledDoctor,
  serializeDoctorReport,
  type VerifyResult,
} from "@rogatio/runtime";
import { showDoctorHelp } from "../help.js";
import {
  createJsonFileProjectStorage,
  type ProjectStorage,
  ProjectStorageError,
} from "../utils/file.js";
import { readCliVersion } from "../version.js";

export interface DoctorCommandOptions {
  readonly cwd?: string;
  readonly storage?: ProjectStorage;
  readonly nodeVersion?: string;
  readonly cliVersion?: string;
  readonly fetchLatestVersion?: InstalledDoctorOptions["fetchLatestVersion"];
  readonly verifyInstall?: () => Promise<VerifyResult>;
  readonly probePac?: InstalledDoctorOptions["probePac"];
  readonly testAi?: InstalledDoctorOptions["testAi"];
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

function fail(options: DoctorCommandOptions, message: string): number {
  const write = options.stderr ?? ((text: string) => console.error(text));
  write(message);
  return 2;
}

function parseExtensionId(
  args: readonly string[],
  index: number,
): { extensionId: string; next: number } | { error: string } {
  const extensionId = args[index + 1];
  if (extensionId === undefined || extensionId.startsWith("-")) {
    return { error: "Error: --extension-id requires a value" };
  }
  if (!/^[a-p]{32}$/.test(extensionId)) {
    return {
      error:
        "Error: --extension-id must be exactly 32 lowercase characters from a through p",
    };
  }
  return { extensionId, next: index + 1 };
}

function mapReadError(error: unknown): DoctorProjectRead {
  if (error instanceof ProjectStorageError) {
    if (error.code === "not-found") return { ok: false, reason: "missing" };
    if (error.code === "invalid-json" || error.code === "invalid-format") {
      return { ok: false, reason: "parse" };
    }
  }
  return { ok: false, reason: "unreadable" };
}

export async function doctorCommand(
  args: string[],
  options: DoctorCommandOptions = {},
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showDoctorHelp();
    return 0;
  }

  let jsonOutput = false;
  let checkUpdates = false;
  let extensionId = RELEASE_EXTENSION_ID;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }
    if (arg === "--check-updates") {
      checkUpdates = true;
      continue;
    }
    if (arg === "--extension-id") {
      const parsed = parseExtensionId(args, index);
      if ("error" in parsed) return fail(options, parsed.error);
      extensionId = parsed.extensionId;
      index = parsed.next;
      continue;
    }
    if (arg === undefined || arg.startsWith("-")) {
      return fail(options, `Error: Unknown option: ${arg ?? ""}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    return fail(options, "Error: Too many arguments");
  }

  const cwd = options.cwd ?? process.cwd();
  const filePath = resolve(cwd, positional[0] ?? ".rogatio.json");
  const storage = options.storage ?? createJsonFileProjectStorage();
  const writeOut =
    options.stdout ??
    ((text: string) => {
      process.stdout.write(text);
    });

  const report: DoctorReport = await runInstalledDoctor({
    ...(options.nodeVersion !== undefined
      ? { nodeVersion: options.nodeVersion }
      : {}),
    cliVersion: options.cliVersion ?? readCliVersion(),
    checkUpdates,
    ...(options.fetchLatestVersion !== undefined
      ? { fetchLatestVersion: options.fetchLatestVersion }
      : {}),
    extensionId,
    project: {
      source: "file",
      path: filePath,
      read: async () => {
        try {
          return { ok: true, data: await storage.get(filePath) };
        } catch (error) {
          return mapReadError(error);
        }
      },
    },
    ...(options.verifyInstall !== undefined
      ? { verifyInstall: options.verifyInstall }
      : {}),
    ...(options.probePac !== undefined ? { probePac: options.probePac } : {}),
    ...(options.testAi !== undefined ? { testAi: options.testAi } : {}),
    pacTimeoutMs: DOCTOR_PAC_TIMEOUT_MS,
  });

  if (jsonOutput) {
    writeOut(serializeDoctorReport(report));
  } else {
    writeOut(`${formatDoctorReport(report)}\n`);
  }
  return report.exitCode;
}
