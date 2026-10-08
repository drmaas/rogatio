/**
 * Structural copy of the runtime doctor report. The extension cannot import
 * the runtime package. Titles and the unreachable fallback match
 * `docs/decisions/doctor/spec.md`.
 */

export const DOCTOR_CHECK_IDS = [
  "node",
  "project",
  "host",
  "ca",
  "pac",
  "ai",
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorStatus = "pass" | "warn" | "fail";

/** Titles match the CLI report. */
export function doctorCheckTitle(id: DoctorCheckId): string {
  if (id === "node") return "Node and CLI";
  if (id === "project") return "Project file";
  if (id === "host") return "Native host";
  if (id === "ca") return "Device CA";
  if (id === "pac") return "Runtime PAC";
  return "AI Assist";
}

/** Shown when connectNative never reaches the shared doctor implementation. */
export const DOCTOR_HOST_UNREACHABLE_SUMMARY =
  "Could not reach the native host.";
export const DOCTOR_HOST_UNREACHABLE_FIX = "rogatio runtime install";

/** Leave room for the envelope framing around the project. */
const DOCTOR_PROJECT_BUDGET = 48 * 1024;

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly optional: boolean;
  readonly summary: string;
  readonly fix: string | null;
}

export interface DoctorReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly exitCode: 0 | 1;
  readonly checks: readonly DoctorCheck[];
}

export function unreachableDoctorReport(): DoctorReport {
  return {
    version: 1,
    ok: false,
    exitCode: 1,
    checks: [
      {
        id: "host",
        status: "fail",
        optional: false,
        summary: DOCTOR_HOST_UNREACHABLE_SUMMARY,
        fix: DOCTOR_HOST_UNREACHABLE_FIX,
      },
    ],
  };
}

function isStatus(value: unknown): value is DoctorStatus {
  return value === "pass" || value === "warn" || value === "fail";
}

function isCheck(value: unknown, id: DoctorCheckId): value is DoctorCheck {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "id") || record.id !== id) return false;
  if (!isStatus(record.status)) return false;
  if (typeof record.optional !== "boolean") return false;
  if (typeof record.summary !== "string") return false;
  if (record.fix !== null && typeof record.fix !== "string") return false;
  return true;
}

function readCheck(value: DoctorCheck): DoctorCheck {
  return {
    id: value.id,
    status: value.status,
    // Only AI is optional. A host cannot hide a required failure by flipping this flag.
    optional: value.id === "ai",
    summary: value.summary,
    fix: value.fix,
  };
}

/** Accept the host's six-check report, or the one-check unreachable fallback. */
export function parseDoctorReport(value: unknown): DoctorReport | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.ok !== "boolean") return null;
  if (record.exitCode !== 0 && record.exitCode !== 1) return null;
  if (!Array.isArray(record.checks)) return null;

  if (record.checks.length === 1) {
    const only = record.checks[0];
    if (
      !isCheck(only, "host") ||
      only.status !== "fail" ||
      only.summary !== DOCTOR_HOST_UNREACHABLE_SUMMARY ||
      only.fix !== DOCTOR_HOST_UNREACHABLE_FIX
    ) {
      return null;
    }
    return {
      version: 1,
      ok: false,
      exitCode: 1,
      checks: [readCheck(only)],
    };
  }

  if (record.checks.length !== DOCTOR_CHECK_IDS.length) return null;
  const checks: DoctorCheck[] = [];
  for (let index = 0; index < DOCTOR_CHECK_IDS.length; index += 1) {
    const id = DOCTOR_CHECK_IDS[index] as DoctorCheckId;
    const item = record.checks[index];
    if (!isCheck(item, id)) return null;
    checks.push(readCheck(item));
  }
  const failed = checks.some(
    (item) => item.optional === false && item.status === "fail",
  );
  return {
    version: 1,
    ok: record.ok === !failed ? record.ok : !failed,
    exitCode: failed ? 1 : 0,
    checks,
  };
}

const EXTENSION_ID_RE = /^[a-p]{32}$/;

/**
 * Metadata for `runtime.doctor`. Never sets `checkUpdates`. Omits a project
 * that would not fit in the native envelope.
 */
export function buildDoctorRequestMetadata(
  project: unknown,
  extensionId: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    checkUpdates: false,
    projectSource: "active",
  };
  if (EXTENSION_ID_RE.test(extensionId)) metadata.extensionId = extensionId;
  if (project === null || project === undefined) {
    metadata.project = null;
    return metadata;
  }
  const withProject = { ...metadata, project };
  const bytes = new TextEncoder().encode(JSON.stringify(withProject)).length;
  if (bytes > DOCTOR_PROJECT_BUDGET) {
    metadata.projectOmitted = "too-large";
    return metadata;
  }
  metadata.project = project;
  return metadata;
}

export function doctorReportFromReply(metadata: unknown): DoctorReport | null {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  if (!Object.hasOwn(metadata, "report")) return null;
  return parseDoctorReport((metadata as { report?: unknown }).report);
}
