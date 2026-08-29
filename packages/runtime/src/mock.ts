import { randomBytes } from "node:crypto";
import { failure } from "./errors.js";
import { readMockFile } from "./mock-file.js";
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

/**
 * Render a mock response into raw bytes for transport over the native-messaging
 * envelope as base64 `mockBody` (spec REQ-003). No HTTP dependency.
 */
export async function renderMockResponse(options: {
  readonly mock: RuntimeMockConfig;
  readonly fileRoot: string | undefined;
  readonly presetDigest: PresetDigest;
}): Promise<RuntimeResult<RenderedMock>> {
  const { mock, fileRoot } = options;

  let bodyBytes: Uint8Array;
  if (mock.body !== undefined) {
    bodyBytes = new TextEncoder().encode(mock.body);
  } else if (mock.file !== undefined) {
    if (fileRoot === undefined) return failure("runtime.file-denied");
    const read = await readMockFile(fileRoot, mock.file);
    if (!read.ok) return failure("runtime.file-denied");
    bodyBytes = read.value;
  } else {
    return failure("runtime.file-denied");
  }

  const headers: Array<readonly [string, string]> = [];
  let hasContentType = false;
  for (const header of mock.headers ?? []) {
    headers.push([header.name, header.value]);
    if (header.name.toLowerCase() === "content-type") hasContentType = true;
  }
  if (!hasContentType) {
    headers.push(["Content-Type", "text/plain; charset=UTF-8"]);
  }
  headers.push(["Content-Length", String(bodyBytes.byteLength)]);
  headers.push(["Cache-Control", "no-store"]);

  return {
    ok: true,
    value: {
      status: mock.status,
      headers,
      bodyBytes,
    },
  };
}
