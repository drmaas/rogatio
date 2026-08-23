import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeAuthorizationDescriptor } from "./authorization.js";
import { canonicalDescriptor } from "./canonical.js";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeErrorCode, RuntimeGrant, RuntimeResult } from "./types.js";

export const CAPABILITY_HEADER = "x-rogatio-capability";
export const SESSION_CAPABILITY_HEADER = "x-rogatio-session-capability";
export const PRESET_DIGEST_HEADER = "x-rogatio-preset-digest";

type RequestValidation =
  | { readonly ok: true; readonly contentLength: number }
  | { readonly ok: false; readonly code: RuntimeErrorCode };

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  let value: string | undefined;
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== name) continue;
    count += 1;
    value = request.rawHeaders[index + 1];
  }
  return count === 1 ? value : undefined;
}

function hasHeader(request: IncomingMessage, name: string): boolean {
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) return true;
  }
  return false;
}

function validContentLength(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

export function validateRequest(
  request: IncomingMessage,
  path: string,
): RequestValidation {
  if (request.rawHeaders.length / 2 > RUNTIME_LIMITS.maxHeaderCount) {
    return { ok: false, code: "runtime.headers-too-large" };
  }
  let headerBytes = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headerBytes += Buffer.byteLength(request.rawHeaders[index] ?? "");
    headerBytes += Buffer.byteLength(request.rawHeaders[index + 1] ?? "");
    headerBytes += 4;
  }
  if (headerBytes > RUNTIME_LIMITS.maxRequestHeaderBytes) {
    return { ok: false, code: "runtime.headers-too-large" };
  }

  const requestLine = `${request.method ?? ""} ${request.url ?? ""} HTTP/${request.httpVersion}`;
  if (Buffer.byteLength(requestLine) > RUNTIME_LIMITS.maxRequestLineBytes) {
    return { ok: false, code: "runtime.headers-too-large" };
  }
  if (
    request.socket.remoteAddress !== "127.0.0.1" ||
    request.httpVersion !== "1.1" ||
    request.method !== "POST" ||
    request.url !== path
  ) {
    return { ok: false, code: "runtime.request-malformed" };
  }

  const connection = singleHeader(request, "connection");
  if (connection?.toLowerCase() !== "close") {
    return { ok: false, code: "runtime.request-malformed" };
  }
  if (
    hasHeader(request, "transfer-encoding") ||
    hasHeader(request, "expect") ||
    hasHeader(request, "upgrade")
  ) {
    return { ok: false, code: "runtime.request-malformed" };
  }

  const contentLength = validContentLength(
    singleHeader(request, "content-length"),
  );
  if (contentLength === null) {
    return { ok: false, code: "runtime.request-malformed" };
  }
  return { ok: true, contentLength };
}

export async function readBody(
  request: IncomingMessage,
  contentLength: number,
  maxBytes: number,
): Promise<RuntimeResult<Uint8Array>> {
  if (contentLength > maxBytes) {
    request.resume();
    return failure("runtime.body-too-large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maxBytes) {
        request.destroy();
        return failure("runtime.body-too-large");
      }
      chunks.push(bytes);
    }
  } catch {
    return failure("runtime.request-malformed");
  }
  if (total !== contentLength) return failure("runtime.request-malformed");
  return { ok: true, value: Buffer.concat(chunks) };
}

export function parseCanonicalDescriptor(
  body: Uint8Array,
): RuntimeResult<RuntimeGrant> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return failure("runtime.request-malformed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return failure("runtime.request-malformed");
  }
  const normalized = normalizeAuthorizationDescriptor(parsed);
  if (!normalized.ok) return normalized;
  const canonical = canonicalDescriptor(normalized.value);
  if (canonical !== text) return failure("runtime.request-malformed");
  return normalized;
}

export function header(
  request: IncomingMessage,
  name: string,
): string | undefined {
  return singleHeader(request, name);
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  response.statusCode = status;
  response.shouldKeepAlive = false;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", bytes.byteLength);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.removeHeader("Date");
  response.end(bytes);
}

export function sendError(
  response: ServerResponse,
  status: number,
  code: RuntimeErrorCode,
): void {
  sendJson(response, status, { ok: false, error: { code } });
}

export function statusForError(code: RuntimeErrorCode): number {
  switch (code) {
    case "runtime.headers-too-large":
      return 431;
    case "runtime.body-too-large":
      return 413;
    case "runtime.pairing-denied":
    case "runtime.authorization-denied":
      return 401;
    case "runtime.overloaded":
      return 429;
    case "runtime.timeout":
      return 408;
    case "runtime.internal":
      return 500;
    default:
      return 400;
  }
}
