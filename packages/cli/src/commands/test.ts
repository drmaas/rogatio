import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import type { DryRunOptions, DryRunTestCase } from "@rogatio/dry-run";
import { dryRunProject, parseTestUrl } from "@rogatio/dry-run";
import { validateProjectDetailed } from "@rogatio/schema";
import { readProject } from "../utils/file.js";
import { createMockPreviewAction } from "../utils/mock-preview.js";

interface TestCaseInput {
  url: string;
  method?: string;
  resourceType?: string;
}

interface Diagnostic {
  code: string;
  severity: string;
  path: string;
  message: string;
  params: Record<string, unknown>;
}

function usageError(message: string): string {
  return `Error: ${message}\n`;
}

function toMatcherOperations(
  operations: readonly RogatioOperation[],
): readonly MatcherOperation[] {
  return operations.map(({ groupId, ruleId, matcher }) => ({
    kind: "matcher",
    groupId,
    ruleId,
    matcher,
  }));
}

function isUrl(value: string): boolean {
  return parseTestUrl(value).ok;
}

function ownDataProperty(
  value: object,
  key: string,
): { present: boolean; value?: unknown; valid: boolean } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { present: false, valid: true };
    if (!("value" in descriptor) || descriptor.enumerable === false) {
      return { present: true, valid: false };
    }
    return { present: true, value: descriptor.value, valid: true };
  } catch {
    return { present: true, valid: false };
  }
}

function applyDefaults(
  raw: unknown,
  defaultMethod: string | undefined,
  defaultResourceType: string | undefined,
): unknown {
  if (defaultMethod === undefined && defaultResourceType === undefined) {
    return raw;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return raw;
    const names = Object.getOwnPropertyNames(raw);
    if (Object.getOwnPropertySymbols(raw).length > 0) return raw;
    if (
      names.some((name) => !["url", "method", "resourceType"].includes(name))
    ) {
      return raw;
    }
    const url = ownDataProperty(raw, "url");
    const method = ownDataProperty(raw, "method");
    const resourceType = ownDataProperty(raw, "resourceType");
    if (!url.valid || !method.valid || !resourceType.valid) return raw;
    if (typeof url.value !== "string") return raw;
    if (method.present && typeof method.value !== "string") return raw;
    if (resourceType.present && typeof resourceType.value !== "string")
      return raw;
    const result: TestCaseInput = { url: url.value };
    result.method = method.present ? (method.value as string) : defaultMethod;
    result.resourceType = resourceType.present
      ? (resourceType.value as string)
      : defaultResourceType;
    if (result.method === undefined) delete result.method;
    if (result.resourceType === undefined) delete result.resourceType;
    return result;
  } catch {
    return raw;
  }
}

function addDefaults(
  cases: readonly unknown[],
  defaultMethod: string | undefined,
  defaultResourceType: string | undefined,
): unknown[] {
  return cases.map((raw) =>
    applyDefaults(raw, defaultMethod, defaultResourceType),
  );
}

function resultOptions(
  maxCases: number | undefined,
  operations: readonly RogatioOperation[],
): DryRunOptions {
  const options: DryRunOptions = {};
  if (maxCases !== undefined) options.maxCases = maxCases;
  options.previewAction = createMockPreviewAction(operations);
  return options;
}

function diagnosticsFromSchema(projectData: unknown): Diagnostic[] {
  const result = validateProjectDetailed(projectData);
  if (result.valid) return [];
  return result.errors.map((error) => ({
    code: `schema.${error.keyword}`,
    severity: "error",
    path: error.instancePath || "/",
    message: error.message,
    params: error.params as Record<string, unknown>,
  }));
}

function diagnosticsFromCompiler(
  result: ReturnType<typeof compileProject>,
): Diagnostic[] {
  if (result.ok) return [];
  return result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    path: diagnostic.path,
    message: diagnostic.message,
    params: diagnostic.params as Record<string, unknown>,
  }));
}

