// @vitest-environment happy-dom
import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createDashboardSystemStatus } from "../src/dashboard-status.js";
import {
  buildDoctorRequestMetadata,
  type DoctorReport,
  parseDoctorReport,
} from "../src/doctor-report.js";
import { renderDoctorReport } from "../src/doctor-view.js";
import { runtimeInstallCommand } from "../src/extension-id.js";
import type {
  NativeEnvelope,
  NativeEnvelopeInput,
} from "../src/native-session.js";
import { parseRequest } from "../src/protocol.js";
import { createExtensionApplication } from "../src/service-worker.js";
import {
  buildExtensionDoctor,
  EXT_NATIVE_MISSING_SUMMARY,
  EXT_NATIVE_ORIGIN_SUMMARY,
  EXT_NATIVE_TIMEOUT_SUMMARY,
  EXT_WORKER_FAIL_SUMMARY,
  EXT_WORKER_FIX,
  type ExtensionDoctorFacts,
  workerUnreachableDiagnostics,
} from "../src/ui-doctor.js";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

function report(overrides?: Partial<DoctorReport>): DoctorReport {
  const base: DoctorReport = {
    version: 1,
    ok: false,
    exitCode: 1,
    checks: [
      {
        id: "node",
        status: "pass",
        optional: false,
        summary: "Node 26.11.1, CLI 1.2.3.",
        fix: null,
      },
      {
        id: "project",
        status: "fail",
        optional: false,
        summary: "No active project.",
        fix: "rogatio edit",
      },
      {
        id: "host",
        status: "fail",
        optional: false,
        summary: "Native host manifest was not found.",
        fix: "rogatio runtime install",
      },
      {
        id: "ca",
        status: "fail",
        optional: false,
        summary: "Device CA is not present or not trusted.",
        fix: "rogatio runtime install",
      },
      {
        id: "pac",
        status: "fail",
        optional: false,
        summary: "Runtime did not answer a PAC request within 10000ms.",
        fix: "rogatio runtime install",
      },
      {
        id: "ai",
        status: "warn",
        optional: true,
        summary: "Optional. No AI provider is configured.",
        fix: "rogatio ai setup",
      },
    ],
  };
  return { ...base, ...overrides };
}

describe("doctor report", () => {
  it("accepts the run-doctor command", () => {
    expect(parseRequest({ version: 1, command: "run-doctor" }).ok).toBe(true);
  });

  it("keeps a required failure when the host marks that check optional", () => {
    const lying = report();
    const checks = lying.checks.map((item) =>
      item.id === "node"
        ? { ...item, status: "fail" as const, optional: true }
        : item,
    );
    const parsed = parseDoctorReport({
      ...lying,
      ok: true,
      exitCode: 0,
      checks,
    });
    expect(parsed?.ok).toBe(false);
    expect(parsed?.exitCode).toBe(1);
    expect(parsed?.checks[0]?.optional).toBe(false);
    expect(parsed?.checks[5]?.optional).toBe(true);
  });

  it("rejects a one-check report that is not the unreachable fallback", () => {
    expect(
      parseDoctorReport({
        version: 1,
        ok: false,
        exitCode: 1,
        checks: [
          {
            id: "host",
            status: "fail",
            optional: false,
            summary: "run curl https://evil.example",
            fix: "curl https://evil.example",
          },
        ],
      }),
    ).toBeNull();
  });

  it("omits a project that would not fit and never opts into registry checks", () => {
    const huge = {
      version: 2,
      name: "n",
      groups: [],
      padding: "x".repeat(60_000),
    };
    const metadata = buildDoctorRequestMetadata(huge, EXTENSION_ID);
    expect(metadata.checkUpdates).toBe(false);
    expect(metadata.projectOmitted).toBe("too-large");
    expect(metadata.project).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain("padding");
  });

  it("renders fix text as text and not markup", () => {
    const parent = document.createElement("div");
    renderDoctorReport(parent, shell(report()));
    const project = parent.querySelector("[data-check='project']");
    expect(project?.textContent).toContain("Fix: rogatio edit");
    expect(parent.innerHTML).not.toContain("<script");
    const host = parent.querySelector("[data-check='host']");
    expect(host?.textContent).toContain("Fix: rogatio runtime install");
    expect(
      parent.querySelector("[data-command='copy-doctor']")?.textContent,
    ).toBe("Copy diagnostics");
  });

  it("shows Run checks and the fix on the dashboard runtime card", () => {
    const section = createDashboardSystemStatus({
      phase: "stopped",
      runtimeError: null,
      extensionId: EXTENSION_ID,
      aiSupported: false,
      aiStatusChecked: true,
      aiReported: true,
      aiProvider: null,
      doctorReport: workerUnreachableDiagnostics(),
    });
    const button = section.querySelector("[data-command='run-doctor']");
    expect(button?.textContent).toBe("Run checks");
    expect(section.textContent).toContain(EXT_WORKER_FAIL_SUMMARY);
    expect(section.textContent).toContain(`Fix: ${EXT_WORKER_FIX}`);
  });
});

