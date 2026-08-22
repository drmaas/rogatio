import type { ValidationIssue } from "@rogatio/schema";
import type { CompilerDiagnostic, CompilerDiagnosticCode } from "./types.js";

const ISSUE_CODES: Record<string, CompilerDiagnosticCode> = {
  required: "schema.required",
  additionalProperties: "schema.unknown-property",
  type: "schema.invalid-type",
  format: "schema.invalid-format",
  const: "schema.invalid-value",
  enum: "schema.invalid-value",
  pattern: "schema.invalid-value",
  minLength: "schema.out-of-range",
  maxLength: "schema.out-of-range",
  minItems: "schema.out-of-range",
  maxItems: "schema.out-of-range",
  minimum: "schema.out-of-range",
  maximum: "schema.out-of-range",
  uniqueItems: "schema.out-of-range",
  ownProperties: "schema.invalid-structure",
  uniqueId: "schema.duplicate-id",
  effectiveOrigin: "schema.no-effective-origin",
  maxRulesPerProject: "schema.rule-limit",
};

const SAFE_PARAM_KEYS = new Set([
  "additionalProperty",
  "actual",
  "allowedValue",
  "allowedValues",
  "format",
  "i",
  "j",
  "limit",
  "missingProperty",
  "previousPath",
  "type",
]);

const MESSAGES: Record<CompilerDiagnosticCode, string> = {
  "schema.required": "Required project data is missing.",
  "schema.unknown-property": "The project contains an unknown property.",
  "schema.invalid-type": "The project contains a value with an invalid type.",
  "schema.invalid-format":
    "The project contains a value with an invalid format.",
  "schema.invalid-value": "The project contains an invalid value.",
  "schema.out-of-range":
    "The project contains a value outside its allowed bounds.",
  "schema.invalid-structure": "The project contains invalid structure.",
  "schema.duplicate-id": "Project and rule IDs must be unique.",
  "schema.no-effective-origin":
    "Each rule must have at least one effective origin.",
  "schema.rule-limit": "The project contains too many rules.",
  "compiler.invariant":
    "The compiler could not normalize validated project data.",
};

function copySafeParams(
  params: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(params)) {
    if (!SAFE_PARAM_KEYS.has(key)) continue;
    const value = params[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const values: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean" ||
          item === null
        ) {
          values.push(item);
        }
      }
      safe[key] = values;
    }
  }
  return safe;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareDiagnostics(
  left: CompilerDiagnostic,
  right: CompilerDiagnostic,
): number {
  const leftParams = stableParams(left.params);
  const rightParams = stableParams(right.params);
  return (
    compareCodeUnits(left.path, right.path) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.message, right.message) ||
    compareCodeUnits(leftParams, rightParams)
  );
}

function stableParams(params: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(params).sort(compareCodeUnits);
  return keys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(params[key])}`)
    .join(",");
}

export function mapValidationIssues(
  issues: readonly ValidationIssue[],
): CompilerDiagnostic[] {
  return issues
    .map((issue) => {
      const code = Object.hasOwn(ISSUE_CODES, issue.keyword)
        ? ISSUE_CODES[issue.keyword]
        : "schema.invalid-value";
      return {
        code,
        severity: "error",
        path: issue.instancePath,
        message: MESSAGES[code],
        params: copySafeParams(issue.params),
      } satisfies CompilerDiagnostic;
    })
    .sort(compareDiagnostics);
}

export function invariantDiagnostic(path = ""): CompilerDiagnostic {
  return {
    code: "compiler.invariant",
    severity: "error",
    path,
    message: MESSAGES["compiler.invariant"],
    params: {},
  };
}
