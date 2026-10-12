import {
  hasLoneSurrogate,
  LIMITS,
  matchUrlCaptures,
  substituteUrlCaptures,
} from "@rogatio/schema";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { runRegexReplace } from "./regex-replace.js";
import type { RuntimeResult } from "./types.js";

export { __resetRegexWorkerForTests } from "./regex-replace.js";

export interface RequestBodyInput {
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly body: Uint8Array;
}

export interface RequestBodyReplaceAction {
  readonly mode: "replace";
  readonly body: string;
}

export interface RequestBodyRegexAction {
  readonly mode: "regex";
  readonly pattern: string;
  readonly replacement: string;
}

export type RequestBodyAction =
  | RequestBodyReplaceAction
  | RequestBodyRegexAction;

export interface RequestBodyOutput {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface UrlCaptureContext {
  readonly url: string;
  readonly urlRegex: string;
}

function supportedContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json")) ||
    mediaType === "application/x-www-form-urlencoded" ||
    mediaType.startsWith("text/")
  );
}

export async function rewriteRequestBody(
  input: RequestBodyInput,
  action: RequestBodyAction,
  captureContext?: UrlCaptureContext,
): Promise<RuntimeResult<RequestBodyOutput>> {
  if (!supportedContentType(input.contentType)) {
    return failure("runtime.request-body-unsupported-mime-type");
  }
  if (
    input.contentEncoding !== undefined &&
    input.contentEncoding !== "identity"
  ) {
    return failure("runtime.request-body-unsupported-content-encoding");
  }
  if (input.body.byteLength > RUNTIME_LIMITS.maxRequestBodyBytes) {
    return failure("runtime.body-too-large");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  } catch {
    return failure("runtime.request-body-invalid-utf8");
  }

  if (hasLoneSurrogate(text)) {
    return failure("runtime.request-body-lone-surrogate");
  }

  let outputText: string;
  if (action.mode === "replace") {
    if (hasLoneSurrogate(action.body)) {
      return failure("runtime.request-body-lone-surrogate");
    }
    outputText = action.body;
    if (captureContext !== undefined) {
      const captures = matchUrlCaptures(
        captureContext.urlRegex,
        captureContext.url,
      );
      if (captures === null) return failure("runtime.url-capture-mismatch");
      outputText = substituteUrlCaptures(outputText, captures);
    }
  } else {
    if (action.pattern.length === 0) {
      return failure("runtime.request-body-regex-missing-pattern");
    }
    if (action.pattern.length > LIMITS.maxRequestBodyPatternLength) {
      return failure("runtime.request-body-regex-pattern-too-large");
    }
    if (action.replacement.length > LIMITS.maxRequestBodyReplacementLength) {
      return failure("runtime.request-body-regex-replacement-too-large");
    }
    if (hasLoneSurrogate(action.replacement)) {
      return failure("runtime.request-body-lone-surrogate");
    }
    try {
      outputText = await runRegexReplace(
        text,
        action.pattern,
        action.replacement,
        RUNTIME_LIMITS.maxRegexDeadlineMs,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "deadline") {
        return failure("runtime.request-body-regex-deadline-exceeded");
      }
      return failure("runtime.request-body-regex-invalid");
    }
  }

  const outputBytes = new TextEncoder().encode(outputText);
  if (outputBytes.byteLength > RUNTIME_LIMITS.maxRequestBodyBytes) {
    return failure("runtime.request-body-replace-too-large");
  }

  return {
    ok: true,
    value: {
      body: outputBytes,
      contentType:
        input.contentType?.split(";", 1)[0]?.trim() ??
        "application/octet-stream",
    },
  };
}
