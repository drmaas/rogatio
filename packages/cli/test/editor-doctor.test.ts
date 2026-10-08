import { describe, expect, it } from "vitest";
import { generateEditorHtml } from "../src/commands/edit.js";
import {
  buildEditorDoctor,
  EDITOR_AI_AFTER_START_FIX,
  EDITOR_AI_AFTER_START_SUMMARY,
  EDITOR_PROJECT_INVALID_SUMMARY,
  EDITOR_PROJECT_NOT_JSON_SUMMARY,
  EDITOR_SERVER_REJECTED_SUMMARY,
  EDITOR_SERVER_STOPPED_SUMMARY,
  EDITOR_SESSION_STALE_SUMMARY,
  editorEditFix,
  editorFileDoctorOptions,
  editorServerRejectedReport,
  editorServerStoppedReport,
  editorSessionStaleReport,
  editorVerifyFix,
  serializeEditorDiagnostics,
} from "../src/editor-doctor.js";

const host = {
  version: 1 as const,
  ok: false as const,
  exitCode: 1 as const,
  checks: [
    {
      id: "node" as const,
      status: "pass" as const,
      optional: false,
      summary: "Node 26.11.1, CLI 1.2.3.",
      fix: null,
    },
    {
      id: "project" as const,
      status: "fail" as const,
      optional: false,
      summary: "Project file is invalid: /tmp/project.json",
      fix: "rogatio verify /tmp/project.json",
    },
    {
      id: "host" as const,
      status: "pass" as const,
      optional: false,
      summary: "allowed_origins includes the release id.",
      fix: null,
    },
    {
      id: "ca" as const,
      status: "pass" as const,
      optional: false,
      summary: "Device CA is present and trusted.",
      fix: null,
    },
    {
      id: "pac" as const,
      status: "pass" as const,
      optional: false,
      summary: "Runtime answered a PAC request.",
      fix: null,
    },
    {
      id: "ai" as const,
      status: "warn" as const,
      optional: true,
      summary: "Optional. No AI provider is configured.",
      fix: "rogatio ai setup",
    },
  ],
};

