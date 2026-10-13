import { Worker } from "node:worker_threads";

// The worker script announces readiness, acknowledges each job before running
// it, then posts the result. The ack lets the caller start the execution
// deadline only when the regex actually begins, so slow worker boot (for
// example on cold CI runners) can never consume the regex deadline.
// `replace` is a global unicode substitution. `test` and `exec` are flagless,
// matching URL source matching and capture expansion.
const REGEX_WORKER_SOURCE = `
const workerThreads =
  typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("worker_threads")
    : require("worker_threads");
const { parentPort } = workerThreads;
parentPort.postMessage({ type: "ready" });
parentPort.on("message", (msg) => {
  if (msg.type !== "replace" && msg.type !== "test" && msg.type !== "exec") return;
  parentPort.postMessage({ id: msg.id, type: "ack" });
  try {
    if (msg.type === "replace") {
      const out = msg.text.replace(new RegExp(msg.pattern, "gu"), msg.replacement);
      parentPort.postMessage({ id: msg.id, type: "result", ok: true, out });
      return;
    }
    const regex = new RegExp(msg.pattern);
    if (msg.type === "test") {
      parentPort.postMessage({
        id: msg.id,
        type: "result",
        ok: true,
        matched: regex.test(msg.text),
      });
      return;
    }
    const match = regex.exec(msg.text);
    const captures =
      match === null
        ? null
        : match.slice(1).map((part) => (part === undefined ? null : part));
    parentPort.postMessage({
      id: msg.id,
      type: "result",
      ok: true,
      captures,
    });
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

type RegexJobType = "replace" | "test" | "exec";

interface RegexJobResult {
  readonly out?: string;
  readonly matched?: boolean;
  readonly captures?: readonly (string | null)[] | null;
}

function runOnRegexWorker(
  worker: Worker,
  id: number,
  type: RegexJobType,
  text: string,
  pattern: string,
  replacement: string | undefined,
  deadlineMs: number,
): Promise<RegexJobResult> {
  return new Promise<RegexJobResult>((resolve, reject) => {
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
      matched?: boolean;
      captures?: readonly (string | null)[] | null;
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
        if (!msg.ok) {
          reject(new Error(msg.error || "regex-invalid"));
          return;
        }
        resolve({
          ...(typeof msg.out === "string" ? { out: msg.out } : {}),
          ...(typeof msg.matched === "boolean" ? { matched: msg.matched } : {}),
          ...(msg.captures !== undefined ? { captures: msg.captures } : {}),
        });
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
    worker.postMessage({
      id,
      type,
      text,
      pattern,
      ...(replacement !== undefined ? { replacement } : {}),
    });
  });
}

function nextJobId(): number {
  const id = nextRegexJobId;
  nextRegexJobId += 1;
  return id;
}

export function runRegexReplace(
  text: string,
  pattern: string,
  replacement: string,
  deadlineMs: number,
): Promise<string> {
  const id = nextJobId();
  return bootRegexWorker().then(
    (worker) =>
      runOnRegexWorker(
        worker,
        id,
        "replace",
        text,
        pattern,
        replacement,
        deadlineMs,
      ).then((result) => {
        if (typeof result.out !== "string") throw new Error("regex-invalid");
        return result.out;
      }),
    () => {
      // Only boot unavailability falls back to an inline replace; a job that
      // dies with the worker (deadline kill, crash) must fail closed instead
      // of running the regex on the caller thread.
      try {
        return text.replace(new RegExp(pattern, "gu"), replacement);
      } catch {
        throw new Error("regex-invalid");
      }
    },
  );
}

// URL source test/exec share the replace worker and its execution deadline.
// A deadline or a worker failure is a non-match so the caller leaves the
// request unchanged. Only worker-boot failure falls back to an inline call.
function inlineRegexTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

function inlineRegexExec(
  pattern: string,
  text: string,
): readonly (string | undefined)[] | null {
  try {
    const match = new RegExp(pattern).exec(text);
    return match === null ? null : match.slice(1);
  } catch {
    return null;
  }
}

function capturesFromWorker(
  captures: readonly (string | null)[] | null | undefined,
): readonly (string | undefined)[] | null {
  if (captures === null || captures === undefined) return null;
  return captures.map((part) => (part === null ? undefined : part));
}

export function runRegexTest(
  text: string,
  pattern: string,
  deadlineMs: number,
): Promise<boolean> {
  const id = nextJobId();
  return bootRegexWorker().then(
    (worker) =>
      runOnRegexWorker(
        worker,
        id,
        "test",
        text,
        pattern,
        undefined,
        deadlineMs,
      ).then(
        (result) => result.matched === true,
        () => false,
      ),
    () => inlineRegexTest(pattern, text),
  );
}

export function runRegexExec(
  text: string,
  pattern: string,
  deadlineMs: number,
): Promise<readonly (string | undefined)[] | null> {
  const id = nextJobId();
  return bootRegexWorker().then(
    (worker) =>
      runOnRegexWorker(
        worker,
        id,
        "exec",
        text,
        pattern,
        undefined,
        deadlineMs,
      ).then(
        (result) => capturesFromWorker(result.captures),
        () => null,
      ),
    () => inlineRegexExec(pattern, text),
  );
}
