import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

export function isConfinedFileSupported(): boolean {
  return (
    (process.platform === "linux" || process.platform === "darwin") &&
    typeof constants.O_NOFOLLOW === "number"
  );
}

function withinRoot(root: string, candidate: string): boolean {
  const rest = relative(root, candidate);
  return (
    rest.length > 0 &&
    rest !== ".." &&
    !rest.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(rest)
  );
}

export async function openConfinedFile(
  root: string,
  logicalPath: string,
): Promise<RuntimeResult<FileHandle>> {
  if (!isConfinedFileSupported())
    return failure("runtime.platform-unsupported");
  try {
    const canonicalRoot = await realpath(root);
    const candidate = `${canonicalRoot}/${logicalPath}`;
    const file = await import("node:fs/promises").then(({ open }) =>
      open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW),
    );
    // Resolve the candidate path (not the `/dev/fd/N` descriptor, whose
    // realpath is unreliable on macOS) so the containment check is consistent
    // across platforms and still rejects intermediate symlink escapes.
    const actualPath = await realpath(candidate);
    if (!withinRoot(canonicalRoot, actualPath)) {
      await file.close();
      return failure("runtime.file-race-rejected");
    }
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      return failure("runtime.file-denied");
    }
    if (stat.nlink > 1) {
      await file.close();
      return failure("runtime.file-race-rejected");
    }
    if (stat.size > RUNTIME_LIMITS.maxFileBytes) {
      await file.close();
      return failure("runtime.size-limit");
    }
    return { ok: true, value: file };
  } catch {
    return failure("runtime.file-denied");
  }
}
