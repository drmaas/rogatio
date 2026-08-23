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
  | "set-group-enabled";

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
]);

function snapshot(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new Error("cycle");
  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0)
      throw new Error("symbol");
    if (Array.isArray(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0
      )
        throw new Error("array");
      const result: unknown[] = [];
      for (let index = 0; index < descriptor.value; index += 1) {
        const entry = Object.getOwnPropertyDescriptor(value, String(index));
        if (!entry || !("value" in entry) || !entry.enumerable)
          throw new Error("sparse");
        result.push(snapshot(entry.value, ancestors));
      }
      return result;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new Error("accessor");
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: snapshot(descriptor.value, ancestors),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function parseRequest(value: unknown): ParseRequestResult {
  let safe: unknown;
  try {
    safe = snapshot(value);
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
