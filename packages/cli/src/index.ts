#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editCommand } from "./commands/edit.js";
import { runtimeCommand } from "./commands/runtime.js";
import { testCommand, testCommandNeedsStdin } from "./commands/test.js";
import { verifyCommand } from "./commands/verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Handle both source (packages/cli/src) and dist (packages/cli/dist/node) locations
const isDist = __dirname.includes("/dist/") || __dirname.includes("\\dist\\");
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
  runtime <start|stop|status|install|trust|untrust|uninstall>  Native messaging runtime and request-body trust control
  runtime [path]  Start the mock runtime server (F13)

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
       rogatio runtime [options] [path]

Native messaging runtime control for response-body and request-body rules, or
start the local mock runtime for F13 mock rules.

Native runtime commands:
  start     Start the runtime (capability-gated; explicit, no auto-start)
  stop      Stop the runtime (idempotent)
  status    Show the current runtime state

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
"Check and connect" to install mock rules.

Exit codes:
  0  Stopped cleanly
  1  Invalid project (diagnostics present) or file outside the root
  2  Error (IO, startup, port conflict)`);
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
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
