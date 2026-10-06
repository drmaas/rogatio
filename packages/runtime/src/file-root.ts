import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { failure } from "./errors.js";
import type { RuntimeResult } from "./types.js";

/**
 * Accept only an absolute path to an existing directory, and keep its real
 * path. A relative, missing, or non-directory root is rejected. The process
 * working directory is never a substitute.
 */
export async function resolveConfinedRoot(
  value: unknown,
): Promise<RuntimeResult<string>> {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    return failure("runtime.root-invalid");
  }
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  try {
    directory = await open(value, constants.O_RDONLY | constants.O_DIRECTORY);
    const info = await directory.stat();
    if (!info.isDirectory()) return failure("runtime.root-invalid");
    return { ok: true, value: await realpath(value) };
  } catch {
    return failure("runtime.root-invalid");
  } finally {
    await directory?.close().catch(() => undefined);
  }
}
