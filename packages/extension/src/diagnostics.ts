export type ExtensionDiagnosticCode =
  | "extension.invalid-operation"
  | "extension.invalid-origin"
  | "extension.invalid-message"
  | "extension.storage-failed"
  | "extension.permission-failed"
  | "extension.install-failed"
  | "extension.not-found"
  | "extension.conflict"
  | "extension.unsupported"
  | "extension.invalid-header"
  | "extension.forbidden-header"
  | "extension.dnr-error";

export interface ExtensionDiagnostic {
  readonly code: ExtensionDiagnosticCode;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const MESSAGES: Record<ExtensionDiagnosticCode, string> = {
  "extension.invalid-operation": "The browser rule operation is invalid.",
  "extension.invalid-origin": "The project contains an invalid site origin.",
  "extension.invalid-message": "The extension message is invalid.",
  "extension.storage-failed": "The browser project storage is unavailable.",
  "extension.permission-failed":
    "The requested site access could not be updated.",
  "extension.install-failed":
    "The browser rule installation could not be completed.",
  "extension.not-found": "The requested extension resource does not exist.",
  "extension.conflict": "The committed project changed; refresh before saving.",
  "extension.unsupported":
    "This rule is not supported by the current extension slice.",
  "extension.invalid-header":
    "The header rule contains invalid header configuration.",
  "extension.forbidden-header":
    "The header name is forbidden for the given direction.",
  "extension.dnr-error": "The declarativeNetRequest operation failed.",
};

export function extensionDiagnostic(
  code: ExtensionDiagnosticCode,
  params: Readonly<Record<string, unknown>> = {},
  path = "",
): ExtensionDiagnostic {
  return {
    code,
    severity: "error",
    path,
    message: MESSAGES[code],
    params,
  };
}
