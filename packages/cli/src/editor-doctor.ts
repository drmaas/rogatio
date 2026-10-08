/**
 * Doctor checks the `rogatio edit` page can see. The page script does not
 * import this module. `generateEditorHtml` embeds the fallback reports.
 */

import {
  type DoctorProjectRead,
  type DoctorReport,
  doctorInterruptedReport,
  doctorReportValue,
  type InstalledDoctorOptions,
  type ProjectDiagnostic,
  quoteDoctorArg,
  runInstalledDoctor,
} from "@rogatio/runtime";
import { diagnoseProject } from "./commands/diagnose.js";
import { ProjectStorageError } from "./utils/file.js";

export const EDITOR_UI_CHECK_IDS = [
  "editor.server",
  "editor.session",
  "editor.project",
  "editor.ai",
  "editor.mockRoot",
] as const;

export type EditorUiCheckId = (typeof EDITOR_UI_CHECK_IDS)[number];
export type DoctorStatus = "pass" | "warn" | "fail";

export const EDITOR_CHECK_TITLES: Record<EditorUiCheckId, string> = {
  "editor.server": "Editor server",
  "editor.session": "Editor session",
  "editor.project": "Draft",
  "editor.ai": "AI Assist",
  "editor.mockRoot": "Mock file root",
};

export const EDITOR_SERVER_STOPPED_SUMMARY = "The editor server stopped.";
export const EDITOR_SERVER_PASS_SUMMARY = "The editor server answered.";
export const EDITOR_SERVER_REJECTED_SUMMARY =
  "The editor server could not finish doctor.";
export const EDITOR_SERVER_REJECTED_FIX = "rogatio doctor";
export const EDITOR_SESSION_STALE_SUMMARY =
  "This tab is stale. Its editor token was rejected.";
export const EDITOR_SESSION_STALE_FIX = "Reload this tab";
export const EDITOR_SESSION_PASS_SUMMARY = "The editor token was accepted.";
export const EDITOR_PROJECT_INVALID_SUMMARY = "The draft is invalid.";
export const EDITOR_PROJECT_NOT_JSON_SUMMARY = "The draft is not JSON.";
export const EDITOR_PROJECT_VALID_SUMMARY = "The draft is valid.";
export const EDITOR_AI_NONE_SUMMARY = "Optional. No AI provider is configured.";
export const EDITOR_AI_NONE_FIX = "rogatio ai setup";
export const EDITOR_AI_AFTER_START_SUMMARY =
  "AI Assist was configured after this editor started.";
export const EDITOR_AI_AFTER_START_FIX = "Restart rogatio edit";
export const EDITOR_AI_PASS_SUMMARY = "AI Assist is available in this page.";
export const EDITOR_AI_REMOVED_SUMMARY = "AI Assist is no longer configured.";
export const EDITOR_MOCK_SAVED_SUMMARY = "A mock file root is saved.";
export const EDITOR_MOCK_MISSING_SUMMARY =
  "Mock rules have no saved mock file root.";
export const EDITOR_MOCK_MISSING_FIX = "Set mock file root";

const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_FIELD = 200;

export interface UiDoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly optional: boolean;
  readonly summary: string;
  readonly fix: string | null;
}

export interface CombinedDiagnostics {
  readonly version: 1;
  readonly surface: "editor";
  readonly ok: boolean;
  readonly ui: { readonly checks: readonly UiDoctorCheck[] };
  readonly host: DoctorReport | null;
}

function check(
  id: EditorUiCheckId,
  status: DoctorStatus,
  optional: boolean,
  summary: string,
  fix: string | null,
): UiDoctorCheck {
  return { id, status, optional, summary, fix };
}

function combined(
  checks: readonly UiDoctorCheck[],
  host: DoctorReport | null,
): CombinedDiagnostics {
  const uiFailed = checks.some(
    (item) => item.status === "fail" && item.optional === false,
  );
  return {
    version: 1,
    surface: "editor",
    ok: !uiFailed && (host === null || host.ok),
    ui: { checks },
    host,
  };
}

/**
 * Quote a path for the editor's own fix lines. Windows uses cmd.exe double
 * quotes. Other platforms keep `quoteDoctorArg`. The host report still uses
 * `quoteDoctorArg` on every platform.
 */