describe("editor doctor", () => {
  it("quotes the edit command when the server has stopped", () => {
    const report = editorServerStoppedReport("/tmp/my project.json");
    const expected =
      process.platform === "win32"
        ? 'rogatio edit "/tmp/my project.json"'
        : "rogatio edit '/tmp/my project.json'";
    expect(report.ui.checks[0]?.summary).toBe(EDITOR_SERVER_STOPPED_SUMMARY);
    expect(report.ui.checks[0]?.fix).toBe(expected);
    expect(editorEditFix("/tmp/my project.json", "linux")).toBe(
      "rogatio edit '/tmp/my project.json'",
    );
    expect(editorEditFix("/tmp/my project.json", "win32")).toBe(
      'rogatio edit "/tmp/my project.json"',
    );
    expect(report.host).toBeNull();
  });

  it("quotes an ampersand for cmd.exe", () => {
    const path = "C:\\temp\\a&b.json";
    expect(editorEditFix(path, "win32")).toBe(
      'rogatio edit "C:\\temp\\a&b.json"',
    );
    expect(editorVerifyFix('C:\\temp\\say "hi" 100%.json', "win32")).toBe(
      'rogatio verify "C:\\temp\\say ""hi"" 100%%.json"',
    );
    expect(editorEditFix(path, "linux")).toBe(
      "rogatio edit 'C:\\temp\\a&b.json'",
    );
  });

  it("tells a stale tab to reload", () => {
    const report = editorSessionStaleReport();
    expect(report.ui.checks.map((item) => item.summary)).toEqual([
      "The editor server answered.",
      EDITOR_SESSION_STALE_SUMMARY,
    ]);
    expect(report.ui.checks[1]?.fix).toBe("Reload this tab");
    expect(report.host).toBeNull();
  });

  it("does not copy a rejected response body", () => {
    const report = editorServerRejectedReport();
    expect(report.ui.checks[0]?.summary).toBe(EDITOR_SERVER_REJECTED_SUMMARY);
    expect(report.ui.checks[0]?.fix).toBe("rogatio doctor");
  });

  it("reports an invalid draft without the project body", () => {
    const report = buildEditorDoctor({
      filePath: "/tmp/project.json",
      draft: {
        version: 2,
        name: "Draft",
        apiKey: "sk-doctor-secret-key",
        groups: [
          {
            id: "g",
            name: "G",
            rules: [
              {
                id: "r",
                name: "R",
                type: "response-body",
                responseBody: { mode: "replace", body: "PROJECT_BODY_SECRET" },
              },
            ],
          },
        ],
      },
      draftParsed: true,
      assistInPage: true,
      configuredNow: false,
      mockRootSaved: false,
      host,
    });
    const project = report.ui.checks.find(
      (item) => item.id === "editor.project",
    );
    expect(project?.status).toBe("fail");
    expect(project?.summary.startsWith(EDITOR_PROJECT_INVALID_SUMMARY)).toBe(
      true,
    );
    expect(project?.fix).toBe(
      process.platform === "win32"
        ? 'rogatio verify "/tmp/project.json"'
        : "rogatio verify /tmp/project.json",
    );
    expect(editorVerifyFix("/tmp/project.json", "linux")).toBe(
      "rogatio verify /tmp/project.json",
    );
    expect(editorVerifyFix("/tmp/project.json", "win32")).toBe(
      'rogatio verify "/tmp/project.json"',
    );
    const text = serializeEditorDiagnostics(report);
    expect(text).not.toContain("PROJECT_BODY_SECRET");
    expect(text).not.toContain("sk-doctor-secret-key");
    expect(text).not.toContain("https://provider.example");
    const parsed = JSON.parse(text) as { host: unknown };
    expect(`${JSON.stringify(parsed.host, null, 2)}\n`).toBe(
      `${JSON.stringify(host, null, 2)}\n`,
    );
  });

  it("says the draft is not JSON without a parser message", () => {
    const report = buildEditorDoctor({
      filePath: "/tmp/project.json",
      draft: null,
      draftParsed: false,
      assistInPage: false,
      configuredNow: false,
      mockRootSaved: false,
      host,
    });
    const project = report.ui.checks.find(
      (item) => item.id === "editor.project",
    );
    expect(project?.summary).toBe(EDITOR_PROJECT_NOT_JSON_SUMMARY);
    expect(project?.summary).not.toContain("Unexpected");
  });

  it("asks to restart the editor when AI was configured later", () => {
    const report = buildEditorDoctor({
      filePath: "/tmp/project.json",
      draft: {
        version: 2,
        name: "Draft",
        groups: [],
      },
      draftParsed: true,
      assistInPage: false,
      configuredNow: true,
      mockRootSaved: false,
      host: { ...host, ok: true, exitCode: 0 },
    });
    const ai = report.ui.checks.find((item) => item.id === "editor.ai");
    expect(ai?.summary).toBe(EDITOR_AI_AFTER_START_SUMMARY);
    expect(ai?.fix).toBe(EDITOR_AI_AFTER_START_FIX);
  });

  it("does not ask the registry from the editor", () => {
    expect(
      editorFileDoctorOptions({
        filePath: "/tmp/project.json",
        cliVersion: "1.2.3",
        read: async () => ({ ok: true, data: {} }),
      }).checkUpdates,
    ).toBe(false);
  });

  it("embeds Run checks in the editor page", () => {
    const html = generateEditorHtml(
      "http://127.0.0.1:9",
      "token",
      "/tmp/my project.json",
      false,
    );
    expect(html).toContain("Run checks");
    expect(html).toContain("/api/doctor");
    expect(html).toContain(EDITOR_SERVER_STOPPED_SUMMARY);
    const command =
      process.platform === "win32"
        ? 'rogatio edit "/tmp/my project.json"'
        : "rogatio edit '/tmp/my project.json'";
    const embedded = JSON.stringify(JSON.stringify(command).slice(1, -1)).slice(
      1,
      -1,
    );
    expect(html).toContain(embedded);
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });
});
