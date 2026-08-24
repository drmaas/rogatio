import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export class ProjectFileError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string, cause?: Error) {
    super(message, { cause });
    this.name = "ProjectFileError";
    this.code = code;
    this.path = path;
  }
}

export async function readProject(path: string): Promise<unknown> {
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new ProjectFileError(
        "invalid-format",
        path,
        "Project file must contain a JSON object",
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof ProjectFileError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectFileError(
        "not-found",
        path,
        "Project file not found",
        e as Error,
      );
    }
    if (e instanceof SyntaxError) {
      throw new ProjectFileError(
        "invalid-json",
        path,
        "Project file contains invalid JSON",
        e,
      );
    }
    throw new ProjectFileError(
      "read-failed",
      path,
      "Failed to read project file",
      e as Error,
    );
  }
}

export async function writeProject(path: string, data: unknown): Promise<void> {
  const tempName = `.${basename(dirname(path))}.${randomBytes(8).toString("hex")}.tmp`;
  const tempPath = join(dirname(path), tempName);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tempPath, path);
  } catch (e) {
    // Cleanup temp file on error
    try {
      await import("node:fs/promises").then((fs) => fs.unlink(tempPath));
    } catch {
      // Ignore cleanup errors
    }

    if ((e as NodeJS.ErrnoException).code === "EISDIR") {
      throw new ProjectFileError(
        "is-directory",
        path,
        "Target path is a directory",
        e as Error,
      );
    }
    throw new ProjectFileError(
      "write-failed",
      path,
      "Failed to write project file",
      e as Error,
    );
  }
}