function jsonOutput(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function testCommandNeedsStdin(args: readonly string[]): boolean {
  let hasUrlSource = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--urls") {
      hasUrlSource = true;
      index += 1;
    } else if (arg === "--urls-file") {
      hasUrlSource = true;
      if (args[index + 1] === "-") return true;
      index += 1;
    } else if (
      arg === "--method" ||
      arg === "--resource-type" ||
      arg === "--max-cases"
    ) {
      index += 1;
    } else if (arg !== "--json" && !arg.startsWith("-")) {
      positional.push(arg);
    } else if (arg === "-") {
      positional.push(arg);
    }
  }
  if (positional[0] === "-") return true;
  const positionalUrls = isUrl(positional[0] ?? "")
    ? positional
    : positional.slice(1);
  return !hasUrlSource && positionalUrls.length === 0;
}

async function testCommandImpl(
  args: string[],
  stdinInput: string | undefined,
  captureOutput: boolean,
): Promise<number | string> {
  let filePath = resolve(process.cwd(), ".rogatio.json");
  let jsonMode = false;
  let maxCases: number | undefined;
  const urlCases: unknown[] = [];
  let urlsFile: string | undefined;
  let defaultMethod: string | undefined;
  let defaultResourceType: string | undefined;
  let argumentError: string | undefined;

  const positionalArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      jsonMode = true;
    } else if (arg === "--max-cases" && i + 1 < args.length) {
      maxCases = Number(args[++i]);
      if (!Number.isInteger(maxCases) || maxCases <= 0) {
        argumentError = "--max-cases must be a positive integer";
      }
    } else if (arg === "--urls" && i + 1 < args.length) {
      const urlList = args[++i]
        .split(",")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      for (const url of urlList) urlCases.push({ url });
    } else if (arg === "--urls-file" && i + 1 < args.length) {
      urlsFile = args[++i];
    } else if (arg === "--method" && i + 1 < args.length) {
      defaultMethod = args[++i];
    } else if (arg === "--resource-type" && i + 1 < args.length) {
      defaultResourceType = args[++i];
    } else if (
      arg === "--max-cases" ||
      arg === "--urls" ||
      arg === "--urls-file" ||
      arg === "--method" ||
      arg === "--resource-type"
    ) {
      argumentError = `${arg} requires a value`;
    } else if (arg === "-" || !arg.startsWith("-")) {
      positionalArgs.push(arg);
    } else {
      argumentError = `Unknown option: ${arg}`;
    }
  }

  if (argumentError) {
    const output = usageError(argumentError);
    if (captureOutput) return output;
    console.error(output.trim());
    return 2;
  }

  const firstIsUrl = isUrl(positionalArgs[0] ?? "");
  const inputPath = firstIsUrl ? undefined : positionalArgs[0];
  const positionalUrls = firstIsUrl ? positionalArgs : positionalArgs.slice(1);
  if (inputPath === "-" && urlsFile === "-") {
    const output = usageError("project and URL cases cannot both read stdin");
    if (captureOutput) return output;
    console.error(output.trim());
    return 2;
  }

  if (inputPath === "-") {
    if (!stdinInput) {
      const output = usageError("No stdin input provided");
      if (captureOutput) return output;
      console.error(output.trim());
      return 2;
    }
    filePath = "<stdin>";
  } else if (inputPath) {
    filePath = resolve(inputPath);
  }

  for (const url of positionalUrls) urlCases.push({ url });

  if (urlsFile) {
    try {
      const content =
        urlsFile === "-"
          ? (stdinInput ?? "")
          : await readFile(urlsFile, "utf8");
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        const output = usageError(`${urlsFile} must contain a JSON array`);
        if (captureOutput) return output;
        console.error(output.trim());
        return 2;
      }
      urlCases.push(...parsed);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unable to read URL cases";
      const output = usageError(`Error reading ${urlsFile}: ${message}`);
      if (captureOutput) return output;
      console.error(output.trim());
      return 2;
    }
  }

  if (
    urlCases.length === 0 &&
    inputPath !== "-" &&
    urlsFile === undefined &&
    stdinInput !== undefined
  ) {
    for (const line of stdinInput.split(/\r?\n/u)) {
      const url = line.trim();
      if (url.length > 0) urlCases.push({ url });
    }
  }

  if (urlCases.length === 0) {
    const output = usageError(
      "No test cases provided (use positional URLs, --urls, --urls-file, or stdin)",
    );
    if (captureOutput) return output;
    console.error(output.trim());
    return 2;
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

  const schemaResult = validateProjectDetailed(projectData);
  let diagnostics = diagnosticsFromSchema(projectData);
  if (!schemaResult.valid) {
    const output = jsonMode
      ? jsonOutput({ diagnostics })
      : diagnostics
          .map(
            (diagnostic) =>
              `${diagnostic.path}: ${diagnostic.message} (${diagnostic.code})\n`,
          )
          .join("");
    if (captureOutput) return output;
    if (jsonMode) console.log(output.trim());
    else console.error(output.trim());
    return 1;
  }

  const compileResult = compileProject(schemaResult.data);
  diagnostics = diagnosticsFromCompiler(compileResult);
  if (!compileResult.ok) {
    const output = jsonMode
      ? jsonOutput({ diagnostics })
      : diagnostics
          .map(
            (diagnostic) =>
              `${diagnostic.path}: ${diagnostic.message} (${diagnostic.code})\n`,
          )
          .join("");
    if (captureOutput) return output;
    if (jsonMode) console.log(output.trim());
    else console.error(output.trim());
    return 1;
  }

  const testCases = addDefaults(
    urlCases,
    defaultMethod,
    defaultResourceType,
  ) as DryRunTestCase[];
  const dryRunResult = dryRunProject(
    toMatcherOperations(compileResult.operations),
    testCases,
    resultOptions(maxCases, compileResult.operations),
  );

  if (jsonMode) {
    const output = jsonOutput(dryRunResult);
    if (captureOutput) return output;
    console.log(output.trim());
  } else {
    let output = "";
    for (const urlResult of dryRunResult.results) {
      output += `\nURL: ${urlResult.url}\n`;
      output += `  Matched rules: ${urlResult.matchedRuleCount}\n`;
      for (const rule of urlResult.rules) {
        output += `  ${rule.groupId}/${rule.ruleId}: ${rule.matched ? "MATCHED" : "NOT MATCHED"}\n`;
        output += `    urlRegex: ${rule.urlRegex.state} - ${rule.urlRegex.detail}\n`;
        output += `    effectiveOrigin: ${rule.effectiveOrigin.state} - ${rule.effectiveOrigin.detail}\n`;
        output += `    method: ${rule.method.state} - ${rule.method.detail}\n`;
        output += `    resourceType: ${rule.resourceType.state} - ${rule.resourceType.detail}\n`;
        if (rule.actionPreview) {
          output += `    actionPreview: ${rule.actionPreview.kind} - ${rule.actionPreview.summary}\n`;
        }
      }
    }
    if (dryRunResult.results.length === 0) output += "No valid URLs to test\n";
    output += `\nSummary:\n`;
    output += `  Total cases: ${dryRunResult.summary.caseCount}\n`;
    output += `  Valid URLs: ${dryRunResult.summary.urlCount}\n`;
    output += `  Matched URLs: ${dryRunResult.summary.matchedUrlCount}\n`;
    output += `  Total rule matches: ${dryRunResult.summary.matchedRuleTotal}\n`;
    for (const error of dryRunResult.errors) {
      output += `\n${error.code}: ${error.message}${error.index === undefined ? "" : ` (case ${error.index})`}\n`;
    }
    if (captureOutput) return output;
    console.log(output.trim());
  }

  return dryRunResult.errors.length === 0 ? 0 : 1;
}

export async function testCommand(
  args: string[],
  stdinInput?: string,
): Promise<number>;
export async function testCommand(
  args: string[],
  stdinInput: string | undefined,
  captureOutput: true,
): Promise<string>;
export async function testCommand(
  args: string[],
  stdinInput?: string,
  captureOutput = false,
): Promise<number | string> {
  return testCommandImpl(args, stdinInput, captureOutput);
}
