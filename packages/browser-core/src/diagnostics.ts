import type { CompilerDiagnosticCode } from "@rogatio/compiler";
import { diagnosticMessages } from "@rogatio/compiler";

export type CoreDiagnosticCode =
  | CompilerDiagnosticCode
  | "core.storage-corrupt"
  | "core.storage-conflict"
  | "core.conflict"
  | "core.project-limit"
  | "core.duplicate-name"
  | "core.duplicate-id"
  | "core.not-found"
  | "core.permission-undeclared"
  | "core.invalid-origin"
  | "core.install-failed"
  | "core.recovery-failed"
  | "core.rule-not-installed"
  | "core.runtime-transition"
  | "core.invariant";

const CORE_MESSAGES: Record<
  Exclude<CoreDiagnosticCode, CompilerDiagnosticCode>,
  string
> = {
  "core.storage-corrupt":
    "The stored project state is unreadable and must be repaired or reset.",
  "core.storage-conflict":
    "The stored project state changed concurrently and could not be committed.",
  "core.conflict":
    "The committed project changed since it was loaded; refresh before saving.",
  "core.project-limit": "The browser profile has reached its project limit.",
  "core.duplicate-name": "A project with this name already exists.",
  "core.duplicate-id": "A project with this id already exists.",
  "core.not-found": "The requested project or group does not exist.",
  "core.permission-undeclared":
    "Site access can only be granted for origins the project declares.",
  "core.invalid-origin": "The value is not a valid explicit site origin.",
  "core.install-failed": "The rule installation could not be completed.",
  "core.recovery-failed":
    "The previous rule set could not be restored after a failed installation.",
  "core.rule-not-installed":
    "The rule is enabled with granted site access but is not installed.",
  "core.runtime-transition": "The runtime state transition is not allowed.",
  "core.invariant": "An internal invariant could not be maintained.",
};

export interface CoreDiagnostic {
  readonly code: CoreDiagnosticCode;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const MESSAGES: Record<CoreDiagnosticCode, string> = {
  ...diagnosticMessages,
  ...CORE_MESSAGES,
};

export function coreDiagnostic(
  code: CoreDiagnosticCode,
  params: Readonly<Record<string, unknown>> = {},
  path = "",
): CoreDiagnostic {
  return {
    code,
    severity: "error",
    path,
    message: MESSAGES[code],
    params,
  };
}
