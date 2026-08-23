import type {
  HttpMethod,
  RedirectAction,
  ResourceType,
  RogatioQueryAction,
  RogatioRuleAction,
} from "@rogatio/schema";

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

export interface RedirectOperation {
  readonly kind: "redirect";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly redirect: { readonly destination: string };
}

export interface QueryOperation {
  readonly kind: "query";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly action: RogatioQueryAction;
}

export type RogatioOperation = MatcherOperation | RedirectOperation | QueryOperation;

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
      readonly operations: readonly RogatioOperation[];
      readonly diagnostics: readonly CompilerDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly operations: readonly [];
      readonly diagnostics: readonly CompilerDiagnostic[];
    };
