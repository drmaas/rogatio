/**
 * Helpers for live Selenium validation of samples/basic against a local
 * validate-server. Body-rule network rewrite still depends on F23 PAC/proxy
 * wiring; helpers support status activation proofs and DNR live checks.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
// validate-server shape inlined below for test-owned lifecycle
import type { WebDriver } from "selenium-webdriver";
import { type CdpSession, openPageCdpSession } from "./cdp-session.js";
import type { Page } from "./page.js";

export const VALIDATE_ORIGIN = "http://127.0.0.1:8080";
export const VALIDATE_HOST_PATTERN = `${VALIDATE_ORIGIN}/*`;
export const SAMPLE_GROUP_ID = "grp-sample";

const EXAMPLE_ORIGIN = "https://example.com";

export type RogatioProject = {
  version: number;
  name: string;
  description?: string;
  groups: Array<{
    id: string;
    name: string;
    origins: string[];
    rules: Array<Record<string, unknown> & { id: string; urlRegex: string }>;
  }>;
};

export async function loadShippedSample(): Promise<RogatioProject> {
  const path = resolve(process.cwd(), "samples/basic/.rogatio.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as RogatioProject;
  return raw;
}

const EXAMPLE_REGEX_HOST = "https://example\\.com";
const VALIDATE_REGEX_HOST = "http://127\\.0\\.0\\.1:8080";

/** Rewrite shipped sample origins/regex from example.com → local validate server. */
export function rewriteSampleToValidateOrigin(
  project: RogatioProject,
): RogatioProject {
  const clone = structuredClone(project) as RogatioProject;
  for (const group of clone.groups) {
    group.origins = group.origins.map((origin) =>
      origin === EXAMPLE_ORIGIN ? VALIDATE_ORIGIN : origin,
    );
    for (const rule of group.rules) {
      rule.urlRegex = rule.urlRegex
        .split(EXAMPLE_REGEX_HOST)
        .join(VALIDATE_REGEX_HOST);
      if (typeof rule.redirect === "object" && rule.redirect !== null) {
        const redirect = rule.redirect as { destination?: string };
        if (typeof redirect.destination === "string") {
          redirect.destination = redirect.destination.replaceAll(
            EXAMPLE_ORIGIN,
            VALIDATE_ORIGIN,
          );
        }
      }
    }
  }
  return clone;
}

export async function startValidateServer(): Promise<{
  close(): Promise<void>;
}> {
  // Prefer in-process server so tests own lifecycle (samples/basic/validate-server.mjs shape).
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", VALIDATE_ORIGIN);
    if (req.method === "POST" && url.pathname === "/submit") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ receivedBody: body }));
      });
      return;
    }
    if (url.pathname === "/api/users") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ seenRequestHeaders: req.headers }));
      return;
    }
    if (url.pathname === "/api/page") {
      res.writeHead(200, { "x-test-header": "should-be-removed" });
      res.end("ok");
      return;
    }
    if (url.pathname === "/data.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ value: "oldValue" }));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    // Bind dual-stack so `localhost` (which may resolve to ::1 first) works
    // alongside the IP-literal origin used by existing journeys.
    server.listen(8080, () => resolveListen());
  });

  return {
    async close() {
      await new Promise<void>((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      });
    },
  };
}

type ExtensionMessage = {
  version: 1;
  command: string;
  [key: string]: unknown;
};

export async function extensionSend<T = unknown>(
  page: Page,
  message: ExtensionMessage,
): Promise<T> {
  return page.evaluate(async (payload) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response as T);
      });
    });
  }, message);
}

export type RuleStatusRow = {
  groupId: string;
  ruleId: string;
  status: string;
};

export type ExtensionStateValue = {
  activeProjectId: string | null;
  projects: Record<
    string,
    {
      data: RogatioProject;
      enabledGroupIds: string[];
    }
  >;
  ruleStatuses?: RuleStatusRow[];
  nativeRuntimeState?: { phase?: string };
  nativeRuntimeError?: string | null;
};

export async function importAndEnableSample(
  page: Page,
  project: RogatioProject,
): Promise<{ projectId: string; statuses: RuleStatusRow[] }> {
  const imported = await extensionSend<{
    ok: boolean;
    value?: { id: string };
    diagnostic?: { code?: string };
  }>(page, {
    version: 1,
    command: "import-project",
    data: project,
  });
  if (!imported?.ok || !imported.value?.id) {
    throw new Error(
      `import-project failed: ${JSON.stringify(imported?.diagnostic ?? imported)}`,
    );
  }
  const projectId = imported.value.id;

  const enabled = await extensionSend<{ ok: boolean }>(page, {
    version: 1,
    command: "set-group-enabled",
    projectId,
    groupId: SAMPLE_GROUP_ID,
    enabled: true,
  });
  if (!enabled?.ok) {
    throw new Error(`set-group-enabled failed: ${JSON.stringify(enabled)}`);
  }

  const state = await extensionSend<{
    ok: boolean;
    value: ExtensionStateValue;
  }>(page, { version: 1, command: "get-state" });
  if (!state?.ok) {
    throw new Error(`get-state failed: ${JSON.stringify(state)}`);
  }
  return {
    projectId,
    statuses: state.value.ruleStatuses ?? [],
  };
}

