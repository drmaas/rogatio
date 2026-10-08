import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOCTOR_FIX_NODE,
  projectEditFix,
  type VerifyResult,
} from "@rogatio/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { doctorCommand } from "../src/commands/doctor.js";
import { cli } from "../src/index.js";

const passingVerify = {
  ok: true,
  manifestExists: true,
  manifestValid: true,
  binaryExists: true,
  binaryExecutable: true,
  caTrusted: true,
  allowedOriginsCount: 1,
  allowedOrigins: ["chrome-extension://dkngkciiiabbdjcopbipkpndfmpbmjom/"],
  reasons: [],
} satisfies VerifyResult;

const validProject = {
  version: 2,
  name: "Doctor",
  groups: [],
};

function ports() {
  return {
    nodeVersion: "26.11.1",
    cliVersion: "1.2.3",
    verifyInstall: async () => passingVerify,
    probePac: async () => ({ ok: true as const }),
    testAi: async () => ({ configured: false, ok: false }),
    fetchLatestVersion: async () => {
      throw new Error("registry must not be called");
    },
  };
}

describe("doctor command", () => {
  let directory = "";

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  it("prints the edit fix when the project file is missing", async () => {
    directory = await mkdtemp(join(tmpdir(), "rogatio-doctor-"));
    const path = join(directory, ".rogatio.json");
    let output = "";
    const code = await doctorCommand([], {
      cwd: directory,
      ...ports(),
      stdout: (text) => {
        output += text;
      },
    });
    expect(code).toBe(1);
    expect(output).toContain(`Fix: ${projectEditFix(path)}`);
    expect(output).toContain("Optional. No AI provider is configured.");
    expect(output).toContain("Fix: rogatio ai setup");
  });

  it("prints stable JSON for a valid project", async () => {
    directory = await mkdtemp(join(tmpdir(), "rogatio-doctor-"));
    const path = join(directory, "rules.json");
    await writeFile(path, JSON.stringify(validProject), "utf8");
    let output = "";
    const code = await doctorCommand(["--json", path], {
      cwd: directory,
      ...ports(),
      testAi: async () => ({ configured: true, ok: true }),
      stdout: (text) => {
        output += text;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output) as {
      version: number;
      ok: boolean;
      exitCode: number;
      checks: { id: string; fix: string | null; status: string }[];
    };
    expect(Object.keys(parsed)).toEqual([
      "version",
      "ok",
      "exitCode",
      "checks",
    ]);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.checks.map((item) => item.id)).toEqual([
      "node",
      "project",
      "host",
      "ca",
      "pac",
      "ai",
    ]);
    expect(parsed.checks[1]?.status).toBe("pass");
  });

  it("exits 2 on a usage error and does not print a report", async () => {
    let output = "";
    let error = "";
    const code = await doctorCommand(["--json", "--nope"], {
      ...ports(),
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        error += text;
      },
    });
    expect(code).toBe(2);
    expect(output).toBe("");
    expect(error).toContain("Unknown option");
  });

  it("prints the Node fix for an old runtime", async () => {
    directory = await mkdtemp(join(tmpdir(), "rogatio-doctor-"));
    let output = "";
    const code = await doctorCommand([], {
      cwd: directory,
      ...ports(),
      nodeVersion: "18.0.0",
      stdout: (text) => {
        output += text;
      },
    });
    expect(code).toBe(1);
    expect(output).toContain(`Fix: ${DOCTOR_FIX_NODE}`);
  });

  it("shows doctor help from the CLI entry", async () => {
    const lines: string[] = [];
    const spy = (text: string) => lines.push(text);
    const log = console.log;
    console.log = spy as typeof console.log;
    try {
      expect(await cli(["doctor", "--help"])).toBe(0);
    } finally {
      console.log = log;
    }
    const output = lines.join("\n");
    expect(output).toContain("--check-updates");
    expect(output).toContain("--json");
    expect(output).toContain("Exit codes:");
  });
});
