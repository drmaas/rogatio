import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "@rogatio/compiler";
import { validateProjectDetailed } from "@rogatio/schema";
import { readProject } from "../utils/file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function verifyCommandImpl(
  args: string[],
  stdinInput: string | undefined,
  captureOutput: boolean,
): Promise<number | string> {
  let filePath: string;
  let jsonOutput = false;

  // Parse arguments
  const positionalArgs: string[] = [];
  for (const arg of args) {
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "-" || !arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length > 1) {
    if (captureOutput) return "Error: Too many arguments\n";
    console.error("Error: Too many arguments");
    return 2;
  }

  const inputPath = positionalArgs[0];

  if (inputPath === "-") {
    if (!stdinInput) {
      if (captureOutput) return "Error: No stdin input provided\n";
      console.error("Error: No stdin input provided");
      return 2;
    }
    filePath = "<stdin>";
  } else if (inputPath) {
    filePath = resolve(inputPath);
  } else {
    filePath = resolve(process.cwd(), ".rogatio.json");
  }

  let projectData: unknown;

  try {
    if (inputPath === "-") {
      if (!stdinInput) throw new Error("No stdin input provided");
      projectData = JSON.parse(stdinInput);
    } else {
      projectData = await readProject(filePath);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const output = `Error: ${message}\n`;
    if (captureOutput) return output;
    console.error(output.trim());
    return 2;
  }

  // Schema validation
  const schemaResult = validateProjectDetailed(projectData);
  const diagnostics: Array<{
    code: string;
    severity: string;
    path: string;
    message: string;
    params: Record<string, unknown>;
  }> = [];

  if (!schemaResult.valid) {
    for (const error of schemaResult.errors) {
      diagnostics.push({
        code: `schema.${error.keyword}`,
        severity: "error",
        path: error.instancePath || "/",
        message: error.message,
        params: error.params,
      });
    }
  } else {
    // Compiler diagnostics
    const compileResult = compileProject(schemaResult.data);
    if (!compileResult.ok) {
      for (const diag of compileResult.diagnostics) {
        diagnostics.push({
          code: diag.code,
          severity: diag.severity,
          path: diag.path,
          message: diag.message,
          params: diag.params,
        });
      }
    }
  }

  // Output
  let output = "";
  if (jsonOutput) {
    output = `${JSON.stringify(diagnostics, null, 2)}\n`;
  } else {
    if (diagnostics.length === 0) {
      output = "Valid\n";
    } else {
      for (const diag of diagnostics) {
        output += `${diag.path}: ${diag.message} (${diag.code})\n`;
      }
    }
  }

  if (captureOutput) return output;

  if (output) console.log(output.trim());

  if (diagnostics.length === 0) return 0;
  return 1;
}

export async function verifyCommand(
  args: string[],
  stdinInput?: string,
): Promise<number>;
export async function verifyCommand(
  args: string[],
  stdinInput: string | undefined,
  captureOutput: true,
): Promise<string>;
export async function verifyCommand(
  args: string[],
  stdinInput?: string,
  captureOutput = false,
): Promise<number | string> {
  return verifyCommandImpl(args, stdinInput, captureOutput);
}
