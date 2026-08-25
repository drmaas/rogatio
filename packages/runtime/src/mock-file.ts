import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { normalizeLogicalPath } from "./path.js";
import type { RuntimeResult } from "./types.js";

function withinRoot(root: string, candidate: string): boolean {
  const rest = relative(root, candidate);
  return (
    rest.length > 0 &&
    rest !== ".." &&
    !rest.startsWith(`..${sep}`) &&
    !isAbsolute(rest)
  );
}

/** Read a mock snapshot using portable path and root-containment checks. */
export async function readMockFile(
  root: string,
  logicalPath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const normalized = normalizeLogicalPath(logicalPath);
  if (normalized === null) return failure("runtime.file-denied");

  try {
    const canonicalRoot = await realpath(root);
    const candidate = resolve(canonicalRoot, ...normalized.split("/"));
    const actualPath = await realpath(candidate);
    if (!withinRoot(canonicalRoot, actualPath))
      return failure("runtime.file-denied");

    const metadata = await stat(actualPath);
    if (!metadata.isFile()) return failure("runtime.file-denied");
    if (metadata.size > RUNTIME_LIMITS.maxFileBytes)
      return failure("runtime.size-limit");

    const bytes = await readFile(actualPath);
    if (bytes.byteLength > RUNTIME_LIMITS.maxFileBytes)
      return failure("runtime.size-limit");
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: bytes };
  } catch {
    return failure("runtime.file-denied");
  }
}
