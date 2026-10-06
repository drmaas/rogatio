import { readConfinedPathBytes } from "./confined-file.js";
import type { RuntimeResult } from "./types.js";

/** Read a mock snapshot through the shared descriptor-based confined reader. */
export async function readMockFile(
  root: string,
  logicalPath: string,
  signal?: AbortSignal,
): Promise<RuntimeResult<Uint8Array>> {
  return readConfinedPathBytes(root, logicalPath, signal);
}
