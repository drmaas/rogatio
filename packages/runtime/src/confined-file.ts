import type { FileHandle } from "node:fs/promises";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { normalizeLogicalPath } from "./path.js";
import { isConfinedFileSupported, openConfinedFile } from "./platform-file.js";
import type { AuthorizedOperation, RuntimeResult } from "./types.js";

export { isConfinedFileSupported } from "./platform-file.js";

async function closeQuietly(file: FileHandle): Promise<void> {
  try {
    await file.close();
  } catch {
    // Cleanup must not replace the stable operation result.
  }
}

export async function readConfinedFile(
  operation: AuthorizedOperation,
  root: string,
  signal?: AbortSignal,
): Promise<RuntimeResult<Uint8Array>> {
  if (operation.kind !== "confined-file") return failure("runtime.file-denied");
  if (!isConfinedFileSupported())
    return failure("runtime.platform-unsupported");
  const logicalPath = normalizeLogicalPath(operation.target);
  if (logicalPath === null) return failure("runtime.file-denied");
  const opened = await openConfinedFile(root, logicalPath);
  if (!opened.ok) return opened;

  const file = opened.value;
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let position = 0;
    while (true) {
      if (signal?.aborted) return failure("runtime.timeout");
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, RUNTIME_LIMITS.maxFileBytes - total + 1),
      );
      const read = await file.read(buffer, 0, buffer.byteLength, position);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
      if (total > RUNTIME_LIMITS.maxFileBytes)
        return failure("runtime.size-limit");
      chunks.push(Uint8Array.from(buffer.subarray(0, read.bytesRead)));
      position += read.bytesRead;
    }
    const finalStat = await file.stat();
    if (
      !finalStat.isFile() ||
      finalStat.nlink > 1 ||
      finalStat.size > RUNTIME_LIMITS.maxFileBytes
    ) {
      return failure(
        finalStat.size > RUNTIME_LIMITS.maxFileBytes
          ? "runtime.size-limit"
          : "runtime.file-race-rejected",
      );
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: output };
  } catch {
    return signal?.aborted
      ? failure("runtime.timeout")
      : failure("runtime.file-denied");
  } finally {
    await closeQuietly(file);
  }
}
