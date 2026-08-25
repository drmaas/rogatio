import { LIMITS } from "@rogatio/schema";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { fetchAuthorized } from "./outbound.js";
import type {
  AuthorizedOperation,
  OutboundOptions,
  RuntimeResult,
} from "./types.js";

export interface ResponseBodyInput {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly body: Uint8Array;
}

export interface ResponseBodyReplacementInput {
  readonly pattern: string;
  readonly replacement: string;
}

export interface ResponseBodyOutput {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface AuthorizedResponseBodyOutput extends ResponseBodyOutput {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
}

function supportedContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "text/css" ||
    mediaType === "application/xml" ||
    mediaType === "text/xml"
  );
}

function responseHeader(
  headers: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  return headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

export async function rewriteResponseBody(
  input: ResponseBodyInput,
  replacements: readonly ResponseBodyReplacementInput[],
): Promise<RuntimeResult<ResponseBodyOutput>> {
  if (
    !supportedContentType(input.contentType) ||
    input.contentType === undefined
  )
    return failure("runtime.size-limit");
  if (
    input.contentEncoding !== undefined &&
    input.contentEncoding !== "identity"
  )
    return failure("runtime.size-limit");
  if (
    input.body.byteLength > RUNTIME_LIMITS.maxResponseBodyBytes ||
    replacements.length === 0 ||
    replacements.length > LIMITS.maxResponseBodyReplacements
  )
    return failure("runtime.size-limit");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  } catch {
    return failure("runtime.size-limit");
  }

  try {
    for (const entry of replacements) {
      if (
        entry.pattern.length === 0 ||
        entry.pattern.length > LIMITS.maxResponseBodyPatternLength ||
        entry.replacement.length > LIMITS.maxResponseBodyReplacementLength
      )
        return failure("runtime.size-limit");
      const regex = new RegExp(entry.pattern, "gu");
      text = text.replace(regex, entry.replacement);
      if (
        new TextEncoder().encode(text).byteLength >
        RUNTIME_LIMITS.maxResponseBodyBytes
      )
        return failure("runtime.size-limit");
    }
  } catch {
    return failure("runtime.invalid-canonical-value");
  }

  return {
    ok: true,
    value: {
      body: new TextEncoder().encode(text),
      contentType:
        input.contentType.split(";", 1)[0]?.trim() ?? input.contentType,
    },
  };
}

/** Fetch and rewrite one already-authorized operation entirely in the runtime. */
export async function fetchAndRewriteAuthorizedResponse(
  operation: AuthorizedOperation,
  replacements: readonly ResponseBodyReplacementInput[],
  options: OutboundOptions = {},
): Promise<RuntimeResult<AuthorizedResponseBodyOutput>> {
  if (operation.kind !== "outbound-http" || operation.method !== "GET")
    return failure("runtime.unsupported-method");
  const response = await fetchAuthorized(operation, options);
  if (!response.ok) return response;
  const rewritten = await rewriteResponseBody(
    {
      contentType: responseHeader(response.value.headers, "content-type"),
      contentEncoding: responseHeader(
        response.value.headers,
        "content-encoding",
      ),
      body: response.value.body,
    },
    replacements,
  );
  if (!rewritten.ok) return rewritten;
  return {
    ok: true,
    value: {
      ...rewritten.value,
      status: response.value.status,
      headers: response.value.headers,
    },
  };
}
