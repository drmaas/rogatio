#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aiCommand } from "./commands/ai.js";
import { doctorCommand } from "./commands/doctor.js";
import { editCommand } from "./commands/edit.js";
import { importCommand } from "./commands/import.js";
import { runRuntimeHostEntry, runtimeCommand } from "./commands/runtime.js";
import { testCommand, testCommandNeedsStdin } from "./commands/test.js";
import { verifyCommand } from "./commands/verify.js";
import {
  showAIHelp,
  showDoctorHelp,
  showEditHelp,
  showImportHelp,
  showRuntimeHelp,
  showTestHelp,
  showVerifyHelp,
} from "./help.js";
import { readCliVersion } from "./version.js";

const VERSION = readCliVersion();

export async function cli(
  args: string[] = process.argv.slice(2),
): Promise<number> {
  if (args.length === 0) {
    return showHelp();
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "doctor":
      return handleDoctor(commandArgs);
    case "edit":
      return handleEdit(commandArgs);
    case "test":
      return handleTest(commandArgs);
    case "verify":
      return handleVerify(commandArgs);
    case "runtime":
      return handleRuntime(commandArgs);
    case "ai":
      return handleAI(commandArgs);
    case "import":
      return handleImport(commandArgs);
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

async function handleDoctor(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showDoctorHelp();
    return 0;
  }
  return doctorCommand(args);
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

async function handleAI(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showAIHelp();
    return 0;
  }
  return await aiCommand(args);
}

async function handleImport(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showImportHelp();
    return 0;
  }
  return importCommand(args);
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
  doctor [path]   Check the local stack and print a fix for each problem
  edit [path]     Launch browser editor (default: .rogatio.json; any filename)
  test [path] [url...]  Run offline dry-run tests (default: .rogatio.json; any filename)
  verify [path]   Validate a project file (default: .rogatio.json; any filename)
  import requestly <export.json>  Migrate a Requestly export (default --out: .rogatio.json)
  runtime <install|uninstall|verify|host>  Native messaging runtime control
  runtime host [path]  Run the native-messaging runtime host
  ai <setup|ls|show|delete|test>  AI provider configuration

Global Options:
  --help, -h      Show help
  --version, -v   Show version

Run 'rogatio <command> --help' for command-specific help.`);
  return 0;
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