function shell(host: DoctorReport) {
  return buildExtensionDoctor(baseFacts(host));
}

function baseFacts(host: DoctorReport): ExtensionDoctorFacts {
  return {
    workerReached: true,
    extensionId: EXTENSION_ID,
    extensionVersion: "6.15.0",
    cliVersion: "6.15.0",
    native: "ok",
    phase: "stopped",
    proxy: {
      available: true,
      levelOfControl: "controllable_by_this_extension",
      mode: "direct",
    },
    siteAccess: true,
    incognito: true,
    activeProject: false,
    rulesReadable: true,
    enabledGroupCount: 0,
    statuses: [],
    tab: null,
    host,
  };
}

describe("run-doctor command", () => {
  function harness(
    sendImpl: (envelope: NativeEnvelopeInput) => Promise<NativeEnvelope>,
  ) {
    let stored: unknown;
    const send = vi.fn(sendImpl);
    const options = {
      storage: {
        read: async () => stored,
        compareAndSwap: async (previous: unknown, next: unknown) => {
          if (stored !== previous) return false;
          stored = next;
          return true;
        },
      },
      installer: {
        current: async () => [] as RogatioOperation[],
        install: async () => ({ ok: true as const }),
      },
      nativeRuntime: {
        start: vi.fn(async () => ({ state: "started" as const })),
        stop: vi.fn(async () => ({ state: "stopped" as const })),
        status: vi.fn(async () => ({ state: "stopped" as const })),
        sendPolicy: vi.fn(async () => {}),
        send,
      },
      extensionId: EXTENSION_ID,
      now: () => 1,
    };
    return { app: createExtensionApplication(options), send };
  }

  it("asks the native host and returns that report", async () => {
    const expected = report();
    const { app, send } = harness(async (envelope) => {
      expect(envelope.type).toBe("runtime.doctor");
      expect(envelope.metadata.checkUpdates).toBe(false);
      return {
        protocol: "v1",
        type: "runtime.doctor",
        timestamp: 1,
        metadata: { report: expected },
      };
    });
    const result = await app.handle({ version: 1, command: "run-doctor" });
    expect(send).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      host: DoctorReport;
      ui: { checks: { id: string; status: string }[] };
    };
    expect(value.host).toEqual(expected);
    expect(JSON.stringify(value.host)).toBe(JSON.stringify(expected));
    expect(
      value.ui.checks.find((item) => item.id === "ext.native")?.status,
    ).toBe("pass");
    expect(JSON.stringify(value)).not.toContain("cliVersion");
  });

  it("classifies a missing host instead of one generic row", async () => {
    const { app } = harness(async () => {
      throw new Error("extension.native-host-missing");
    });
    const result = await app.handle({ version: 1, command: "run-doctor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      host: null;
      ui: { checks: { id: string; summary: string; fix: string | null }[] };
    };
    expect(value.host).toBeNull();
    const native = value.ui.checks.find((item) => item.id === "ext.native");
    expect(native?.summary).toBe(EXT_NATIVE_MISSING_SUMMARY);
    expect(native?.fix).toBe(runtimeInstallCommand(EXTENSION_ID));
    expect(value.ui.checks.some((item) => item.id === "node")).toBe(false);
  });

  it("classifies origin forbidden with the dev install command", async () => {
    const { app } = harness(async () => {
      throw new Error(
        "Access to the specified native messaging host is forbidden. sk-secret",
      );
    });
    const result = await app.handle({ version: 1, command: "run-doctor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.value);
    expect(text).toContain(EXT_NATIVE_ORIGIN_SUMMARY);
    expect(text).toContain(runtimeInstallCommand(EXTENSION_ID));
    expect(text).not.toContain("sk-secret");
  });

  it("classifies a host timeout", async () => {
    const { app } = harness(async () => {
      throw new Error("Native messaging host timed out before responding.");
    });
    const result = await app.handle({ version: 1, command: "run-doctor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      ui: { checks: { id: string; summary: string; fix: string | null }[] };
    };
    const native = value.ui.checks.find((item) => item.id === "ext.native");
    expect(native?.summary).toBe(EXT_NATIVE_TIMEOUT_SUMMARY);
    expect(native?.fix).toBe("rogatio doctor");
  });
});
