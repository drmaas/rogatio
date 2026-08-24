import type {
  HeaderDirection,
  HeaderOperationKind,
  HttpMethod,
  ResourceType,
  RogatioProject,
} from "@rogatio/schema";

export type { HeaderDirection, HeaderOperationKind };

export interface EditorDiagnostic {
  readonly code: string;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export type EditorProjectSnapshot = Readonly<RogatioProject> &
  Readonly<Record<string, unknown>>;

export type EditorSaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly path?: string;
      readonly message?: string;
    };

export type EditorValidator = (value: unknown) => readonly EditorDiagnostic[];

export type EditorSaveHandler = (
  project: EditorProjectSnapshot,
) => EditorSaveResult | Promise<EditorSaveResult>;

export interface DryRunTestCase {
  readonly url: string;
  readonly method?: HttpMethod;
  readonly resourceType?: ResourceType;
}

export interface DryRunMatchDimension {
  readonly state: "matched" | "unmatched" | "not-applicable";
  readonly matched: boolean | null;
  readonly detail: string;
}

export interface DryRunActionPreview {
  readonly kind: string;
  readonly summary: string;
}

export interface DryRunRuleMatchResult {
  readonly groupId: string;
  readonly ruleId: string;
  readonly matched: boolean;
  readonly urlRegex: DryRunMatchDimension;
  readonly effectiveOrigin: DryRunMatchDimension;
  readonly method: DryRunMatchDimension;
  readonly resourceType: DryRunMatchDimension;
  readonly actionPreview: DryRunActionPreview | null;
}

export interface DryRunUrlResult {
  readonly url: string;
  readonly rules: readonly DryRunRuleMatchResult[];
  readonly matchedRuleCount: number;
}

export interface DryRunError {
  readonly code: string;
  readonly message: string;
  readonly index?: number;
}

export interface DryRunSummary {
  readonly caseCount: number;
  readonly urlCount: number;
  readonly matchedUrlCount: number;
  readonly matchedRuleTotal: number;
}

export interface DryRunResult {
  readonly results: readonly DryRunUrlResult[];
  readonly errors: readonly DryRunError[];
  readonly summary: DryRunSummary;
}

export type EditorDryRunHandler = (
  project: EditorProjectSnapshot,
  cases: readonly DryRunTestCase[],
  options?: { maxCases?: number },
) => DryRunResult | Promise<DryRunResult>;

export interface RuleTypeFieldExtension {
  readonly id: string;
  readonly label: string;
  readonly matches: (rule: Readonly<Record<string, unknown>>) => boolean;
  readonly mount: (context: RuleTypeFieldContext) => RuleTypeFieldMount;
  readonly validate: (
    rule: Readonly<Record<string, unknown>>,
    rulePath: string,
  ) => readonly EditorDiagnostic[];
  /** Returns a fresh default action object when the user selects this type. */
  readonly defaultAction?: () => unknown;
  /**
   * Rule field the default action writes to (default "action"). Payload types
   * such as mock live at a named top-level field instead.
   */
  readonly actionField?: string;
}

export interface RuleTypeFieldContext {
  readonly document: Document;
  readonly container: HTMLElement;
  readonly rulePath: string;
  readonly getField: (name: string) => unknown;
  readonly setField: (name: string, value: unknown) => void;
  readonly deleteField: (name: string) => void;
  readonly registerControl: (fieldPath: string, control: HTMLElement) => void;
}

export interface RuleTypeFieldMount {
  destroy(): void;
}

export interface EditorOptions {
  readonly root: HTMLElement;
  readonly initialProject: unknown;
  readonly validate: EditorValidator;
  readonly save: EditorSaveHandler;
  readonly onCancel?: () => void;
  readonly ruleTypes?: readonly RuleTypeFieldExtension[];
  readonly dryRun?: EditorDryRunHandler;
}

export interface EditorController {
  getDraft(): EditorProjectSnapshot;
  isDirty(): boolean;
  validate(): readonly EditorDiagnostic[];
  destroy(): void;
}

export type UrlConversionResult =
  | { readonly ok: true; readonly source: string }
  | {
      readonly ok: false;
      readonly code: "editor.invalid-url" | "editor.url-too-long";
    };

export class EditorInitializationError extends Error {
  readonly diagnostics: readonly EditorDiagnostic[];

  constructor(diagnostics: readonly EditorDiagnostic[]) {
    super("Rogatio editor could not initialize");
    this.name = "EditorInitializationError";
    this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }
}

export type { HttpMethod, ResourceType };
