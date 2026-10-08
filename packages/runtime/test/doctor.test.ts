import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCTOR_FIX_AI_SETUP,
  DOCTOR_FIX_AI_TEST,
  DOCTOR_FIX_CA,
  DOCTOR_FIX_CLI,
  DOCTOR_FIX_DOCTOR,
  DOCTOR_FIX_EDIT_ACTIVE,
  DOCTOR_FIX_HOST,
  DOCTOR_FIX_NODE,
  DOCTOR_FIX_PAC,
  DOCTOR_HOST_MISSING_SUMMARY,
  type DoctorInput,
  type DoctorProjectInput,
  doctorFixCliUpdate,
  doctorFromHostMetadata,
  fetchLatestCliVersion,
  formatDoctorReport,
  probeAiProvider,
  probePacAnswer,
  projectEditFix,
  projectVerifyFix,
  RELEASE_EXTENSION_ID,
  runDoctor,
  serializeDoctorReport,
  type VerifyResult,
} from "../src/index.js";

const DEV_ID = "abcdefghijklmnopabcdefghijklmnop";

const validProject = {
  version: 2,
  name: "Doctor",
  groups: [
    {
      id: "group1",
      name: "Group",
      rules: [
        {
          id: "rule1",
          name: "Redirect",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/old$",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "redirect",
          redirect: { destination: "https://example.com/new" },
        },
      ],
    },
  ],
};

function verifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    ok: true,
    manifestExists: true,
    manifestValid: true,
    binaryExists: true,
    binaryExecutable: true,
    caTrusted: true,
    allowedOriginsCount: 1,
    allowedOrigins: [`chrome-extension://${RELEASE_EXTENSION_ID}/`],
    reasons: [],
    ...overrides,
  };
}

function input(overrides: Partial<DoctorInput> = {}): DoctorInput {
  const project: DoctorProjectInput = {
    source: "file",
    path: "/tmp/project.json",
    read: async () => ({ ok: true, data: validProject }),
  };
  return {
    nodeVersion: "26.11.1",
    cliVersion: "1.2.3",
    checkUpdates: false,
    fetchLatestVersion: async () => {
      throw new Error("registry must not be called");
    },
    project,
    extensionId: RELEASE_EXTENSION_ID,
    extensionIdValid: true,
    verifyInstall: async () => verifyResult(),
    probePac: async () => ({ ok: true }),
    testAi: async () => ({ configured: true, ok: true }),
    pacTimeoutMs: 10_000,
    ...overrides,
  };
}

function fileProject(
  path: string,
  read: () => Promise<
    | { readonly ok: true; readonly data: unknown }
    | {
        readonly ok: false;
        readonly reason: "missing" | "unreadable" | "parse";
      }
  >,
): DoctorProjectInput {
  return { source: "file", path, read };
}

