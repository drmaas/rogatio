import type {
  HeaderDirection,
  HeaderOperationKind,
  HttpMethod,
  MockAction,
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

export interface HeaderOperation {
  readonly kind: "header";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly header: {
    readonly direction: HeaderDirection;
    readonly operation: HeaderOperationKind;
    readonly name: string;
    readonly value?: string;
  };
}

export interface MockOperation {
  readonly kind: "mock";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly mock: MockAction;
}

export interface ResponseBodyOperation {
  readonly kind: "response-body";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly responseBody: ResponseBodyAction;
}

export interface RequestBodyOperation {
  readonly kind: "request-body";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly requestBody: RequestBodyAction;
}

export type RogatioOperation =
  | MatcherOperation
  | RedirectOperation
  | QueryOperation
  | HeaderOperation
  | MockOperation
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
