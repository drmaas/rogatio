import type {
  HeaderDirection,
  HeaderOperationKind,
  HttpMethod,
  RequestBodyAction,
  ResourceType,
  ResponseBodyAction,
  RogatioQueryAction,
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

interface OperationBase {
  readonly groupId: string;
  readonly ruleId: string;
  readonly redactSensitiveInLogs: boolean;
}

export interface MatcherOperation extends OperationBase {
  readonly kind: "matcher";
  readonly matcher: NormalizedMatcher;
}

export interface RedirectOperation extends OperationBase {
  readonly kind: "redirect";
  readonly matcher: NormalizedMatcher;
  readonly redirect: { readonly destination: string };
}

export interface QueryOperation extends OperationBase {
  readonly kind: "query";
  readonly matcher: NormalizedMatcher;
  readonly action: RogatioQueryAction;
}

export interface HeaderOperation extends OperationBase {
  readonly kind: "header";
  readonly matcher: NormalizedMatcher;
  readonly header: {
    readonly direction: HeaderDirection;
    readonly operation: HeaderOperationKind;
    readonly name: string;
    readonly value?: string;
  };
}

export interface ResponseBodyOperation extends OperationBase {
  readonly kind: "response-body";
  readonly matcher: NormalizedMatcher;
  readonly responseBody: ResponseBodyAction;
}

export interface RequestBodyOperation extends OperationBase {
  readonly kind: "request-body";
  readonly matcher: NormalizedMatcher;
  readonly requestBody: RequestBodyAction;
}

export type RogatioOperation =
  | MatcherOperation
  | RedirectOperation
  | QueryOperation
  | HeaderOperation
  | ResponseBodyOperation
  | RequestBodyOperation;

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
  | "compiler.invariant"
  | "compiler.forbidden-header"
  | "compiler.header-value-required"
  | "compiler.header-value-unexpected"
  | "compiler.invalid-header-direction"
  | "compiler.invalid-header-operation";

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
