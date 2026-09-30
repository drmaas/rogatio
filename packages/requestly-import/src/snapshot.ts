import { isRecord } from "./record.js";

const MAX_DEPTH = 40;
const MAX_STRING = 5_000_000;
const MAX_ARRAY = 100_000;
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type SnapshotResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

export function snapshotJson(value: unknown): SnapshotResult {
  return snapshot(value, new WeakSet<object>(), 0);
}

function snapshot(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): SnapshotResult {
  if (typeof value === "string") {
    if (value.length > MAX_STRING) return tooLarge();
    return { ok: true, value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        error: "Requestly export contains a non-finite number.",
      };
    }
    return { ok: true, value };
  }
  if (typeof value === "boolean" || value === null) {
    return { ok: true, value };
  }
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "object") {
    return {
      ok: false,
      error: "Requestly export contains a value that is not JSON data.",
    };
  }
  if (depth > MAX_DEPTH) {
    return { ok: false, error: "Requestly export is nested too deeply." };
  }
  if (ancestors.has(value)) {
    return { ok: false, error: "Requestly export contains a cycle." };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return {
      ok: false,
      error: "Requestly export contains a value that is not JSON data.",
    };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return snapshotArray(value, ancestors, depth);
    return snapshotObject(value, ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotArray(
  value: unknown[],
  ancestors: WeakSet<object>,
  depth: number,
): SnapshotResult {
  if (Object.getPrototypeOf(value) !== Array.prototype) return notJson();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (
    length === undefined ||
    !("value" in length) ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > MAX_ARRAY
  ) {
    return tooLarge();
  }
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (entry === undefined || !("value" in entry) || !entry.enumerable) {
      return {
        ok: false,
        error: "Requestly export contains a sparse array.",
      };
    }
    const child = snapshot(entry.value, ancestors, depth + 1);
    if (!child.ok) return child;
    result.push(child.value);
  }
  return { ok: true, value: result };
}

function snapshotObject(
  value: object,
  ancestors: WeakSet<object>,
  depth: number,
): SnapshotResult {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return notJson();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (BANNED_KEYS.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return {
        ok: false,
        error: "Requestly export contains a value that is not JSON data.",
      };
    }
    if (descriptor.value === undefined) continue;
    const child = snapshot(descriptor.value, ancestors, depth + 1);
    if (!child.ok) return child;
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: child.value,
    });
  }
  return { ok: true, value: result };
}

function tooLarge(): SnapshotResult {
  return {
    ok: false,
    error: "Requestly export contains a value that is too large.",
  };
}

function notJson(): SnapshotResult {
  return {
    ok: false,
    error: "Requestly export contains a value that is not JSON data.",
  };
}

export function asRecords(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const records: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    records.push(entry);
  }
  return records;
}