export function quoteEditorArg(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return quoteDoctorArg(value);
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function editorEditFix(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return `rogatio edit ${quoteEditorArg(filePath, platform)}`;
}

export function editorVerifyFix(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return `rogatio verify ${quoteEditorArg(filePath, platform)}`;
}

export function editorServerStoppedReport(
  filePath: string,
): CombinedDiagnostics {
  return combined(
    [
      check(
        "editor.server",
        "fail",
        false,
        EDITOR_SERVER_STOPPED_SUMMARY,
        editorEditFix(filePath),
      ),
    ],
    null,
  );
}

export function editorSessionStaleReport(): CombinedDiagnostics {
  return combined(
    [
      check("editor.server", "pass", false, EDITOR_SERVER_PASS_SUMMARY, null),
      check(
        "editor.session",
        "fail",
        false,
        EDITOR_SESSION_STALE_SUMMARY,
        EDITOR_SESSION_STALE_FIX,
      ),
    ],
    null,
  );
}

export function editorServerRejectedReport(): CombinedDiagnostics {
  return combined(
    [
      check(
        "editor.server",
        "fail",
        false,
        EDITOR_SERVER_REJECTED_SUMMARY,
        EDITOR_SERVER_REJECTED_FIX,
      ),
    ],
    null,
  );
}

function scrubField(value: string): string {
  let scrubbed = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    scrubbed += code <= 0x1f || code === 0x7f ? " " : char;
    if (scrubbed.length >= MAX_DIAGNOSTIC_FIELD) break;
  }
  return scrubbed.slice(0, MAX_DIAGNOSTIC_FIELD);
}

function diagnosticLines(diagnostics: readonly ProjectDiagnostic[]): string {
  const shown = diagnostics.slice(0, MAX_DIAGNOSTICS).map((item) => {
    return `${scrubField(item.path)}: ${scrubField(item.message)} (${scrubField(item.code)})`;
  });
  const text = shown.join("\n");
  if (diagnostics.length <= MAX_DIAGNOSTICS) return text;
  return `${text}\n${diagnostics.length - MAX_DIAGNOSTICS} more`;
}

function projectCheck(
  draft: unknown,
  parsed: boolean,
  filePath: string,
): UiDoctorCheck {
  const fix = editorVerifyFix(filePath);
  if (!parsed) {
    return check(
      "editor.project",
      "fail",
      false,
      EDITOR_PROJECT_NOT_JSON_SUMMARY,
      fix,
    );
  }
  try {
    const diagnosis = diagnoseProject(draft);
    if (diagnosis.diagnostics.length === 0) {
      return check(
        "editor.project",
        "pass",
        false,
        EDITOR_PROJECT_VALID_SUMMARY,
        null,
      );
    }
    const lines = diagnosticLines(diagnosis.diagnostics);
    return check(
      "editor.project",
      "fail",
      false,
      lines.length > 0
        ? `${EDITOR_PROJECT_INVALID_SUMMARY}\n${lines}`
        : EDITOR_PROJECT_INVALID_SUMMARY,
      fix,
    );
  } catch {
    return check(
      "editor.project",
      "fail",
      false,
      EDITOR_PROJECT_INVALID_SUMMARY,
      fix,
    );
  }
}

function aiCheck(assistInPage: boolean, configuredNow: boolean): UiDoctorCheck {
  if (!assistInPage && !configuredNow) {
    return check(
      "editor.ai",
      "warn",
      true,
      EDITOR_AI_NONE_SUMMARY,
      EDITOR_AI_NONE_FIX,
    );
  }
  if (!assistInPage && configuredNow) {
    return check(
      "editor.ai",
      "warn",
      true,
      EDITOR_AI_AFTER_START_SUMMARY,
      EDITOR_AI_AFTER_START_FIX,
    );
  }
  if (assistInPage && configuredNow) {
    return check("editor.ai", "pass", true, EDITOR_AI_PASS_SUMMARY, null);
  }
  return check(
    "editor.ai",
    "warn",
    true,
    EDITOR_AI_REMOVED_SUMMARY,
    EDITOR_AI_NONE_FIX,
  );
}