export async function getExtensionState(
  page: Page,
): Promise<ExtensionStateValue> {
  const state = await extensionSend<{
    ok: boolean;
    value: ExtensionStateValue;
  }>(page, { version: 1, command: "get-state" });
  if (!state?.ok) {
    throw new Error(`get-state failed: ${JSON.stringify(state)}`);
  }
  return state.value;
}

export function statusFor(
  statuses: readonly RuleStatusRow[],
  ruleId: string,
): string | undefined {
  return statuses.find((row) => row.ruleId === ruleId)?.status;
}

export type ConsoleCollector = {
  lines: string[];
  close(): Promise<void>;
  waitForRogatio(substring: string, timeoutMs?: number): Promise<string>;
};

type ConsoleApiCalledParams = {
  args?: Array<{ type?: string; value?: unknown; description?: string }>;
};

function consoleArgsToText(params: ConsoleApiCalledParams): string {
  const parts: string[] = [];
  for (const arg of params.args ?? []) {
    if (typeof arg.value === "string") parts.push(arg.value);
    else if (typeof arg.description === "string") parts.push(arg.description);
    else if (arg.value !== undefined) parts.push(String(arg.value));
  }
  return parts.join(" ");
}

/** CDP console listener on the current page target for `[rogatio]` match lines. */
export async function startRogatioConsoleCollector(
  driver: WebDriver,
): Promise<ConsoleCollector> {
  const cdp: CdpSession = await openPageCdpSession(driver);
  const lines: string[] = [];
  const handler = (params: unknown) => {
    const text = consoleArgsToText(params as ConsoleApiCalledParams);
    if (text.includes("[rogatio]")) lines.push(text);
  };
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable").catch(() => undefined);
  cdp.on("Runtime.consoleAPICalled", handler);
  cdp.on("Log.entryAdded", (params: unknown) => {
    const entry = (params as { entry?: { text?: string } }).entry;
    if (typeof entry?.text === "string" && entry.text.includes("[rogatio]")) {
      lines.push(entry.text);
    }
  });
  return {
    lines,
    async close() {
      cdp.off("Runtime.consoleAPICalled", handler);
      await cdp.close();
    },
    async waitForRogatio(substring, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = lines.find((line) => line.includes(substring));
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(
        `Timed out waiting for [rogatio] console line containing ${JSON.stringify(substring)}; saw ${JSON.stringify(lines)}`,
      );
    },
  };
}

export type ResponseHeaderProbe = {
  headers: Record<string, string>;
  close(): Promise<void>;
};

/** Capture response headers for a URL via CDP Network on the current page. */
export async function startResponseHeaderProbe(
  driver: WebDriver,
  urlSubstring: string,
): Promise<ResponseHeaderProbe> {
  const cdp = await openPageCdpSession(driver);
  const headers: Record<string, string> = {};
  const handler = (params: unknown) => {
    const payload = params as {
      response?: { url?: string; headers?: Record<string, string> };
    };
    const url = payload.response?.url ?? "";
    if (!url.includes(urlSubstring)) return;
    for (const [key, value] of Object.entries(
      payload.response?.headers ?? {},
    )) {
      headers[key.toLowerCase()] = value;
    }
  };
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", handler);
  return {
    headers,
    async close() {
      cdp.off("Network.responseReceived", handler);
      await cdp.close();
    },
  };
}

export async function withNewTab<T>(
  driver: WebDriver,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const { Page } = await import("./page.js");
  const original = await driver.getWindowHandle();
  await driver.switchTo().newWindow("tab");
  const page = new Page(driver);
  try {
    return await fn(page);
  } finally {
    await driver.close();
    await driver.switchTo().window(original);
  }
}

/** Spawn packaged CLI `runtime install` (needs sudo for CA on Linux). */
export function spawnRuntimeInstall(extensionId: string): ChildProcess {
  const cli = resolve(process.cwd(), "packages/cli/dist/node/index.js");
  return spawn(
    process.execPath,
    [cli, "runtime", "install", "--extension-id", extensionId],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Never block the Selenium suite on an interactive sudo password prompt.
        SUDO_ASKPASS: process.env.SUDO_ASKPASS ?? "/bin/false",
      },
    },
  );
}

export async function waitForChild(
  child: ChildProcess,
  timeoutMs = 60_000,
): Promise<{ code: number; output: string }> {
  const chunks: string[] = [];
  child.stdout?.on("data", (c) => chunks.push(String(c)));
  child.stderr?.on("data", (c) => chunks.push(String(c)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `child timed out after ${timeoutMs}ms: ${chunks.join("").slice(0, 2000)}`,
        ),
      );
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: chunks.join("") });
    });
  });
}
