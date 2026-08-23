import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editCommand } from "./commands/edit.js";
import { runtimeCommand } from "./commands/runtime.js";
import { verifyCommand } from "./commands/verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Handle both source (packages/cli/src) and dist (packages/cli/dist/node) locations
const isDist = __dirname.includes("/dist/");
const packageJsonPath = resolve(
  __dirname,
  isDist ? "../../package.json" : "../package.json",
);
const packageJson = JSON.parse(
  await import("node:fs/promises").then((fs) =>
    fs.readFile(packageJsonPath, "utf-8"),
  ),
);
const VERSION = packageJson.version;

export async function cli(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  if (args.length === 0) {
    return showHelp();
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "edit":
      return handleEdit(commandArgs);
    case "verify":
      return handleVerify(commandArgs);
    case "runtime":
      return handleRuntime(commandArgs);
    case "--help":
    case "-h":
      return showHelp();
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    default:
      console.error(`Error: Unknown command: ${command}`);
      console.error("Run 'rogatio --help' for usage.");
      return 2;
  }
}

async function handleEdit(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showEditHelp();
    return 0;
  }
  const result = await editCommand(args);
  return result.exitCode;
}

async function handleVerify(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showVerifyHelp();
    return 0;
  }
  const result = await verifyCommand(args);
  return typeof result === "number" ? result : 1;
}

async function handleRuntime(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showRuntimeHelp();
    return 0;
  }
  return runtimeCommand(args);
}

function showHelp(): number {
  console.log(`Rogatio CLI - Local-first browser request/response rules

Usage: rogatio <command> [options]

Commands:
  edit [path]     Launch browser editor for .rogatio.json
  verify [path]   Validate .rogatio.json file
  runtime         Native messaging runtime (not yet implemented)

Global Options:
  --help, -h      Show help
  --version, -v   Show version

Run 'rogatio <command> --help' for command-specific help.`);
  return 0;
}

function showEditHelp(): void {
  console.log(`Usage: rogatio edit [options] [path]

Launch browser-based editor for .rogatio.json project file.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)

Options:
  --port <n>      Fixed port for editor server (default: random)
  --help, -h      Show this help

The editor runs in your default browser and communicates with a local server
bound to 127.0.0.1. Changes are saved atomically to the project file.`);
}

function showVerifyHelp(): void {
  console.log(`Usage: rogatio verify [options] [path]

Validate a .rogatio.json project file using schema and compiler.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)
                  Use '-' to read from stdin

Options:
  --json          Output diagnostics as JSON
  --help, -h      Show this help

Exit codes:
  0  Valid (no diagnostics)
  1  Invalid (diagnostics present)
  2  Error (IO, parse, or unexpected failure)`);
}

function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime [options]

Native messaging runtime for response-body and request-body rules.

Options:
  --help, -h      Show this help

Note: This command is not yet implemented.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
