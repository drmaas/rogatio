import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ImportReport,
  importRequestlyExport,
  mergeProjects,
} from "@rogatio/requestly-import";
import { writeProject } from "../utils/file.js";
import { diagnoseProject, formatDiagnostics } from "./diagnose.js";

interface ImportFlags {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly merge: boolean;
  readonly json: boolean;
}

export async function importCommand(args: string[]): Promise<number> {
  const parsed = parseImportArgs(args);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const flags = parsed.flags;

  let exportData: unknown;
  try {
    exportData = JSON.parse(await readFile(flags.sourcePath, "utf8"));
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    return 2;
  }

  const imported = importRequestlyExport(exportData);
  if (!imported.ok) {
    console.error(`Error: ${imported.error}`);
    return 2;
  }

  let project = imported.project;
  let renamed: readonly string[] = [];
  if (flags.merge) {
    if (!(await pathExists(flags.outputPath))) {
      console.error(`Error: No project to merge at ${flags.outputPath}`);
      return 2;
    }
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(flags.outputPath, "utf8"));
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      return 2;
    }
    const existingDiagnosis = diagnoseProject(existing);
    if (
      existingDiagnosis.diagnostics.length > 0 ||
      existingDiagnosis.project === undefined
    ) {
      console.error(formatDiagnostics(existingDiagnosis.diagnostics));
      return 1;
    }
    const merged = mergeProjects(existingDiagnosis.project, project);
    if (!merged.ok) {
      console.error(`Error: ${merged.error}`);
      return 2;
    }
    project = merged.project;
    renamed = merged.renamed;
  } else if (await pathExists(flags.outputPath)) {
    console.error(
      `Error: ${flags.outputPath} already exists. Pass --merge to append imported groups, or choose another --out path.`,
    );
    return 2;
  }

  const diagnostics = diagnoseProject(project).diagnostics;
  if (diagnostics.length > 0) {
    console.error(formatDiagnostics(diagnostics));
    return 1;
  }

  try {
    await writeProject(flags.outputPath, project);
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    return 2;
  }

  if (flags.json) {
    console.log(
      `${JSON.stringify(jsonReport(imported.report, flags.outputPath, renamed), null, 2)}\n`,
    );
  } else {
    console.log(formatReport(imported.report, flags.outputPath, renamed));
  }
  return 0;
}

function jsonReport(
  report: ImportReport,
  outputPath: string,
  renamed: readonly string[],
): ImportReport & { outputPath: string; renamed: readonly string[] } {
  return { ...report, renamed, outputPath };
}

function formatReport(
  report: ImportReport,
  outputPath: string,
  renamed: readonly string[],
): string {
  const lines = [
    `Imported ${report.imported}, changed ${report.changed}, skipped ${report.skipped}.`,
  ];
  for (const note of report.notes) lines.push(note);
  const changed = report.rules.filter((row) => row.status === "changed");
  const skipped = report.rules.filter((row) => row.status === "skipped");
  if (changed.length > 0) {
    lines.push("", "Changed:");
    for (const row of changed) {
      lines.push(`  ${row.name} (${row.ruleType})`);
      for (const change of row.changes ?? []) lines.push(`    - ${change}`);
    }
  }
  if (skipped.length > 0) {
    lines.push("", "Skipped:");
    for (const row of skipped) {
      lines.push(`  ${row.name} (${row.ruleType}): ${row.reason ?? ""}`);
    }
  }
  if (renamed.length > 0) {
    lines.push("", "Renamed:");
    for (const line of renamed) lines.push(`  ${line}`);
  }
  lines.push("", `Wrote ${outputPath}`);
  return lines.join("\n");
}

function parseImportArgs(
  args: string[],
): { ok: true; flags: ImportFlags } | { ok: false; error: string } {
  const positionals: string[] = [];
  let outputPath: string | undefined;
  let merge = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--merge") {
      merge = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--out") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, error: "Error: --out requires a path" };
      }
      outputPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      return { ok: false, error: `Error: Unknown option: ${arg}` };
    }
    positionals.push(arg);
  }

  if (positionals[0] !== "requestly") {
    return {
      ok: false,
      error:
        "Error: Usage: rogatio import requestly <export.json> [--out <path>] [--merge] [--json]",
    };
  }
  const source = positionals[1];
  if (source === undefined) {
    return { ok: false, error: "Error: Missing Requestly export path" };
  }
  if (positionals.length > 2) {
    return { ok: false, error: "Error: Too many arguments" };
  }
  return {
    ok: true,
    flags: {
      sourcePath: resolve(source),
      outputPath: outputPath ?? resolve(process.cwd(), ".rogatio.json"),
      merge,
      json,
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
