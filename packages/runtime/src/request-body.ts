import { Worker } from "node:worker_threads";
import { LIMITS } from "@rogatio/schema";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

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

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) return true;
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      if (i === 0) return true;
      const prev = value.charCodeAt(i - 1);
      if (prev < 0xd800 || prev > 0xdbff) return true;
    }
  }
  return false;
}

function runRegexReplace(
  text: string,
  pattern: string,
  replacement: string,
  deadlineMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let worker: Worker | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) {
        worker.terminate().catch(() => {});
      }
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("deadline")));
    }, deadlineMs);

    try {
      worker = new Worker(
        `
        const { parentPort } = require("worker_threads");
        parentPort.on("message", (msg) => {
          try {
            const out = msg.text.replace(new RegExp(msg.pattern, "gu"), msg.replacement);
            parentPort.postMessage({ ok: true, out });
          } catch (err) {
            parentPort.postMessage({
              ok: false,
              error: String((err && err.message) || err),
            });
          }
        });
        `,
        { eval: true },
      );
    } catch {
      try {
        const out = text.replace(new RegExp(pattern, "gu"), replacement);
        finish(() => resolve(out));
        return;
      } catch {
        finish(() => reject(new Error("regex-invalid")));
        return;
      }
    }

    worker.on(
      "message",
      (msg: { ok: boolean; out?: string; error?: string }) => {
        finish(() => {
          if (msg.ok && typeof msg.out === "string") resolve(msg.out);
          else reject(new Error(msg.error || "regex-invalid"));
        });
      },
    );
    worker.on("error", (err: Error) => {
      finish(() => reject(err));
    });
    worker.postMessage({ text, pattern, replacement });
  });
}

export async function rewriteRequestBody(
  input: RequestBodyInput,
  action: RequestBodyAction,
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
