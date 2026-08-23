import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProjectFileError,
  readProject,
  writeProject,
} from "../src/utils/file.js";

describe("file utilities", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-cli-test-"));
    testFile = join(testDir, ".rogatio.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("writeProject", () => {
    it("writes project atomically", async () => {
      const project = { version: 1, name: "Test", groups: [] };
      await writeProject(testFile, project);

      const stats = await stat(testFile);
      expect(stats.isFile()).toBe(true);
    });

    it("creates valid JSON", async () => {
      const project = { version: 1, name: "Test", groups: [] };
      await writeProject(testFile, project);

      const content = (await readProject(testFile)) as { name: string };
      expect(content).toEqual(project);
    });

    it("uses atomic write (temp + rename)", async () => {
      const project = { version: 1, name: "Test", groups: [] };
      await writeProject(testFile, project);

      // No temp files should remain
      const entries = await import("node:fs/promises").then((fs) =>
        fs.readdir(testDir),
      );
      const tempFiles = entries.filter((e) => e.startsWith(".rogatio.json."));
      expect(tempFiles).toHaveLength(0);
    });

    it("overwrites existing file", async () => {
      const project1 = { version: 1, name: "Test1", groups: [] };
      const project2 = { version: 1, name: "Test2", groups: [] };

      await writeProject(testFile, project1);
      await writeProject(testFile, project2);

      const content = (await readProject(testFile)) as { name: string };
      expect(content.name).toBe("Test2");
    });

    it("throws ProjectFileError on write failure", async () => {
      // Try to write to a directory (should fail)
      await expect(
        writeProject(testDir, { version: 1, name: "Test", groups: [] }),
      ).rejects.toThrow(ProjectFileError);
    });
  });

  describe("readProject", () => {
    it("reads valid project", async () => {
      const project = { version: 1, name: "Test", groups: [] };
      await writeProject(testFile, project);

      const content = (await readProject(testFile)) as { name: string };
      expect(content).toEqual(project);
    });

    it("throws ProjectFileError on missing file", async () => {
      await expect(readProject(join(testDir, "missing.json"))).rejects.toThrow(
        ProjectFileError,
      );
    });

    it("throws ProjectFileError on invalid JSON", async () => {
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(testFile, "invalid json"),
      );
      await expect(readProject(testFile)).rejects.toThrow(ProjectFileError);
    });

    it("throws ProjectFileError on non-object JSON", async () => {
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(testFile, '"string"'),
      );
      await expect(readProject(testFile)).rejects.toThrow(ProjectFileError);
    });
  });

  describe("ProjectFileError", () => {
    it("has code and path properties", async () => {
      try {
        await readProject(join(testDir, "missing.json"));
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectFileError);
        expect((e as ProjectFileError).code).toBeDefined();
        expect((e as ProjectFileError).path).toBeDefined();
      }
    });
  });
});
