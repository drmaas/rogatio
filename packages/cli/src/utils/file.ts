import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type ProjectStorageErrorCode =
  | "not-found"
  | "already-exists"
  | "invalid-id"
  | "invalid-json"
  | "invalid-format"
  | "read-failed"
  | "write-failed"
  | "delete-failed"
  | "is-directory";

export class ProjectStorageError extends Error {
  readonly code: ProjectStorageErrorCode;
  readonly id: string;

  constructor(
    code: ProjectStorageErrorCode,
    id: string,
    message: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "ProjectStorageError";
    this.code = code;
    this.id = id;
  }
}

/** Compat subclass: `path` is an alias for storage `id` (filesystem path). */
export class ProjectFileError extends ProjectStorageError {
  constructor(
    code: ProjectStorageErrorCode,
    path: string,
    message: string,
    cause?: Error,
  ) {
    super(code, path, message, cause);
    this.name = "ProjectFileError";
  }

  get path(): string {
    return this.id;
  }
}

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Application-facing project lifecycle persistence.
 * Groups/rules are nested inside each project document — not separate resources.
 * `id` is backend-defined (filesystem path for JSON-file; uuid/URI for future backends).
 */
export interface ProjectStorage {
  list(scope?: string): Promise<readonly ProjectRef[]>;
  get(id: string): Promise<unknown>;
  create(options?: { id?: string; data?: unknown }): Promise<ProjectRef>;
  import(data: unknown, options?: { id?: string }): Promise<ProjectRef>;
  update(id: string, data: unknown): Promise<void>;
  delete(id: string): Promise<void>;
}

function isRogatioProjectFilename(name: string): boolean {
  return name === ".rogatio.json" || name.endsWith(".rogatio.json");
}

function projectName(data: unknown): string {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }
  if (!Object.hasOwn(data, "name")) {
    return "";
  }
  const name = (data as { name: unknown }).name;
  return typeof name === "string" ? name : "";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw e;
  }
}

async function readDocument(id: string): Promise<unknown> {
  try {
    const content = await readFile(id, "utf-8");
    const parsed = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new ProjectFileError(
        "invalid-format",
        id,
        "Project file must contain a JSON object",
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof ProjectFileError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectFileError(
        "not-found",
        id,
        "Project file not found",
        e as Error,
      );
    }
    if (e instanceof SyntaxError) {
      throw new ProjectFileError(
        "invalid-json",
        id,
        "Project file contains invalid JSON",
        e,
      );
    }
    throw new ProjectFileError(
      "read-failed",
      id,
      "Failed to read project file",
      e as Error,
    );
  }
}

async function writeDocument(id: string, data: unknown): Promise<void> {
  const tempName = `.${basename(dirname(id))}.${randomBytes(8).toString("hex")}.tmp`;
  const tempPath = join(dirname(id), tempName);

  try {
    await mkdir(dirname(id), { recursive: true });
    await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tempPath, id);
  } catch (e) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    if ((e as NodeJS.ErrnoException).code === "EISDIR") {
      throw new ProjectFileError(
        "is-directory",
        id,
        "Target path is a directory",
        e as Error,
      );
    }
    throw new ProjectFileError(
      "write-failed",
      id,
      "Failed to write project file",
      e as Error,
    );
  }
}

export function createJsonFileProjectStorage(): ProjectStorage {
  return {
    async list(scope?: string): Promise<readonly ProjectRef[]> {
      if (scope === undefined || scope === "") {
        return [];
      }

      let entries: Dirent[];
      try {
        entries = await readdir(scope, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw new ProjectFileError(
          "read-failed",
          scope,
          "Failed to list project files",
          e as Error,
        );
      }

      const refs: ProjectRef[] = [];
      for (const entry of entries) {
        // Files and symlinks only — skip directories that happen to match the name pattern.
        if (entry.isDirectory() || !isRogatioProjectFilename(entry.name)) {
          continue;
        }
        const id = join(scope, entry.name);
        let name = "";
        try {
          const data = await readDocument(id);
          name = projectName(data);
        } catch {
          name = "";
        }
        refs.push({ id, name });
      }
      return refs;
    },

    async get(id: string): Promise<unknown> {
      return readDocument(id);
    },

    async create(options?: {
      id?: string;
      data?: unknown;
    }): Promise<ProjectRef> {
      const id = options?.id;
      if (id === undefined || id === "") {
        throw new ProjectFileError(
          "invalid-id",
          id ?? "",
          "JSON-file project storage requires an id (filesystem path)",
        );
      }

      if (await pathExists(id)) {
        throw new ProjectFileError(
          "already-exists",
          id,
          "Project already exists",
        );
      }

      const data =
        options?.data === undefined
          ? { version: 1, name: "", groups: [] }
          : options.data;
      await writeDocument(id, data);
      return { id, name: projectName(data) };
    },

    async import(
      data: unknown,
      options?: { id?: string },
    ): Promise<ProjectRef> {
      const id = options?.id;
      if (id === undefined || id === "") {
        throw new ProjectFileError(
          "invalid-id",
          id ?? "",
          "JSON-file project storage requires an id (filesystem path)",
        );
      }
      await writeDocument(id, data);
      return { id, name: projectName(data) };
    },

    async update(id: string, data: unknown): Promise<void> {
      if (!(await pathExists(id))) {
        throw new ProjectFileError("not-found", id, "Project file not found");
      }
      await writeDocument(id, data);
    },

    async delete(id: string): Promise<void> {
      try {
        await unlink(id);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ProjectFileError(
            "not-found",
            id,
            "Project file not found",
            e as Error,
          );
        }
        throw new ProjectFileError(
          "delete-failed",
          id,
          "Failed to delete project file",
          e as Error,
        );
      }
    },
  };
}

const defaultStorage = createJsonFileProjectStorage();

/** Compat wrapper: delegates to JSON-file storage `get`. */
export async function readProject(path: string): Promise<unknown> {
  return defaultStorage.get(path);
}

/** Compat wrapper: upsert via update, or create when missing. */
export async function writeProject(path: string, data: unknown): Promise<void> {
  try {
    await defaultStorage.update(path, data);
  } catch (e) {
    if (e instanceof ProjectStorageError && e.code === "not-found") {
      await defaultStorage.create({ id: path, data });
      return;
    }
    throw e;
  }
}
