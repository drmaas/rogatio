import { compileProject } from "@rogatio/compiler";
import {
  type DryRunOptions,
  type DryRunResult,
  type DryRunTestCase,
  dryRunProject,
  previewRuleAction,
} from "@rogatio/dry-run";
import { validateProjectDetailed } from "./browser-schema.js";

export interface FieldDiagnostic {
  readonly code: string;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export type ExtensionDryRunOutcome =
  | { readonly ok: true; readonly result: DryRunResult }
  | { readonly ok: false; readonly diagnostics: readonly FieldDiagnostic[] };

function fieldDiagnostic(
  code: string,
  path: string,
  message: string,
): FieldDiagnostic {
  return { code, severity: "error", path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compile the draft the management page sent and dry-run it. Validation uses
 * `browser-schema`, the same checks the page's Validate button uses. Nothing
 * is stored or installed.
 */
export function runExtensionDryRun(
  project: unknown,
  cases: unknown,
  options: unknown,
): ExtensionDryRunOutcome {
  if (!Array.isArray(cases)) {
    return {
      ok: false,
      diagnostics: [
        fieldDiagnostic("invalid-cases", "", "Cases must be an array"),
      ],
    };
  }
  try {
    const validation = validateProjectDetailed(project);
    if (!validation.valid) {
      return {
        ok: false,
        diagnostics: validation.errors.map((error) =>
          fieldDiagnostic(
            `schema.${error.keyword}`,
            error.instancePath,
            error.message || "The project contains invalid data.",
          ),
        ),
      };
    }
    const compiled = compileProject(validation.data);
    if (!compiled.ok) {
      return {
        ok: false,
        diagnostics: compiled.diagnostics.map((diagnostic) =>
          fieldDiagnostic(diagnostic.code, diagnostic.path, diagnostic.message),
        ),
      };
    }
    const dryOptions: DryRunOptions = { previewAction: previewRuleAction };
    if (
      isRecord(options) &&
      typeof options.maxCases === "number" &&
      Number.isSafeInteger(options.maxCases) &&
      options.maxCases > 0
    ) {
      dryOptions.maxCases = options.maxCases;
    }
    return {
      ok: true,
      result: dryRunProject(
        compiled.operations,
        cases as readonly DryRunTestCase[],
        dryOptions,
      ),
    };
  } catch {
    return {
      ok: false,
      diagnostics: [
        fieldDiagnostic(
          "extension.project-invalid",
          "",
          "The project could not be tested.",
        ),
      ],
    };
  }
}
