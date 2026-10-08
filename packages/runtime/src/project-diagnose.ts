import { compileProject, type RogatioOperation } from "@rogatio/compiler";
import { type RogatioProject, validateProjectDetailed } from "@rogatio/schema";

export interface ProjectDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly path: string;
  readonly message: string;
  readonly params: Record<string, unknown>;
}

export interface Diagnosis {
  readonly diagnostics: readonly ProjectDiagnostic[];
  readonly project?: RogatioProject;
  readonly operations?: readonly RogatioOperation[];
  readonly stage?: "schema" | "compiler";
}

/**
 * Schema then compiler, the same sequence `rogatio verify` reports.
 * A thrown validator becomes an empty diagnosis only when the caller asks;
 * this function lets schema errors propagate so the caller can map them.
 */
export function diagnoseProjectData(projectData: unknown): Diagnosis {
  const diagnostics: ProjectDiagnostic[] = [];
  const schemaResult = validateProjectDetailed(projectData);
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
    return { diagnostics, stage: "schema" };
  }

  const compileResult = compileProject(schemaResult.data);
  if (!compileResult.ok) {
    for (const diag of compileResult.diagnostics) {
      diagnostics.push({
        code: diag.code,
        severity: diag.severity,
        path: diag.path,
        message: diag.message,
        params: { ...diag.params },
      });
    }
    return { diagnostics, stage: "compiler" };
  }
  return {
    diagnostics,
    project: schemaResult.data,
    operations: compileResult.operations,
  };
}

export function formatProjectDiagnostics(
  diagnostics: readonly ProjectDiagnostic[],
): string {
  return diagnostics
    .map((diag) => `${diag.path}: ${diag.message} (${diag.code})`)
    .join("\n");
}
