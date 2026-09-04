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
  | "extension.dnr-error"
  | "extension.mock-token-missing"
  | "extension.mock-check-in-progress"
  | "extension.native-runtime-unavailable"
  | "extension.native-runtime-transition"
  | "extension.native-host-missing"
  | "extension.request-body-needs-trust";

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
  "extension.mock-token-missing":
    "The mock runtime has no token for this rule; restart rogatio runtime after changing the project.",
  "extension.mock-check-in-progress":
    "A mock runtime check is already in progress.",
  "extension.native-runtime-unavailable":
    "The runtime is unavailable on this platform.",
  "extension.native-runtime-transition": "The runtime could not change state.",
  "extension.native-host-missing":
    "The native runtime host is not installed on this device. Run `rogatio runtime install --extension-id <extension ID>` once, then start the runtime again.",
  "extension.request-body-needs-trust":
    "Request-body rules need the device-local CA trusted on this device. Run `rogatio runtime install --extension-id <extension ID>` to register the host and (on capable platforms) trust the device-local CA, then click Start runtime again. Mocks and response-body rules do not need trust.",
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
