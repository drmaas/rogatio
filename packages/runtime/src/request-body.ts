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

// The worker script announces readiness, acknowledges each job before running
// it, then posts the result. The ack lets the caller start the execution
// deadline only when the replace actually begins, so slow worker boot (for
// example on cold CI runners) can never consume the regex deadline.
const REGEX_WORKER_SOURCE = `
const workerThreads =
  typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("worker_threads")
    : require("worker_threads");
const { parentPort } = workerThreads;
parentPort.postMessage({ type: "ready" });
parentPort.on("message", (msg) => {
  if (msg.type !== "replace") return;
  parentPort.postMessage({ id: msg.id, type: "ack" });
  try {
    const out = msg.text.replace(new RegExp(msg.pattern, "gu"), msg.replacement);
    parentPort.postMessage({ id: msg.id, type: "result", ok: true, out });
  } catch (err) {
    parentPort.postMessage({
      id: msg.id,
      type: "result",
      ok: false,
      error: String((err && err.message) || err),
    });
  }
});
`;

// Booting the shared worker is infrastructure setup, not regex execution, so
// it gets its own generous bound instead of the per-request regex deadline.
const REGEX_WORKER_BOOT_TIMEOUT_MS = 5_000;

let regexWorker: Worker | null = null;
let regexWorkerBoot: Promise<Worker> | null = null;
let nextRegexJobId = 1;

// Test-only seam state: delays the next worker boot (see
// __resetRegexWorkerForTests). Consumed by a single boot, then reset to zero.
let regexWorkerBootDelayForTestsMs = 0;

// Test-only: discards any warm worker and delays the next boot so tests on
// fast machines can simulate cold CI runners. Pass 0 to only reset state.
export function __resetRegexWorkerForTests(bootDelayMs = 0): void {
  const worker = regexWorker;
  regexWorker = null;
  regexWorkerBoot = null;
  regexWorkerBootDelayForTestsMs = bootDelayMs;
  if (worker !== null) worker.terminate().catch(() => {});
}

function discardRegexWorker(worker: Worker): void {
  if (regexWorker === worker) {
    regexWorker = null;
    regexWorkerBoot = null;
  }
  worker.terminate().catch(() => {});
}

function bootRegexWorker(): Promise<Worker> {
  if (regexWorker !== null) return Promise.resolve(regexWorker);
  if (regexWorkerBoot !== null) return regexWorkerBoot;
  const boot = new Promise<Worker>((resolve, reject) => {
    const start = () => {
      let worker: Worker;
      try {
        worker = new Worker(REGEX_WORKER_SOURCE, { eval: true });
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("regex-worker-boot-failed"),
        );
        return;
      }
      let settled = false;
      const bootTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        regexWorkerBoot = null;
        worker.terminate().catch(() => {});
        reject(new Error("regex-worker-boot-timeout"));
      }, REGEX_WORKER_BOOT_TIMEOUT_MS);
      worker.once("message", () => {
        if (settled) return;
        settled = true;
        clearTimeout(bootTimer);
        // Unref so a warm idle worker never keeps a short-lived CLI or test
        // process alive.
        worker.unref();
        // Swallow late errors while idle; per-request listeners handle the rest.
        worker.on("error", () => {});
        worker.once("exit", () => {
          if (regexWorker === worker) {
            regexWorker = null;
            regexWorkerBoot = null;
          }
        });
        regexWorker = worker;
        resolve(worker);
      });
      worker.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(bootTimer);
        regexWorkerBoot = null;
        reject(error);
      });
      worker.once("exit", () => {
        if (settled) return;
        settled = true;
        clearTimeout(bootTimer);
        regexWorkerBoot = null;
        reject(new Error("regex-worker-exit-during-boot"));
      });
    };
    if (regexWorkerBootDelayForTestsMs > 0) {
      const delay = regexWorkerBootDelayForTestsMs;
      regexWorkerBootDelayForTestsMs = 0;
      setTimeout(start, delay).unref();
    } else {
      start();
    }
  });
  regexWorkerBoot = boot;
  // Never cache a rejected boot: a transient failure must not silently
  // downgrade every future regex replace to the unprotected inline path.
  void boot.catch(() => {
    if (regexWorkerBoot === boot) regexWorkerBoot = null;
  });
  return boot;
}

function runOnRegexWorker(
  worker: Worker,
  id: number,
  text: string,
  pattern: string,
  replacement: string,
  deadlineMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const onMessage = (msg: {
      id?: number;
      type?: string;
      ok?: boolean;
      out?: string;
      error?: string;
    }) => {
      if (msg.id !== id) return;
      if (msg.type === "ack") {
        // The deadline bounds regex execution, not worker boot or queueing.
        timer = setTimeout(() => {
          cleanup();
          // A runaway regex can only be stopped by killing its thread.
          discardRegexWorker(worker);
          reject(new Error("deadline"));
        }, deadlineMs);
        return;
      }
      if (msg.type === "result") {
        cleanup();
        if (msg.ok && typeof msg.out === "string") resolve(msg.out);
        else reject(new Error(msg.error || "regex-invalid"));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = () => {
      cleanup();
      reject(new Error("regex-worker-exited"));
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.postMessage({ id, type: "replace", text, pattern, replacement });
  });
}

function runRegexReplace(
  text: string,
  pattern: string,
  replacement: string,
  deadlineMs: number,
): Promise<string> {
  const id = nextRegexJobId;
  nextRegexJobId += 1;
  return bootRegexWorker().then(
    (worker) =>
      runOnRegexWorker(worker, id, text, pattern, replacement, deadlineMs),
    () => {
      // Only boot unavailability falls back to an inline replace; a job that
      // dies with the worker (deadline kill, crash) must fail closed instead
      // of running an untrusted regex unprotected on the main thread.
      try {
        return text.replace(new RegExp(pattern, "gu"), replacement);
      } catch {
        throw new Error("regex-invalid");
      }
    },
  );
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
