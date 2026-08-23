import type { HttpMethod, ResourceType, RogatioProject } from "@rogatio/schema";

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
