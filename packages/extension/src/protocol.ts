import { safeClone } from "@rogatio/schema";
import {
  type ExtensionDiagnostic,
  extensionDiagnostic,
} from "./diagnostics.js";

export type ExtensionCommand =
  | "get-state"
  | "refresh"
  | "create-project"
  | "import-project"
  | "save-project"
  | "select-project"
  | "switch-project"
  | "remove-project"
  | "export-project"
  | "review-permissions"
  | "grant-permissions"
  | "revoke-permission"
  | "set-group-enabled"
  | "start-native-runtime"
  | "stop-native-runtime"
  | "get-native-runtime-status";

export interface ExtensionRequest {
  readonly version: 1;
  readonly command: ExtensionCommand;
  readonly [key: string]: unknown;
}

export type ParseRequestResult =
  | { readonly ok: true; readonly value: ExtensionRequest }
  | {
      readonly ok: false;
      readonly diagnostic: ExtensionDiagnostic;
      readonly code: "extension.invalid-message";
    };

const COMMANDS = new Set<ExtensionCommand>([
  "get-state",
  "refresh",
  "create-project",
  "import-project",
  "save-project",
  "select-project",
  "switch-project",
  "remove-project",
  "export-project",
  "review-permissions",
  "grant-permissions",
  "revoke-permission",
  "set-group-enabled",
  "start-native-runtime",
  "stop-native-runtime",
  "get-native-runtime-status",
]);

export function parseRequest(value: unknown): ParseRequestResult {
  let safe: unknown;
  try {
    safe = safeClone(value);
  } catch {
    return {
      ok: false,
      code: "extension.invalid-message",
      diagnostic: extensionDiagnostic("extension.invalid-message"),
    };
  }
  if (
    safe === null ||
    typeof safe !== "object" ||
    Array.isArray(safe) ||
    (safe as Record<string, unknown>).version !== 1 ||
    typeof (safe as Record<string, unknown>).command !== "string" ||
    !COMMANDS.has((safe as Record<string, unknown>).command as ExtensionCommand)
  ) {
    return {
      ok: false,
      code: "extension.invalid-message",
      diagnostic: extensionDiagnostic("extension.invalid-message"),
    };
  }
  return { ok: true, value: safe as ExtensionRequest };
}
