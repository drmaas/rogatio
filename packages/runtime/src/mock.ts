import { randomBytes } from "node:crypto";
import { failure } from "./errors.js";
import { readMockFile } from "./mock-file.js";
import * as platformFile from "./platform-file.js";
import type {
  PresetDigest,
  RuntimeMockConfig,
  RuntimeResult,
} from "./types.js";

export interface RenderedMock {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly bodyBytes: Uint8Array;
}

/** Mint a fresh unguessable per-rule mock token (32 random bytes, hex). */
export function mintToken(): string {
  return randomBytes(32).toString("hex");
}

function headerName(name: string): string {
  return name.toLowerCase();
}

/** Wait for a mock delay. An aborted request cancels the wait. */
function waitForDelay(
  delayMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<RuntimeResult<void>> {
  if (signal?.aborted) return Promise.resolve(failure("runtime.timeout"));
  if (delayMs === undefined || delayMs <= 0) {
    return Promise.resolve({ ok: true, value: undefined });
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(failure("runtime.timeout"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: true, value: undefined });
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Render a mock response. File failures keep their stable codes. HEAD returns
 * the same status and headers with an empty body; Content-Length is the full
 * size. Delay and the file read still run for HEAD.
 */
export async function renderMockResponse(options: {
  readonly mock: RuntimeMockConfig;
  readonly fileRoot: string | undefined;
  readonly presetDigest: PresetDigest;
  readonly method?: string;
  readonly signal?: AbortSignal;
}): Promise<RuntimeResult<RenderedMock>> {
  const { mock, fileRoot, method, signal } = options;
  const waited = await waitForDelay(mock.delayMs, signal);
  if (!waited.ok) return waited;

  let fullBytes: Uint8Array;
  if (mock.body !== undefined) {
    fullBytes = new TextEncoder().encode(mock.body);
  } else if (mock.file !== undefined) {
    if (fileRoot === undefined) return failure("runtime.file-denied");
    if (!platformFile.isConfinedFileSupported()) {
      return failure("runtime.platform-unsupported");
    }
    const read = await readMockFile(fileRoot, mock.file, signal);
    if (!read.ok) return read;
    fullBytes = read.value;
  } else {
    return failure("runtime.file-denied");
  }

  const headers: Array<readonly [string, string]> = [];
  let hasContentType = false;
  let hasCacheControl = false;
  for (const header of mock.headers ?? []) {
    const name = headerName(header.name);
    if (name === "content-length") continue;
    if (name === "content-type") hasContentType = true;
    if (name === "cache-control") hasCacheControl = true;
    headers.push([header.name, header.value]);
  }
  if (!hasContentType) {
    headers.push(["Content-Type", "application/octet-stream"]);
  }
  headers.push(["Content-Length", String(fullBytes.byteLength)]);
  if (!hasCacheControl) headers.push(["Cache-Control", "no-store"]);

  return {
    ok: true,
    value: {
      status: mock.status,
      headers,
      bodyBytes: method === "HEAD" ? new Uint8Array() : fullBytes,
    },
  };
}