export function draftHasMockRule(draft: unknown): boolean {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
    return false;
  }
  const groups = (draft as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    if (group === null || typeof group !== "object" || Array.isArray(group)) {
      continue;
    }
    const rules = (group as { rules?: unknown }).rules;
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
        continue;
      }
      if ((rule as { type?: unknown }).type === "mock") return true;
    }
  }
  return false;
}

function mockRootCheck(saved: boolean): UiDoctorCheck {
  if (saved) {
    return check(
      "editor.mockRoot",
      "pass",
      true,
      EDITOR_MOCK_SAVED_SUMMARY,
      null,
    );
  }
  return check(
    "editor.mockRoot",
    "warn",
    true,
    EDITOR_MOCK_MISSING_SUMMARY,
    EDITOR_MOCK_MISSING_FIX,
  );
}

export interface EditorDoctorInput {
  readonly filePath: string;
  readonly draft: unknown;
  readonly draftParsed: boolean;
  readonly assistInPage: boolean;
  readonly configuredNow: boolean;
  readonly mockRootSaved: boolean;
  readonly host: DoctorReport;
}

export function buildEditorDoctor(
  input: EditorDoctorInput,
): CombinedDiagnostics {
  const checks: UiDoctorCheck[] = [
    check("editor.server", "pass", false, EDITOR_SERVER_PASS_SUMMARY, null),
    check("editor.session", "pass", false, EDITOR_SESSION_PASS_SUMMARY, null),
    projectCheck(input.draft, input.draftParsed, input.filePath),
    aiCheck(input.assistInPage, input.configuredNow),
  ];
  if (input.draftParsed && draftHasMockRule(input.draft)) {
    checks.push(mockRootCheck(input.mockRootSaved));
  }
  return combined(checks, input.host);
}

function mapReadError(error: unknown): DoctorProjectRead {
  if (error instanceof ProjectStorageError) {
    if (error.code === "not-found") return { ok: false, reason: "missing" };
    if (error.code === "invalid-json" || error.code === "invalid-format") {
      return { ok: false, reason: "parse" };
    }
  }
  return { ok: false, reason: "unreadable" };
}

/** Options for the open file. `checkUpdates` is always false. */
export function editorFileDoctorOptions(input: {
  readonly filePath: string;
  readonly cliVersion: string;
  readonly read: () => Promise<DoctorProjectRead>;
}): InstalledDoctorOptions {
  return {
    cliVersion: input.cliVersion,
    checkUpdates: false,
    project: {
      source: "file",
      path: input.filePath,
      read: input.read,
    },
  };
}

export async function runEditorFileDoctor(input: {
  readonly filePath: string;
  readonly cliVersion: string;
  readonly storageGet: (path: string) => Promise<unknown>;
}): Promise<DoctorReport> {
  try {
    return await runInstalledDoctor(
      editorFileDoctorOptions({
        filePath: input.filePath,
        cliVersion: input.cliVersion,
        read: async () => {
          try {
            return { ok: true, data: await input.storageGet(input.filePath) };
          } catch (error) {
            return mapReadError(error);
          }
        },
      }),
    );
  } catch {
    return doctorInterruptedReport();
  }
}

export function serializeEditorDiagnostics(
  report: CombinedDiagnostics,
): string {
  return `${JSON.stringify(
    {
      version: 1,
      surface: "editor",
      ok: report.ok,
      ui: {
        checks: report.ui.checks.map((item) => ({
          id: item.id,
          status: item.status,
          optional: item.optional,
          summary: item.summary,
          fix: item.fix,
        })),
      },
      host: report.host === null ? null : doctorReportValue(report.host),
    },
    null,
    2,
  )}\n`;
}

/** Keep a `<` in a file path from closing the editor script element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Titles the page uses for UI checks and the nested host report. */
export function editorPageTitles(): Record<string, string> {
  return {
    ...EDITOR_CHECK_TITLES,
    node: "Node and CLI",
    project: "Project file",
    host: "Native host",
    ca: "Device CA",
    pac: "Runtime PAC",
    ai: "AI Assist",
  };
}
