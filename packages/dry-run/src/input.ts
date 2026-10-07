import type { HttpMethod, ResourceType } from "@rogatio/schema";
import { HTTP_METHODS, RESOURCE_TYPES } from "@rogatio/schema";
import { batchLimit, invalidCase, invalidUrl } from "./errors.js";
import type { DryRunError, DryRunTestCase, PreviewActionFn } from "./types.js";

export const DEFAULT_MAX_CASES = 256;

export function ownPropertyNames(value: object): string[] | null {
  try {
    const names = Object.getOwnPropertyNames(value);
    const symbols = Object.getOwnPropertySymbols(value);
    return symbols.length === 0 ? names : null;
  } catch {
    return null;
  }
}

export function dataProperty(
  value: object,
  key: string,
): { present: boolean; value?: unknown; valid: boolean } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { present: false, valid: true };
    if (!("value" in descriptor) || descriptor.enumerable === false) {
      return { present: true, valid: false };
    }
    return { present: true, value: descriptor.value, valid: true };
  } catch {
    return { present: true, valid: false };
  }
}

export function validateCase(
  raw: unknown,
  index: number,
): { ok: true; value: DryRunTestCase } | { ok: false; error: DryRunError } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: invalidCase(index) };
  }

  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, error: invalidCase(index) };
    }
  } catch {
    return { ok: false, error: invalidCase(index) };
  }

  const names = ownPropertyNames(raw);
  if (names === null) return { ok: false, error: invalidCase(index) };
  const allowed = new Set(["url", "method", "resourceType"]);
  if (names.some((name) => !allowed.has(name))) {
    return { ok: false, error: invalidCase(index) };
  }

  const urlProperty = dataProperty(raw, "url");
  if (!urlProperty.valid) return { ok: false, error: invalidCase(index) };
  if (!urlProperty.present) {
    return { ok: false, error: invalidCase(index) };
  }
  if (typeof urlProperty.value !== "string") {
    return { ok: false, error: invalidUrl(index) };
  }
  const url = urlProperty.value;
  if (url.length === 0) return { ok: false, error: invalidUrl(index) };

  const methodProperty = dataProperty(raw, "method");
  const resourceTypeProperty = dataProperty(raw, "resourceType");
  if (!methodProperty.valid || !resourceTypeProperty.valid) {
    return { ok: false, error: invalidCase(index) };
  }
  const method = methodProperty.value;
  if (
    methodProperty.present &&
    (typeof method !== "string" ||
      !(HTTP_METHODS as readonly string[]).includes(method))
  ) {
    return { ok: false, error: invalidCase(index) };
  }
  const resourceType = resourceTypeProperty.value;
  if (
    resourceTypeProperty.present &&
    (typeof resourceType !== "string" ||
      !(RESOURCE_TYPES as readonly string[]).includes(resourceType))
  ) {
    return { ok: false, error: invalidCase(index) };
  }
  return {
    ok: true,
    value: {
      url,
      method: method as HttpMethod | undefined,
      resourceType: resourceType as ResourceType | undefined,
    },
  };
}

export function normalizeOptions(
  raw: unknown,
):
  | { ok: true; maxCases: number; previewAction?: PreviewActionFn }
  | { ok: false } {
  if (raw === undefined) {
    return { ok: true, maxCases: DEFAULT_MAX_CASES };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false };
  }
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false };
  } catch {
    return { ok: false };
  }
  const names = ownPropertyNames(raw);
  if (
    names === null ||
    names.some((name) => !["maxCases", "previewAction"].includes(name))
  ) {
    return { ok: false };
  }
  const maxCasesProperty = dataProperty(raw, "maxCases");
  const previewProperty = dataProperty(raw, "previewAction");
  if (!maxCasesProperty.valid || !previewProperty.valid) return { ok: false };

  let maxCases = DEFAULT_MAX_CASES;
  if (maxCasesProperty.present) {
    if (
      typeof maxCasesProperty.value !== "number" ||
      !Number.isSafeInteger(maxCasesProperty.value) ||
      maxCasesProperty.value <= 0
    ) {
      return { ok: false };
    }
    maxCases = maxCasesProperty.value;
  }
  let previewAction: PreviewActionFn | undefined;
  if (previewProperty.present) {
    if (
      previewProperty.value !== undefined &&
      typeof previewProperty.value !== "function"
    ) {
      return { ok: false };
    }
    previewAction = previewProperty.value as PreviewActionFn | undefined;
  }
  return { ok: true, maxCases, previewAction };
}

export type ReadCaseBatchResult =
  | { ok: false; error: DryRunError }
  | {
      ok: true;
      valid: Array<{ value: DryRunTestCase; index: number }>;
      errors: DryRunError[];
    };

export function readCaseBatch(
  cases: unknown,
  maxCases: number,
): ReadCaseBatchResult {
  if (!Array.isArray(cases)) {
    return {
      ok: false,
      error: invalidCase(undefined, "Test cases must be an array"),
    };
  }

  let caseCount: number;
  try {
    caseCount = cases.length;
    if (caseCount > maxCases) {
      return { ok: false, error: batchLimit(maxCases) };
    }
    for (let index = 0; index < caseCount; index += 1) {
      if (!Object.hasOwn(cases, index)) {
        return { ok: false, error: invalidCase(index) };
      }
    }
  } catch {
    return { ok: false, error: invalidCase() };
  }

  const errors: DryRunError[] = [];
  const valid: Array<{ value: DryRunTestCase; index: number }> = [];
  for (let index = 0; index < caseCount; index += 1) {
    let raw: unknown;
    try {
      raw = cases[index];
    } catch {
      errors.push(invalidCase(index));
      continue;
    }
    const result = validateCase(raw, index);
    if (result.ok) {
      valid.push({ value: result.value, index });
    } else {
      errors.push(result.error);
    }
  }

  return { ok: true, valid, errors };
}
