import { normalizeSiteOrigin } from "@rogatio/schema";
import { extensionDiagnostic } from "./diagnostics.js";

interface OriginOperation {
  readonly matcher?: { readonly origins?: readonly unknown[] };
}

export function declaredPermissionOrigins(input: {
  readonly operations: readonly OriginOperation[];
}): readonly string[] {
  const origins = new Set<string>();
  for (const operation of input.operations) {
    const values = operation.matcher?.origins;
    if (!Array.isArray(values)) {
      throw new Error(extensionDiagnostic("extension.invalid-origin").code);
    }
    for (const value of values) {
      if (typeof value !== "string") {
        throw new Error(extensionDiagnostic("extension.invalid-origin").code);
      }
      const normalized = normalizeSiteOrigin(value);
      if (normalized === null) {
        throw new Error(extensionDiagnostic("extension.invalid-origin").code);
      }
      origins.add(normalized);
    }
  }
  return [...origins].sort();
}
