import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJsonFileProjectStorage,
  ProjectFileError,
  type ProjectStorage,
  ProjectStorageError,
  readProject,
  writeProject,
} from "../src/utils/file.js";

describe("ProjectStorage (JSON-file)", () => {
  let testDir: string;
  let testFile: string;
  let storage: ProjectStorage;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-project-storage-"));
    testFile = join(testDir, ".rogatio.json");
    storage = createJsonFileProjectStorage();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("get / create / update round-trip", () => {
    it("round-trips a project document via create then get", async () => {
      const project = { version: 1, name: "RoundTrip", groups: [] };
      const ref = await storage.create({ id: testFile, data: project });

      expect(ref).toEqual({ id: testFile, name: "RoundTrip" });
      await expect(storage.get(testFile)).resolves.toEqual(project);
    });

    it("update replaces the document for an existing id", async () => {
      await storage.create({
        id: testFile,
        data: { version: 1, name: "Before", groups: [] },
      });
      await storage.update(testFile, {
        version: 1,
        name: "After",
        groups: [],
      });

      await expect(storage.get(testFile)).resolves.toEqual({
        version: 1,
        name: "After",
        groups: [],
      });
    });

    it("writes pretty JSON and leaves no leftover temp files", async () => {
      await storage.create({
        id: testFile,
        data: { version: 1, name: "Atomic", groups: [] },
      });

      const raw = await readFile(testFile, "utf-8");
      expect(raw).toBe(
        `${JSON.stringify({ version: 1, name: "Atomic", groups: [] }, null, 2)}`,
      );

      const entries = await readdir(testDir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("persists the default empty document when data is omitted", async () => {
      const ref = await storage.create({ id: testFile });

      expect(ref).toEqual({ id: testFile, name: "" });
      await expect(storage.get(testFile)).resolves.toEqual({
        version: 1,
        name: "",
        groups: [],
      });
    });

    it("fails with already-exists when the id is already present", async () => {
      await storage.create({ id: testFile });
      await expect(storage.create({ id: testFile })).rejects.toMatchObject({
        code: "already-exists",
        id: testFile,
      });
    });

    it("fails with invalid-id when id is omitted or empty", async () => {
      await expect(storage.create({})).rejects.toMatchObject({
        code: "invalid-id",
      });
      await expect(storage.create()).rejects.toMatchObject({
        code: "invalid-id",
      });
      await expect(storage.create({ id: "" })).rejects.toMatchObject({
        code: "invalid-id",
        id: "",
      });
    });

    it("uses own-property name when it is a string, otherwise empty string", async () => {
      const withName = await storage.create({
        id: join(testDir, "named.rogatio.json"),
        data: { version: 1, name: "Named", groups: [] },
      });
      expect(withName.name).toBe("Named");

      const withoutName = await storage.create({
        id: join(testDir, "unnamed.rogatio.json"),
        data: { version: 1, groups: [] },
      });
      expect(withoutName.name).toBe("");

      const inherited = Object.create({ name: "Inherited" }) as {
        version: number;
        groups: unknown[];
      };
      inherited.version = 1;
      inherited.groups = [];
      const fromInherited = await storage.create({
        id: join(testDir, "inherited.rogatio.json"),
        data: inherited,
      });
      expect(fromInherited.name).toBe("");
    });
  });

  describe("get / update not-found and read errors", () => {
    it("fails with not-found when get targets a missing id", async () => {
      await expect(
        storage.get(join(testDir, "missing.json")),
      ).rejects.toMatchObject({
        code: "not-found",
        id: join(testDir, "missing.json"),
      });
    });

    it("fails with not-found when update targets a missing id", async () => {
      await expect(
        storage.update(join(testDir, "missing.json"), {
          version: 1,
          name: "x",
          groups: [],
        }),
      ).rejects.toMatchObject({
        code: "not-found",
        id: join(testDir, "missing.json"),
      });
    });

    it("maps invalid JSON to invalid-json", async () => {
      await writeFile(testFile, "not json", "utf-8");
      await expect(storage.get(testFile)).rejects.toMatchObject({
        code: "invalid-json",
        id: testFile,
      });
    });

    it("maps non-object JSON to invalid-format", async () => {
      await writeFile(testFile, '"string"', "utf-8");
      await expect(storage.get(testFile)).rejects.toMatchObject({
        code: "invalid-format",
        id: testFile,
      });
    });

    it("maps writing to a directory to is-directory via update", async () => {
      await expect(
        storage.update(testDir, { version: 1, name: "x", groups: [] }),
      ).rejects.toMatchObject({
        code: "is-directory",
        id: testDir,
      });
    });

    it("maps reading a directory to read-failed", async () => {
      await expect(storage.get(testDir)).rejects.toMatchObject({
        code: "read-failed",
        id: testDir,
      });
    });

    it("fails with already-exists when create targets an existing directory path", async () => {
      await expect(
        storage.create({
          id: testDir,
          data: { version: 1, name: "x", groups: [] },
        }),
      ).rejects.toMatchObject({
        code: "already-exists",
        id: testDir,
      });
    });
  });

  describe("errors and compat", () => {
    it("throws ProjectStorageError (and ProjectFileError subclass) with path ≡ id", async () => {
      try {
        await storage.get(join(testDir, "missing.json"));
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectStorageError);
        expect(e).toBeInstanceOf(ProjectFileError);
        const err = e as ProjectFileError;
        expect(err.code).toBe("not-found");
        expect(err.id).toBe(err.path);
        expect(err.path).toBe(join(testDir, "missing.json"));
      }
    });

    it("get returns unvalidated unknown without requiring schema fields", async () => {
      const weird = { notAProject: true, nested: { a: 1 } };
      await storage.create({ id: testFile, data: weird });
      const got = await storage.get(testFile);
      expect(got).toEqual(weird);
      expect(typeof got).toBe("object");
    });
  });

  describe("wrapper parity", () => {
    it("readProject delegates to storage.get", async () => {
      const project = { version: 1, name: "ViaWrapper", groups: [] };
      await storage.create({ id: testFile, data: project });
      await expect(readProject(testFile)).resolves.toEqual(project);
    });

    it("writeProject upserts (create when missing, update when present)", async () => {
      const first = { version: 1, name: "First", groups: [] };
      await writeProject(testFile, first);
      await expect(storage.get(testFile)).resolves.toEqual(first);

      const second = { version: 1, name: "Second", groups: [] };
      await writeProject(testFile, second);
      await expect(storage.get(testFile)).resolves.toEqual(second);
      await expect(readProject(testFile)).resolves.toEqual(second);
    });

    it("readProject error codes match storage.get", async () => {
      await writeFile(testFile, "[", "utf-8");
      await expect(readProject(testFile)).rejects.toMatchObject({
        code: "invalid-json",
        path: testFile,
      });
      await expect(storage.get(testFile)).rejects.toMatchObject({
        code: "invalid-json",
        id: testFile,
      });
    });
  });
});
