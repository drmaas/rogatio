import {
  LIMITS,
  matchUrlCaptures,
  type ResponseBodyAction,
  type ResponseBodyReplaceAction,
  substituteUrlCaptures,
} from "@rogatio/schema";
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

export interface UrlCaptureContext {
  readonly url: string;
  readonly urlRegex: string;
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

function responseBodyReplacements(
  action: ResponseBodyAction,
): readonly ResponseBodyReplacementInput[] {
  if ("replacements" in action && Array.isArray(action.replacements)) {
    return action.replacements;
  }
  return [];
}

function isReplaceAction(
  action: ResponseBodyAction,
): action is ResponseBodyReplaceAction {
  return "mode" in action && action.mode === "replace";
}

export async function rewriteResponseBody(
  input: ResponseBodyInput,
  replacements: readonly ResponseBodyReplacementInput[],
  replaceAction?: ResponseBodyReplaceAction,
  captureContext?: UrlCaptureContext,
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
    (replaceAction === undefined && replacements.length === 0) ||
    replacements.length > LIMITS.maxResponseBodyReplacements
  )
    return failure("runtime.size-limit");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  } catch {
    return failure("runtime.size-limit");
  }

  if (replaceAction !== undefined) {
    if (captureContext === undefined) {
      text = replaceAction.body;
    } else {
      const captures = matchUrlCaptures(
        captureContext.urlRegex,
        captureContext.url,
      );
      if (captures === null) return failure("runtime.url-capture-mismatch");
      text = substituteUrlCaptures(replaceAction.body, captures);
    }
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

function replaceResponseBody(
  body: string,
  contentType: string | undefined,
  captureContext?: UrlCaptureContext,
): RuntimeResult<ResponseBodyOutput> {
  const captures =
    captureContext === undefined
      ? []
      : matchUrlCaptures(captureContext.urlRegex, captureContext.url);
  if (captureContext !== undefined && captures === null) {
    return failure("runtime.url-capture-mismatch");
  }
  const expanded =
    captureContext === undefined
      ? body
      : substituteUrlCaptures(body, captures ?? []);
  const encoded = new TextEncoder().encode(expanded);
  if (encoded.byteLength > RUNTIME_LIMITS.maxResponseBodyBytes)
    return failure("runtime.size-limit");
  return {
    ok: true,
    value: {
      body: encoded,
      contentType: contentType?.split(";", 1)[0]?.trim() ?? "text/plain",
    },
  };
}

/** Fetch and rewrite one already-authorized operation entirely in the runtime. */
export async function fetchAndRewriteAuthorizedResponse(
  operation: AuthorizedOperation,
  action: ResponseBodyAction,
  options: OutboundOptions = {},
): Promise<RuntimeResult<AuthorizedResponseBodyOutput>> {
  if (operation.kind !== "outbound-http" || operation.method !== "GET")
    return failure("runtime.unsupported-method");
  const response = await fetchAuthorized(operation, options);
  if (!response.ok) return response;

  const contentType = responseHeader(response.value.headers, "content-type");
  const transformed = isReplaceAction(action)
    ? replaceResponseBody(
        action.body,
        contentType,
        operation.sourceValue === undefined
          ? undefined
          : { url: operation.target, urlRegex: operation.sourceValue },
      )
    : await rewriteResponseBody(
        {
          contentType,
          contentEncoding: responseHeader(
            response.value.headers,
            "content-encoding",
          ),
          body: response.value.body,
        },
        responseBodyReplacements(action),
      );
  if (!transformed.ok) return transformed;
  return {
    ok: true,
    value: {
      ...transformed.value,
      status: response.value.status,
      headers: response.value.headers,
    },
  };
}
