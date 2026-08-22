import type { HttpMethod, ResourceType } from "@rogatio/schema";

export interface NormalizedMatcher {
  readonly urlRegex: {
    readonly source: string;
    readonly flags: "";
  };
  readonly origins: readonly string[];
  readonly resourceTypes: readonly ResourceType[];
  readonly priority: number;
  readonly method?: HttpMethod;
}

export interface MatcherOperation {
  readonly kind: "matcher";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
}

export type CompilerDiagnosticCode =
  | "schema.required"
  | "schema.unknown-property"
  | "schema.invalid-type"
  | "schema.invalid-format"
  | "schema.invalid-value"
  | "schema.out-of-range"
  | "schema.invalid-structure"
  | "schema.duplicate-id"
  | "schema.no-effective-origin"
  | "schema.rule-limit"
  | "compiler.invariant";

export interface CompilerDiagnostic {
  readonly code: CompilerDiagnosticCode;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type CompileResult =
  | {
      readonly ok: true;
      readonly operations: readonly MatcherOperation[];
      readonly diagnostics: readonly CompilerDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly operations: readonly [];
      readonly diagnostics: readonly CompilerDiagnostic[];
    };
