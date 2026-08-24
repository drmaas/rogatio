import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readConfinedFile } from "./confined-file.js";
import type {
  AuthorizedOperation,
  PresetDigest,
  RuntimeMockConfig,
} from "./types.js";

const MOCK_PREFIX = "/mock/";

/** Mint a fresh unguessable per-rule mock token (32 random bytes, hex). */
export function mintToken(): string {
  return randomBytes(32).toString("hex");
}

/** Extract the token from a `/mock/<token>` request path, or null. */
export function parseMockToken(path: string | undefined): string | null {
  if (typeof path !== "string" || !path.startsWith(MOCK_PREFIX)) return null;
  const token = path.slice(MOCK_PREFIX.length);
  if (
    token.length === 0 ||
    token.includes("/") ||
    token.includes("?") ||
    token.includes("#")
  ) {
    return null;
  }
  return token;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function sendMockFailure(
  response: ServerResponse,
  status: number,
  code: string,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.removeHeader("Date");
  response.end(JSON.stringify({ ok: false, error: { code } }));
}

export async function serveMock(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly mock: RuntimeMockConfig;
  readonly fileRoot: string | undefined;
  readonly presetDigest: PresetDigest;
  readonly groupId: string;
  readonly signal: AbortSignal;
}): Promise<void> {
  const { request, response, mock, fileRoot, presetDigest, groupId, signal } =
    options;
  const method = request.method ?? "GET";

  if (method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Max-Age", "86400");
    response.setHeader("Connection", "close");
    response.end();
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET, HEAD, OPTIONS");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Connection", "close");
    response.end();
    return;
  }

  try {
    await abortableDelay(mock.delayMs ?? 0, signal);
  } catch {
    response.destroy();
    return;
  }

  let bodyBytes: Uint8Array;
  if (mock.body !== undefined) {
    bodyBytes = new TextEncoder().encode(mock.body);
  } else if (mock.file !== undefined) {
    if (fileRoot === undefined) {
      sendMockFailure(response, 500, "runtime.file-denied");
      return;
    }
    const operation: AuthorizedOperation = {
      groupId,
      ruleId: mock.ruleId,
      operationId: `mock:${mock.ruleId}`,
      kind: "confined-file",
      target: mock.file,
      method: "GET",
      presetDigest,
    };
    const read = await readConfinedFile(operation, fileRoot, signal);
    if (!read.ok) {
      sendMockFailure(response, 500, "runtime.file-denied");
      return;
    }
    try {
      // Fatal UTF-8 validation: the file must be valid UTF-8 text.
      new TextDecoder("utf-8", { fatal: true }).decode(read.value);
    } catch {
      sendMockFailure(response, 500, "runtime.file-denied");
      return;
    }
    bodyBytes = read.value;
  } else {
    sendMockFailure(response, 500, "runtime.file-denied");
    return;
  }

  response.statusCode = mock.status;
  response.setHeader("Access-Control-Allow-Origin", "*");
  const headers = mock.headers ?? [];
  const hasContentType = headers.some(
    (header) => header.name.toLowerCase() === "content-type",
  );
  if (!hasContentType) {
    response.setHeader("Content-Type", "text/plain; charset=UTF-8");
  }
  try {
    for (const header of headers) {
      response.setHeader(header.name, header.value);
    }
  } catch {
    sendMockFailure(response, 500, "runtime.mock-headers");
    return;
  }
  response.setHeader("Content-Length", bodyBytes.byteLength);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.removeHeader("Date");
  if (method === "HEAD") {
    response.end();
  } else {
    response.end(bodyBytes);
  }
}
