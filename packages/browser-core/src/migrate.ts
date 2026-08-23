import { LIMITS } from "@rogatio/schema";
import { coreDiagnostic } from "./diagnostics.js";
import type {
  EnvelopeMigrationResult,
  StoredEnvelope,
  StoredProject,
} from "./types.js";
import { ENVELOPE_VERSION } from "./types.js";

export function createEmptyEnvelope(): StoredEnvelope {
  return { version: ENVELOPE_VERSION, projects: {}, activeProjectId: null };
}

type SnapshotResult = { valid: true; value: unknown } | { valid: false };

function snapshotOwnData(
  value: unknown,
  ancestors = new WeakSet<object>(),
): SnapshotResult {
  if (value === null || typeof value !== "object") {
    return { valid: true, value };
  }
  if (ancestors.has(value)) return { valid: false };

  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return { valid: false };
    }

    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        return { valid: false };
      }

      const length = lengthDescriptor.value;
      for (const propertyName of Object.getOwnPropertyNames(value)) {
        if (propertyName === "length") continue;
        const index = Number(propertyName);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= length ||
          String(index) !== propertyName
        ) {
          return { valid: false };
        }
      }

      const snapshot: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          return { valid: false };
        }
        const child = snapshotOwnData(descriptor.value, ancestors);
        if (!child.valid) return child;
        snapshot[index] = child.value;
      }
      return { valid: true, value: snapshot };
    }

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return { valid: false };
      }
      const child = snapshotOwnData(descriptor.value, ancestors);
      if (!child.valid) return child;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: child.value,
        writable: true,
      });
    }
    return { valid: true, value: snapshot };
  } catch {
    return { valid: false };
  } finally {
    ancestors.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function hasUniqueItems(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isNonEmptyBoundedString(value: unknown, limit: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function validateStoredProject(
  id: string,
  value: unknown,
): StoredProject | null {
  if (!isRecord(value)) return null;
  const { name, data, revision, createdAt, updatedAt } = value;
  if (value.id !== id) return null;
  if (!isNonEmptyBoundedString(id, LIMITS.maxIdLength)) return null;
  if (!isNonEmptyBoundedString(name, LIMITS.maxLabelLength)) return null;
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    typeof data.name !== "string" ||
    !Array.isArray(data.groups)
  ) {
    return null;
  }
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (
    !isStringArray(value.enabledGroupIds) ||
    !hasUniqueItems(value.enabledGroupIds) ||
    !value.enabledGroupIds.every((groupId) =>
      isNonEmptyBoundedString(groupId, LIMITS.maxIdLength),
    )
  ) {
    return null;
  }
  if (
    !isStringArray(value.grantedOrigins) ||
    !hasUniqueItems(value.grantedOrigins)
  ) {
    return null;
  }
  return {
    id,
    name: name as string,
    data: data as unknown as StoredProject["data"],
    revision: revision as number,
    createdAt: createdAt as number,
    updatedAt: updatedAt as number,
    enabledGroupIds: [...value.enabledGroupIds],
    grantedOrigins: [...value.grantedOrigins],
  };
}

export function migrateEnvelope(value: unknown): EnvelopeMigrationResult {
  const snapshot = snapshotOwnData(value);
  if (!snapshot.valid) {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }
  if (snapshot.value === undefined) {
    return { ok: true, envelope: createEmptyEnvelope() };
  }
  if (!isRecord(snapshot.value)) {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }
  const raw = snapshot.value;
  if (raw.version !== ENVELOPE_VERSION) {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }
  if (!isRecord(raw.projects)) {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }

  const projects: Record<string, StoredProject> = {};
  for (const key of Object.keys(raw.projects)) {
    const stored = validateStoredProject(key, raw.projects[key]);
    if (stored === null) {
      return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
    }
    projects[key] = stored;
  }

  const activeProjectId = raw.activeProjectId;
  if (activeProjectId !== null && typeof activeProjectId !== "string") {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }
  if (activeProjectId !== null && !Object.hasOwn(projects, activeProjectId)) {
    return { ok: false, diagnostic: coreDiagnostic("core.storage-corrupt") };
  }

  return {
    ok: true,
    envelope: {
      version: ENVELOPE_VERSION,
      projects,
      activeProjectId,
    },
  };
}