describe("rogatio doctor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes every check and prints stable JSON", async () => {
    const report = await runDoctor(input());
    expect(report.exitCode).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.checks.map((item) => item.id)).toEqual([
      "node",
      "project",
      "host",
      "ca",
      "pac",
      "ai",
    ]);
    expect(report.checks.every((item) => item.fix === null)).toBe(true);
    const json = serializeDoctorReport(report);
    const parsed = JSON.parse(json) as {
      version: number;
      checks: Record<string, unknown>[];
    };
    expect(Object.keys(parsed)).toEqual([
      "version",
      "ok",
      "exitCode",
      "checks",
    ]);
    expect(Object.keys(parsed.checks[0] ?? {})).toEqual([
      "id",
      "status",
      "optional",
      "summary",
      "fix",
    ]);
    expect(json).toContain('"status": "pass"');
    expect(formatDoctorReport(report)).toContain(
      "pass  Node and CLI  Node 26.11.1, CLI 1.2.3.",
    );
  });

  it("does not call the registry unless check updates is set", async () => {
    let calls = 0;
    const report = await runDoctor(
      input({
        fetchLatestVersion: async () => {
          calls += 1;
          return "9.9.9";
        },
      }),
    );
    expect(calls).toBe(0);
    expect(report.checks[0]?.status).toBe("pass");
  });

  it("does not call the registry for an old Node even with --check-updates", async () => {
    let calls = 0;
    const report = await runDoctor(
      input({
        nodeVersion: "20.18.0",
        checkUpdates: true,
        fetchLatestVersion: async () => {
          calls += 1;
          return "9.9.9";
        },
      }),
    );
    expect(calls).toBe(0);
    expect(report.checks[0]?.fix).toBe(DOCTOR_FIX_NODE);
  });

  it("quotes a path that contains a backslash", async () => {
    const report = await runDoctor(
      input({
        project: fileProject("C:\\Users\\me\\.rogatio.json", async () => ({
          ok: false,
          reason: "missing",
        })),
      }),
    );
    expect(report.checks[1]?.fix).toBe(
      "rogatio edit 'C:\\Users\\me\\.rogatio.json'",
    );
  });

  it("fails an old Node with the documented install command", async () => {
    const report = await runDoctor(input({ nodeVersion: "20.18.0" }));
    const node = report.checks[0];
    expect(node?.status).toBe("fail");
    expect(node?.fix).toBe(DOCTOR_FIX_NODE);
    expect(report.exitCode).toBe(1);
    expect(formatDoctorReport(report)).toContain(`Fix: ${DOCTOR_FIX_NODE}`);
  });

  it("fails an unknown CLI version with the reinstall command", async () => {
    const report = await runDoctor(input({ cliVersion: "  " }));
    expect(report.checks[0]?.fix).toBe(DOCTOR_FIX_CLI);
  });

  it("warns when a newer CLI exists and does not fail the run", async () => {
    const report = await runDoctor(
      input({
        checkUpdates: true,
        fetchLatestVersion: async () => "1.2.4",
      }),
    );
    expect(report.checks[0]?.status).toBe("warn");
    expect(report.checks[0]?.fix).toBe(doctorFixCliUpdate("1.2.4"));
    expect(report.exitCode).toBe(0);
    expect(formatDoctorReport(report)).toContain(
      "Fix: npm install -g @rogatio/cli@1.2.4",
    );
  });

  it.each(["1.2.4;touch /tmp/pwned", "1.2.4\nrm -rf /"])(
    "does not copy an unsafe registry version into the report (%j)",
    async (payload) => {
      const report = await runDoctor(
        input({
          checkUpdates: true,
          fetchLatestVersion: async () => payload,
        }),
      );
      expect(report.checks[0]?.status).toBe("warn");
      expect(report.checks[0]?.fix).toBeNull();
      expect(report.exitCode).toBe(0);
      const rendered = `${formatDoctorReport(report)}\n${serializeDoctorReport(report)}`;
      expect(rendered).not.toContain(payload);
      expect(rendered).not.toContain("touch");
      expect(rendered).not.toContain("rm -rf");
    },
  );

  it("drops a registry body whose version is not exactly major.minor.patch", async () => {
    const payloads = ["1.2.4;touch /tmp/pwned", "1.2.4\nrm -rf /"];
    for (const payload of payloads) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ version: payload }),
        })),
      );
      await expect(fetchLatestCliVersion()).resolves.toBeNull();
      vi.unstubAllGlobals();
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "1.2.4" }),
      })),
    );
    await expect(fetchLatestCliVersion()).resolves.toBe("1.2.4");
  });

  it("warns without a fix when the registry check fails", async () => {
    const report = await runDoctor(
      input({
        checkUpdates: true,
        fetchLatestVersion: async () => null,
      }),
    );
    expect(report.checks[0]?.status).toBe("warn");
    expect(report.checks[0]?.fix).toBeNull();
    expect(report.exitCode).toBe(0);
  });

  it("fails a missing project with the edit command", async () => {
    const path = "/tmp/missing.json";
    const report = await runDoctor(
      input({
        project: fileProject(path, async () => ({
          ok: false,
          reason: "missing",
        })),
      }),
    );
    expect(report.checks[1]?.status).toBe("fail");
    expect(report.checks[1]?.fix).toBe(projectEditFix(path));
    expect(report.checks[1]?.summary).toContain("Project file not found");
  });

  it("fails unreadable and non-JSON projects with the edit command", async () => {
    const path = "/tmp/my project.json";
    const unreadable = await runDoctor(
      input({
        project: fileProject(path, async () => ({
          ok: false,
          reason: "unreadable",
        })),
      }),
    );
    expect(unreadable.checks[1]?.fix).toBe(
      "rogatio edit '/tmp/my project.json'",
    );
    const parsed = await runDoctor(
      input({
        project: fileProject("/tmp/bad.json", async () => ({
          ok: false,
          reason: "parse",
        })),
      }),
    );
    expect(parsed.checks[1]?.fix).toBe(projectEditFix("/tmp/bad.json"));
    expect(parsed.checks[1]?.summary).toContain("not JSON");
  });

  it("fails an invalid project with the verify command and no thrown text", async () => {
    const path = "/tmp/invalid.json";
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("secret-token");
        },
      },
    );
    const thrown = await runDoctor(
      input({
        project: fileProject(path, async () => ({ ok: true, data: hostile })),
      }),
    );
    expect(thrown.checks[1]?.fix).toBe(projectVerifyFix(path));
    expect(JSON.stringify(thrown)).not.toContain("secret-token");

    const invalid = await runDoctor(
      input({
        project: fileProject(path, async () => ({
          ok: true,
          data: { version: 99 },
        })),
      }),
    );
    expect(invalid.checks[1]?.status).toBe("fail");
    expect(invalid.checks[1]?.fix).toBe(`rogatio verify ${path}`);
    expect(invalid.checks[1]?.summary).toContain("schema.");
  });

  it("fails a missing host manifest with the install command", async () => {
    const report = await runDoctor(
      input({
        verifyInstall: async () =>
          verifyResult({
            ok: false,
            manifestExists: false,
            manifestValid: false,
            binaryExists: false,
            binaryExecutable: false,
            allowedOrigins: [],
            allowedOriginsCount: 0,
            caTrusted: true,
          }),
      }),
    );
    expect(report.checks[2]?.summary).toBe(DOCTOR_HOST_MISSING_SUMMARY);
    expect(report.checks[2]?.fix).toBe(DOCTOR_FIX_HOST);
  });

  it("fails an invalid manifest, a missing wrapper, and a non-executable wrapper", async () => {
    const invalid = await runDoctor(
      input({
        verifyInstall: async () =>
          verifyResult({ manifestValid: false, binaryExists: false }),
      }),
    );
    expect(invalid.checks[2]?.summary).toBe("Native host manifest is invalid.");
    expect(invalid.checks[2]?.fix).toBe(DOCTOR_FIX_HOST);

    const missingBinary = await runDoctor(
      input({
        verifyInstall: async () => verifyResult({ binaryExists: false }),
      }),
    );
    expect(missingBinary.checks[2]?.summary).toBe(
      "runtime-host wrapper was not found.",
    );
    expect(missingBinary.checks[2]?.fix).toBe(DOCTOR_FIX_HOST);

    const notExecutable = await runDoctor(
      input({
        verifyInstall: async () => verifyResult({ binaryExecutable: false }),
      }),
    );
    expect(notExecutable.checks[2]?.fix).toBe(DOCTOR_FIX_HOST);
    expect(notExecutable.checks[2]?.summary).toBe(
      "runtime-host wrapper is not executable.",
    );
  });

  it("fails empty allowed_origins and an origin mismatch with the re-pin command", async () => {
    const empty = await runDoctor(
      input({
        verifyInstall: async () =>
          verifyResult({ allowedOrigins: [], allowedOriginsCount: 0 }),
      }),
    );
    expect(empty.checks[2]?.summary).toBe(
      "Native host manifest has no allowed_origins.",
    );
    expect(empty.checks[2]?.fix).toBe(DOCTOR_FIX_HOST);

    const release = await runDoctor(
      input({
        verifyInstall: async () =>
          verifyResult({
            allowedOrigins: [`chrome-extension://${DEV_ID}/`],
          }),
      }),
    );
    expect(release.checks[2]?.fix).toBe("rogatio runtime install");
    expect(release.checks[2]?.summary).toContain("allowed_origins");

    const dev = await runDoctor(
      input({
        extensionId: DEV_ID,
        verifyInstall: async () => verifyResult(),
      }),
    );
    expect(dev.checks[2]?.fix).toBe(
      `rogatio runtime install --extension-id ${DEV_ID}`,
    );
  });

  it("fails a missing device CA with the install command", async () => {
    const report = await runDoctor(
      input({
        verifyInstall: async () =>
          verifyResult({ caTrusted: false, ok: false }),
      }),
    );
    expect(report.checks[3]?.status).toBe("fail");
    expect(report.checks[3]?.fix).toBe(DOCTOR_FIX_CA);
    expect(report.checks[3]?.summary).toBe(
      "Device CA is not present or not trusted.",
    );
  });

  it("fails a PAC timeout with the install command", async () => {
    const report = await runDoctor(
      input({ probePac: async () => ({ ok: false }) }),
    );
    expect(report.checks[4]?.status).toBe("fail");
    expect(report.checks[4]?.summary).toBe(
      "Runtime did not answer a PAC request within 10000ms.",
    );
    expect(report.checks[4]?.fix).toBe(DOCTOR_FIX_PAC);
    expect(formatDoctorReport(report)).toContain(`Fix: ${DOCTOR_FIX_PAC}`);
  });

  it("marks a missing or unreachable AI provider as an optional warning", async () => {
    const missing = await runDoctor(
      input({ testAi: async () => ({ configured: false, ok: false }) }),
    );
    expect(missing.checks[5]?.status).toBe("warn");
    expect(missing.checks[5]?.optional).toBe(true);
    expect(missing.checks[5]?.fix).toBe(DOCTOR_FIX_AI_SETUP);
    expect(missing.exitCode).toBe(0);

    const down = await runDoctor(
      input({ testAi: async () => ({ configured: true, ok: false }) }),
    );
    expect(down.checks[5]?.fix).toBe(DOCTOR_FIX_AI_TEST);
    expect(down.exitCode).toBe(0);
    expect(formatDoctorReport(down)).toContain(`Fix: ${DOCTOR_FIX_AI_TEST}`);
  });

  it("drops provider errors so they cannot enter the report", async () => {
    const probe = await probeAiProvider({
      readConfig: async () => ({
        providerUrl: "https://example.test/v1",
        model: "m",
        apiKey: "sk-secret",
      }),
      complete: async () => {
        throw new Error("sk-secret refused");
      },
    });
    expect(probe).toEqual({ configured: true, ok: false });
    expect(JSON.stringify(probe)).not.toContain("sk-secret");
  });

  it("answers a loopback PAC request", async () => {
    const result = await probePacAnswer(2_000);
    expect(result.ok).toBe(true);
  });

  it("checks the active project from host metadata without reading a path", async () => {
    let verified = 0;
    const report = await doctorFromHostMetadata(
      {
        extensionId: RELEASE_EXTENSION_ID,
        checkUpdates: "true",
        project: null,
        path: "/etc/passwd",
      },
      {
        cliVersion: "1.2.3",
        nodeVersion: "26.11.1",
        fetchLatestVersion: async () => {
          throw new Error("no registry");
        },
        verifyInstall: async () => {
          verified += 1;
          return verifyResult();
        },
        probePac: async () => ({ ok: true }),
        testAi: async () => ({ configured: false, ok: false }),
      },
    );
    expect(verified).toBe(1);
    expect(report.checks[1]?.fix).toBe(DOCTOR_FIX_EDIT_ACTIVE);
    expect(report.checks[0]?.status).toBe("pass");
  });

  it("reports a project that does not fit in the envelope", async () => {
    const report = await doctorFromHostMetadata(
      { projectOmitted: "too-large", extensionId: RELEASE_EXTENSION_ID },
      {
        cliVersion: "1.2.3",
        nodeVersion: "26.11.1",
        verifyInstall: async () => verifyResult(),
        probePac: async () => ({ ok: true }),
        testAi: async () => ({ configured: true, ok: true }),
      },
    );
    expect(report.checks[1]?.fix).toBe(DOCTOR_FIX_DOCTOR);
    expect(report.checks[1]?.summary).toContain("too large");
  });
});
