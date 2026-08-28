import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

const SUPPORTED_MIME_TYPES = new Set([
  "application/json",
  "application/x-www-form-urlencoded",
]);
const SUPPORTED_MIME_PREFIXES = ["application/", "text/"];

const FORBIDDEN_HEADERS = new Set([
  "content-md5",
  "digest",
  "content-digest",
  "signature",
  "signature-input",
  "transfer-encoding",
  "trailer",
  "te",
  "expect",
  "upgrade",
  "proxy-authorization",
  "connection",
  "keep-alive",
  "proxy-connection",
]);

const FORBIDDEN_CONTENT_ENCODINGS = new Set([
  "gzip",
  "deflate",
  "br",
  "compress",
]);

export interface RequestWireValidationResult {
  readonly contentType: string;
  readonly contentEncoding: string;
  readonly contentLength: number;
  readonly body: Uint8Array;
}

function isSupportedMimeType(mime: string): boolean {
  const lower = mime.toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(lower)) return true;
  for (const prefix of SUPPORTED_MIME_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

export function validateRequestWire(
  method: string,
  headers: Record<string, string>,
  body: Uint8Array,
): RuntimeResult<RequestWireValidationResult> {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
    return failure("runtime.request-body-unsupported-method");
  }

  const contentLengthHeader = headers["content-length"];
  if (!contentLengthHeader) {
    return failure("runtime.request-body-missing-content-length");
  }
  const contentLength = parseInt(contentLengthHeader, 10);
  if (
    Number.isNaN(contentLength) ||
    contentLength < 0 ||
    contentLength > RUNTIME_LIMITS.maxRequestBodyBytes
  ) {
    return failure("runtime.request-body-invalid-content-length");
  }
  if (body.byteLength !== contentLength) {
    return failure("runtime.request-body-length-mismatch");
  }

  const transferEncoding = headers["transfer-encoding"];
  if (transferEncoding && transferEncoding.toLowerCase() !== "identity") {
    return failure("runtime.request-body-transfer-encoding-forbidden");
  }

  const contentEncoding =
    headers["content-encoding"]?.toLowerCase() || "identity";
  if (contentEncoding !== "identity") {
    if (FORBIDDEN_CONTENT_ENCODINGS.has(contentEncoding)) {
      return failure("runtime.request-body-content-encoding-forbidden");
    }
    return failure("runtime.request-body-unsupported-content-encoding");
  }

  const contentType = headers["content-type"]?.toLowerCase() || "";
  const mediaType = contentType.split(";")[0]?.trim() || "";
  if (!isSupportedMimeType(mediaType)) {
    return failure("runtime.request-body-unsupported-mime-type");
  }
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  if (charsetMatch && charsetMatch[1].toLowerCase() !== "utf-8") {
    return failure("runtime.request-body-invalid-charset");
  }

  for (const forbidden of FORBIDDEN_HEADERS) {
    if (headers[forbidden]) {
      return failure("runtime.request-body-forbidden-header");
    }
  }

  const duplicateLength = Object.keys(headers).filter(
    (k) => k.toLowerCase() === "content-length",
  ).length;
  if (duplicateLength > 1) {
    return failure("runtime.request-body-duplicate-content-length");
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return failure("runtime.request-body-invalid-utf8");
  }

  return {
    ok: true,
    value: {
      contentType: mediaType,
      contentEncoding: "identity",
      contentLength,
      body,
    },
  };
}

export function buildForwardHeaders(
  originalHeaders: Record<string, string>,
  newContentLength: number,
  newContentType: string,
  targetHost: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(originalHeaders)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower)) continue;
    if (lower === "content-length") continue;
    if (lower === "content-encoding") continue;
    if (lower === "host") continue;
    result[key] = value;
  }
  result.host = targetHost;
  result["content-length"] = String(newContentLength);
  if (newContentType) {
    result["content-type"] = newContentType;
  }
  result["content-encoding"] = "identity";
  return result;
}
