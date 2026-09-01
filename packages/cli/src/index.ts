#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editCommand } from "./commands/edit.js";
import { runRuntimeHostEntry, runtimeCommand } from "./commands/runtime.js";
import { testCommand, testCommandNeedsStdin } from "./commands/test.js";
import { verifyCommand } from "./commands/verify.js";
import { isDistBuild } from "./utils/asset-paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(
  __dirname,
  isDistBuild(__dirname) ? "../../package.json" : "../package.json",
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
    case "test":
      return handleTest(commandArgs);
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
  const result = await runtimeCommand(args);
  return typeof result === "number" ? result : await result.exitCode;
}

async function handleTest(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showTestHelp();
    return 0;
  }
  let stdinInput: string | undefined;
  if (testCommandNeedsStdin(args)) {
    try {
      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      }
      stdinInput = chunks.join("");
    } catch (error) {
      console.error(
        `Error: Unable to read stdin (${error instanceof Error ? error.message : "read failed"})`,
      );
      return 2;
    }
  }
  const result = await testCommand(args, stdinInput);
  return typeof result === "number" ? result : 1;
}

function showHelp(): number {
  console.log(`Rogatio CLI - Local-first browser request/response rules

Usage: rogatio <command> [options]

Commands:
  edit [path]     Launch browser editor for .rogatio.json
  test [path] [url...]  Run offline dry-run tests against .rogatio.json
  verify [path]   Validate .rogatio.json file
  runtime <activate|deactivate|status|install|trust|untrust|uninstall>  Native messaging runtime activation and request-body trust control
  runtime host [path]  Run the consolidated native-messaging runtime host

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
  console.log(`Usage: rogatio runtime <command> [options]
       rogatio runtime host [path]

Native messaging runtime control for response-body and request-body rules. The
runtime no longer serves an HTTP mock server; mock delivery happens in the
consolidated native-messaging host (spec REQ-001..REQ-005).

Native runtime commands:
  activate   Activate the runtime (explicit, no auto-activation)
  deactivate Deactivate the runtime (idempotent)
  host [path]  Run the consolidated native-messaging runtime host
  status     Show the current runtime and trust state

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

Options:
  --root <dir>    Root for confined file mocks (default: project directory)
  --extension-id  Extension ID for native messaging manifest (required for install)
  --help, -h      Show this help

The native runtime activates unconditionally once activated; the device-local CA /
PAC routing capability only affects request-body interception, not the host
control plane.

Exit codes:
  0  Stopped cleanly / success
  1  Invalid project (diagnostics present) or file outside the root
  2  Error (IO or usage)`);
}

function showTestHelp(): void {
  console.log(`Usage: rogatio test [options] [path] [url...]

Run offline dry-run tests against a .rogatio.json project file.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)
                   Use '-' to read project JSON from stdin
  url...          URLs to test; when path is omitted, first URL is detected automatically

Options:
  --urls <list>        Comma-separated list of URLs to test
  --urls-file <path>   Path to JSON file containing array of test cases
                       Each case: { "url": "...", "method"?: "...", "resourceType"?: "..." }
                       Use '-' to read from stdin
  --method <m>         Default HTTP method for all test cases (GET, POST, etc.)
  --resource-type <t>  Default resource type for all test cases
  --max-cases <n>      Maximum number of test cases (default: 256)
  --json               Output results as JSON
  --help, -h           Show this help

Test case format (JSON):
  [
    { "url": "https://example.com/", "method": "GET", "resourceType": "main_frame" },
    { "url": "https://example.com/script.js" }
  ]

Exit codes:
  0  Success (all valid, results may include non-matches)
  1  Validation/compile/test errors
  2  Usage error (invalid arguments, missing input)`);
}

if (
  process.argv[1] !== undefined &&
  realpathSync.native(fileURLToPath(import.meta.url)) ===
    realpathSync.native(resolve(process.argv[1]))
) {
  if (basename(process.argv[1]) === "runtime-host") {
    runRuntimeHostEntry().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    cli().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
