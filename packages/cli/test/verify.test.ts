import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyCommand } from "../src/commands/verify.js";
import { writeProject } from "../src/utils/file.js";

describe("verify command", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-verify-test-"));
    testFile = join(testDir, ".rogatio.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const validProject = {
    version: 1,
    name: "Test Project",
    groups: [
      {
        id: "group1",
        name: "Group 1",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule1",
            name: "Redirect Rule",
            urlRegex: "^https://example\\.com/old/(.*)$",
            origins: [],
            resourceTypes: ["main_frame"],
            priority: 1,
            method: "GET",
          },
        ],
      },
    ],
  };

  it("exits 0 for valid project", async () => {
    await writeProject(testFile, validProject);
    const exitCode = await verifyCommand([testFile]);
    expect(exitCode).toBe(0);
  });

  it("exits 1 for invalid schema", async () => {
    const invalidProject = { ...validProject, version: 2 };
    await writeProject(testFile, invalidProject);
    const exitCode = await verifyCommand([testFile]);
    expect(exitCode).toBe(1);
  });

  it("exits 2 for missing file", async () => {
    const exitCode = await verifyCommand([join(testDir, "missing.json")]);
    expect(exitCode).toBe(2);
  });

  it("exits 2 for invalid JSON", async () => {
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(testFile, "invalid"),
    );
    const exitCode = await verifyCommand([testFile]);
    expect(exitCode).toBe(2);
  });

  it("reads from stdin with -", async () => {
    const output = await verifyCommand(
      ["-"],
      JSON.stringify(validProject),
      true,
    );
    console.log("stdin test result:", output);
    expect(output).toBe("Valid\n");
  });

  it("outputs JSON with --json flag", async () => {
    await writeProject(testFile, validProject);
    const output = await verifyCommand([testFile, "--json"], undefined, true);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("outputs human-readable by default", async () => {
    await writeProject(testFile, validProject);
    const output = await verifyCommand([testFile], undefined, true);
    console.log("human output test result:", typeof output, output);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("shows schema errors in output", async () => {
    const invalidProject = {
      ...validProject,
      groups: [
        { ...validProject.groups[0], id: "group1" },
        { ...validProject.groups[0], id: "group1" }, // duplicate ID
      ],
    };
    await writeProject(testFile, invalidProject);
    const output = await verifyCommand([testFile], undefined, true);
    console.log("schema error output:", output);
    expect(output).toContain("unique");
  });

  it("uses cwd/.rogatio.json by default", async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await writeProject(testFile, validProject);
      const exitCode = await verifyCommand([]);
      expect(exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects directory path", async () => {
    const exitCode = await verifyCommand([testDir]);
    expect(exitCode).toBe(2);
  });
});
