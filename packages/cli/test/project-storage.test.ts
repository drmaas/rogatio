import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

  describe("import", () => {
    it("creates a new project when id is missing", async () => {
      const data = { version: 1, name: "Imported", groups: [] };
      const ref = await storage.import(data, { id: testFile });

      expect(ref).toEqual({ id: testFile, name: "Imported" });
      await expect(storage.get(testFile)).resolves.toEqual(data);
    });

    it("replaces an existing project at the same id", async () => {
      await storage.create({
        id: testFile,
        data: { version: 1, name: "Original", groups: [] },
      });
      const replacement = { version: 1, name: "Replaced", groups: [] };
      const ref = await storage.import(replacement, { id: testFile });

      expect(ref).toEqual({ id: testFile, name: "Replaced" });
      await expect(storage.get(testFile)).resolves.toEqual(replacement);
    });

    it("fails with invalid-id when id is omitted or empty", async () => {
      await expect(
        storage.import({ version: 1, name: "x", groups: [] }),
      ).rejects.toMatchObject({ code: "invalid-id" });
      await expect(
        storage.import({ version: 1, name: "x", groups: [] }, {}),
      ).rejects.toMatchObject({ code: "invalid-id" });
      await expect(
        storage.import({ version: 1, name: "x", groups: [] }, { id: "" }),
      ).rejects.toMatchObject({ code: "invalid-id", id: "" });
    });

    it("persists provided data only (no network I/O)", async () => {
      const data = {
        version: 1,
        name: "LocalOnly",
        groups: [],
        note: "caller-supplied",
      };
      await storage.import(data, { id: testFile });
      await expect(storage.get(testFile)).resolves.toEqual(data);
    });
  });

  describe("list", () => {
    it("returns an empty list when scope is omitted", async () => {
      await expect(storage.list()).resolves.toEqual([]);
    });

    it("returns an empty list when scope has no matching files", async () => {
      await writeFile(join(testDir, "readme.txt"), "nope", "utf-8");
      await writeFile(join(testDir, "other.json"), "{}", "utf-8");
      await expect(storage.list(testDir)).resolves.toEqual([]);
    });

    it("lists .rogatio.json and *.rogatio.json non-recursively", async () => {
      const rootExact = join(testDir, ".rogatio.json");
      const rootNamed = join(testDir, "app.rogatio.json");
      const nestedDir = join(testDir, "nested");
      await mkdir(nestedDir);
      const nestedExact = join(nestedDir, ".rogatio.json");
      const nestedNamed = join(nestedDir, "deep.rogatio.json");

      await storage.create({
        id: rootExact,
        data: { version: 1, name: "RootExact", groups: [] },
      });
      await storage.create({
        id: rootNamed,
        data: { version: 1, name: "RootNamed", groups: [] },
      });
      await storage.create({
        id: nestedExact,
        data: { version: 1, name: "NestedExact", groups: [] },
      });
      await storage.create({
        id: nestedNamed,
        data: { version: 1, name: "NestedNamed", groups: [] },
      });
      await writeFile(join(testDir, "skip.json"), "{}", "utf-8");

      const refs = await storage.list(testDir);
      expect(refs).toEqual(
        expect.arrayContaining([
          { id: rootExact, name: "RootExact" },
          { id: rootNamed, name: "RootNamed" },
        ]),
      );
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.id)).not.toContain(nestedExact);
      expect(refs.map((r) => r.id)).not.toContain(nestedNamed);
    });

    it("uses empty name when document name is missing or non-string", async () => {
      const noName = join(testDir, "noname.rogatio.json");
      const badName = join(testDir, "badname.rogatio.json");
      await writeFile(
        noName,
        JSON.stringify({ version: 1, groups: [] }),
        "utf-8",
      );
      await writeFile(
        badName,
        JSON.stringify({ version: 1, name: 42, groups: [] }),
        "utf-8",
      );
      const refs = await storage.list(testDir);
      expect(refs).toContainEqual({ id: noName, name: "" });
      expect(refs).toContainEqual({ id: badName, name: "" });
    });

    it("skips directories whose names match the project filename pattern", async () => {
      await mkdir(join(testDir, "dir.rogatio.json"));
      await storage.create({
        id: join(testDir, "file.rogatio.json"),
        data: { version: 1, name: "File", groups: [] },
      });
      const refs = await storage.list(testDir);
      expect(refs).toEqual([
        { id: join(testDir, "file.rogatio.json"), name: "File" },
      ]);
    });

    it("returns an empty list when scope is an empty string", async () => {
      await expect(storage.list("")).resolves.toEqual([]);
    });
  });

  describe("delete", () => {
    it("unlinks an existing project file", async () => {
      await storage.create({
        id: testFile,
        data: { version: 1, name: "Gone", groups: [] },
      });
      await storage.delete(testFile);
      await expect(access(testFile)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(storage.get(testFile)).rejects.toMatchObject({
        code: "not-found",
        id: testFile,
      });
    });

    it("fails with not-found when the id is missing", async () => {
      await expect(
        storage.delete(join(testDir, "missing.json")),
      ).rejects.toMatchObject({
        code: "not-found",
        id: join(testDir, "missing.json"),
      });
    });
  });
});
