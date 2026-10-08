import { createServer, request as httpRequest } from "node:http";
import { type AIProviderConfig, createAIClient } from "./ai-client.js";
import { readProviderConfig } from "./ai-config.js";
import {
  extensionIdInstallCommand,
  extensionOriginListed,
  RELEASE_EXTENSION_ID,
} from "./extension-id.js";
import { createInstalledTrustController } from "./installed-trust.js";
import { generatePacScript } from "./pac.js";
import {
  diagnoseProjectData,
  formatProjectDiagnostics,
  type ProjectDiagnostic,
} from "./project-diagnose.js";
import type { VerifyResult } from "./trust.js";

/** How long doctor waits for the loopback PAC reply. Matches the host PAC wait. */
export const DOCTOR_PAC_TIMEOUT_MS = 10_000;

/** How long doctor waits for the configured AI provider. */
export const DOCTOR_AI_TIMEOUT_MS = 10_000;

export const DOCTOR_FIX_NODE =
  "Install Node.js 26 or newer, then run: npm install -g @rogatio/cli";
export const DOCTOR_FIX_CLI = "npm install -g @rogatio/cli";
export const DOCTOR_FIX_HOST = "rogatio runtime install";
export const DOCTOR_FIX_CA = "rogatio runtime install";
export const DOCTOR_FIX_PAC = "rogatio runtime install";
export const DOCTOR_FIX_AI_SETUP = "rogatio ai setup";
export const DOCTOR_FIX_AI_TEST = "rogatio ai test";
export const DOCTOR_FIX_DOCTOR = "rogatio doctor";
export const DOCTOR_FIX_EDIT_ACTIVE = "rogatio edit";

export const DOCTOR_HOST_UNREACHABLE_SUMMARY =
  "Could not reach the native host.";
export const DOCTOR_HOST_MISSING_SUMMARY =
  "Native host manifest was not found.";

export const DOCTOR_CHECK_IDS = [
  "node",
  "project",
  "host",
  "ca",
  "pac",
  "ai",
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorStatus = "pass" | "warn" | "fail";

export const DOCTOR_CHECK_TITLES: Record<DoctorCheckId, string> = {
  node: "Node and CLI",
  project: "Project file",
  host: "Native host",
  ca: "Device CA",
  pac: "Runtime PAC",
  ai: "AI Assist",
};

const MINIMUM_NODE_MAJOR = 26;
const EXTENSION_ID_RE = /^[a-p]{32}$/;
/** Local Node and CLI versions may carry a suffix after major.minor.patch. */
const NODE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)/;
/**
 * A registry version is copied into a shell command. The whole string must be
 * major.minor.patch, with nothing before or after it.
 */
const REGISTRY_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_DIAGNOSTICS = 20;

function exactRegistryVersion(value: string): string | null {
  const match = REGISTRY_VERSION_RE.exec(value);
  return match === null ? null : match[0];
}

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly optional: boolean;
  readonly summary: string;
  readonly fix: string | null;
}

export interface DoctorReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly exitCode: 0 | 1;
  readonly checks: readonly DoctorCheck[];
}

export type DoctorProjectRead =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: "missing" | "unreadable" | "parse" };

export type DoctorProjectInput =
  | {
      readonly source: "file";
      readonly path: string;
      readonly read: () => Promise<DoctorProjectRead>;
    }
  | {
      readonly source: "active";
      readonly data: unknown;
      readonly omitted?: "too-large";
    };

export interface AiProbe {
  readonly configured: boolean;
  readonly ok: boolean;
}

export interface DoctorInput {
  readonly nodeVersion: string;
  readonly cliVersion: string;
  readonly checkUpdates: boolean;
  readonly fetchLatestVersion: () => Promise<string | null>;
  readonly project: DoctorProjectInput;
  readonly extensionId: string;
  readonly extensionIdValid: boolean;
  readonly verifyInstall: () => Promise<VerifyResult>;
  readonly probePac: () => Promise<{ readonly ok: boolean }>;
  readonly testAi: () => Promise<AiProbe>;
  readonly pacTimeoutMs: number;
}

export function doctorFixCliUpdate(version: string): string {
  return `npm install -g @rogatio/cli@${version}`;
}

/** POSIX single quotes when a path is not a bare shell word. */
export function quoteDoctorArg(value: string): string {
  if (value.length === 0) return "''";
  // Backslash is not a bare shell word: bash treats it as an escape.
  if (/^[A-Za-z0-9._@/:+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function projectEditFix(path: string): string {
  return `rogatio edit ${quoteDoctorArg(path)}`;
}

export function projectVerifyFix(path: string): string {
  return `rogatio verify ${quoteDoctorArg(path)}`;
}

function check(
  id: DoctorCheckId,
  status: DoctorStatus,
  summary: string,
  fix: string | null,
): DoctorCheck {
  return {
    id,
    status,
    optional: id === "ai",
    summary,
    fix,
  };
}

function report(checks: readonly DoctorCheck[]): DoctorReport {
  const failed = checks.some(
    (item) => item.status === "fail" && item.optional === false,
  );
  return {
    version: 1,
    ok: !failed,
    exitCode: failed ? 1 : 0,
    checks,
  };
}

function compareVersions(left: string, right: string): number | null {
  const a = NODE_VERSION_RE.exec(left);
  const b = REGISTRY_VERSION_RE.exec(right);
  if (a === null || b === null) return null;
  for (let index = 1; index <= 3; index += 1) {
    const av = Number(a[index]);
    const bv = Number(b[index]);
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function nodeMajor(version: string): number | null {
  const match = NODE_VERSION_RE.exec(version);
  if (match === null) return null;
  return Number(match[1]);
}

async function nodeCheck(input: DoctorInput): Promise<DoctorCheck> {
  const major = nodeMajor(input.nodeVersion);
  const cli = input.cliVersion.trim();
  if (major === null || major < MINIMUM_NODE_MAJOR) {
    return check(
      "node",
      "fail",
      `Node ${input.nodeVersion || "unknown"} is older than Node ${MINIMUM_NODE_MAJOR}.`,
      DOCTOR_FIX_NODE,
    );
  }
  if (cli.length === 0) {
    return check("node", "fail", "CLI version is unknown.", DOCTOR_FIX_CLI);
  }
  const base = `Node ${input.nodeVersion}, CLI ${cli}`;
  if (!input.checkUpdates) {
    return check("node", "pass", `${base}.`, null);
  }
  let latest: string | null = null;
  try {
    const fetched = await input.fetchLatestVersion();
    latest = typeof fetched === "string" ? exactRegistryVersion(fetched) : null;
  } catch {
    latest = null;
  }
  if (latest === null) {
    return check(
      "node",
      "warn",
      `${base}. A newer CLI release could not be checked.`,
      null,
    );
  }
  const compared = compareVersions(cli, latest);
  if (compared === null) {
    return check(
      "node",
      "warn",
      `${base}. A newer CLI release could not be checked.`,
      null,
    );
  }
  if (compared < 0) {
    return check(
      "node",
      "warn",
      `${base}. A newer CLI ${latest} is available.`,
      doctorFixCliUpdate(latest),
    );
  }
  return check("node", "pass", `${base}. CLI ${cli} is current.`, null);
}

function diagnosticSummary(diagnostics: readonly ProjectDiagnostic[]): string {
  const shown = diagnostics.slice(0, MAX_DIAGNOSTICS);
  const text = formatProjectDiagnostics(shown);
  if (diagnostics.length <= MAX_DIAGNOSTICS) return text;
  return `${text}\n${diagnostics.length - MAX_DIAGNOSTICS} more`;
}

async function projectCheck(input: DoctorInput): Promise<DoctorCheck> {
  const project = input.project;
  if (project.source === "active") {
    if (project.omitted === "too-large") {
      return check(
        "project",
        "fail",
        "The active project is too large to check through the native host.",
        DOCTOR_FIX_DOCTOR,
      );
    }
    if (project.data === null || project.data === undefined) {
      return check(
        "project",
        "fail",
        "No active project.",
        DOCTOR_FIX_EDIT_ACTIVE,
      );
    }
    return assessedProject(
      project.data,
      "Active project is invalid.",
      DOCTOR_FIX_EDIT_ACTIVE,
      "Active project is valid.",
    );
  }

  let read: DoctorProjectRead;
  try {
    read = await project.read();
  } catch {
    return check(
      "project",
      "fail",
      `Project file could not be read: ${project.path}`,
      projectEditFix(project.path),
    );
  }
  if (!read.ok) {
    if (read.reason === "missing") {
      return check(
        "project",
        "fail",
        `Project file not found: ${project.path}`,
        projectEditFix(project.path),
      );
    }
    if (read.reason === "parse") {
      return check(
        "project",
        "fail",
        `Project file is not JSON: ${project.path}`,
        projectEditFix(project.path),
      );
    }
    return check(
      "project",
      "fail",
      `Project file could not be read: ${project.path}`,
      projectEditFix(project.path),
    );
  }
  return assessedProject(
    read.data,
    `Project file is invalid: ${project.path}`,
    projectVerifyFix(project.path),
    `Project file is valid: ${project.path}`,
  );
}

function assessedProject(
  data: unknown,
  invalidSummary: string,
  invalidFix: string,
  validSummary: string,
): DoctorCheck {
  let diagnosis: ReturnType<typeof diagnoseProjectData>;
  try {
    diagnosis = diagnoseProjectData(data);
  } catch {
    return check(
      "project",
      "fail",
      `${invalidSummary}\nProject file could not be checked.`,
      invalidFix,
    );
  }
  if (diagnosis.diagnostics.length === 0) {
    return check("project", "pass", validSummary, null);
  }
  return check(
    "project",
    "fail",
    `${invalidSummary}\n${diagnosticSummary(diagnosis.diagnostics)}`,
    invalidFix,
  );
}

function hostCheck(
  verified: VerifyResult | undefined,
  verifyFailed: boolean,
  extensionId: string,
  extensionIdValid: boolean,
): DoctorCheck {
  if (verifyFailed || verified === undefined) {
    return check(
      "host",
      "fail",
      "Native host could not be checked.",
      DOCTOR_FIX_HOST,
    );
  }
  if (!extensionIdValid) {
    return check(
      "host",
      "fail",
      "Extension ID is not a Chrome extension ID.",
      DOCTOR_FIX_HOST,
    );
  }
  if (!verified.manifestExists) {
    return check("host", "fail", DOCTOR_HOST_MISSING_SUMMARY, DOCTOR_FIX_HOST);
  }
  if (!verified.manifestValid) {
    return check(
      "host",
      "fail",
      "Native host manifest is invalid.",
      DOCTOR_FIX_HOST,
    );
  }
  if (!verified.binaryExists) {
    return check(
      "host",
      "fail",
      "runtime-host wrapper was not found.",
      DOCTOR_FIX_HOST,
    );
  }
  if (!verified.binaryExecutable) {
    return check(
      "host",
      "fail",
      "runtime-host wrapper is not executable.",
      DOCTOR_FIX_HOST,
    );
  }
  if (verified.allowedOrigins.length === 0) {
    return check(
      "host",
      "fail",
      "Native host manifest has no allowed_origins.",
      DOCTOR_FIX_HOST,
    );
  }
  if (!extensionOriginListed(extensionId, verified.allowedOrigins)) {
    return check(
      "host",
      "fail",
      `Extension ID ${extensionId} is not in the host manifest allowed_origins.`,
      extensionIdInstallCommand(extensionId),
    );
  }
  return check(
    "host",
    "pass",
    `allowed_origins includes chrome-extension://${extensionId}/`,
    null,
  );
}

function caCheck(
  verified: VerifyResult | undefined,
  verifyFailed: boolean,
): DoctorCheck {
  if (verifyFailed || verified === undefined) {
    return check(
      "ca",
      "fail",
      "Device CA could not be checked.",
      DOCTOR_FIX_CA,
    );
  }
  if (!verified.caTrusted) {
    return check(
      "ca",
      "fail",
      "Device CA is not present or not trusted.",
      DOCTOR_FIX_CA,
    );
  }
  return check("ca", "pass", "Device CA is present and trusted.", null);
}

async function pacCheck(input: DoctorInput): Promise<DoctorCheck> {
  let ok = false;
  try {
    ok = (await input.probePac()).ok === true;
  } catch {
    ok = false;
  }
  if (!ok) {
    return check(
      "pac",
      "fail",
      `Runtime did not answer a PAC request within ${input.pacTimeoutMs}ms.`,
      DOCTOR_FIX_PAC,
    );
  }
  return check("pac", "pass", "Runtime answered a PAC request.", null);
}

async function aiCheck(input: DoctorInput): Promise<DoctorCheck> {
  let probe: AiProbe;
  try {
    probe = await input.testAi();
  } catch {
    probe = { configured: true, ok: false };
  }
  if (!probe.configured) {
    return check(
      "ai",
      "warn",
      "Optional. No AI provider is configured.",
      DOCTOR_FIX_AI_SETUP,
    );
  }
  if (!probe.ok) {
    return check(
      "ai",
      "warn",
      "Optional. The configured AI provider did not respond.",
      DOCTOR_FIX_AI_TEST,
    );
  }
  return check("ai", "pass", "AI provider responded.", null);
}

/**
 * Run the six doctor checks in order. Ports are injected so a test never
 * touches the network, the OS trust store, or a project file unless it
 * supplies a port that does.
 */
export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  let verified: VerifyResult | undefined;
  let verifyFailed = false;
  try {
    verified = await input.verifyInstall();
  } catch {
    verifyFailed = true;
  }
  const checks = [
    await nodeCheck(input),
    await projectCheck(input),
    hostCheck(
      verified,
      verifyFailed,
      input.extensionId,
      input.extensionIdValid,
    ),
    caCheck(verified, verifyFailed),
    await pacCheck(input),
    await aiCheck(input),
  ];
  return report(checks);
}

/** Last-resort report when the host cannot finish a doctor run. */
export function doctorInterruptedReport(): DoctorReport {
  return report(
    DOCTOR_CHECK_IDS.map((id) =>
      check(
        id,
        id === "ai" ? "warn" : "fail",
        "Doctor could not finish.",
        DOCTOR_FIX_DOCTOR,
      ),
    ),
  );
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const item of report.checks) {
    lines.push(
      `${item.status}  ${DOCTOR_CHECK_TITLES[item.id]}  ${item.summary}`,
    );
    if (item.fix !== null) lines.push(`  Fix: ${item.fix}`);
  }
  return lines.join("\n");
}

/** Stable key order for `rogatio doctor --json`. */
export function serializeDoctorReport(report: DoctorReport): string {
  return `${JSON.stringify(doctorReportValue(report), null, 2)}\n`;
}

export function doctorReportValue(report: DoctorReport): {
  version: 1;
  ok: boolean;
  exitCode: 0 | 1;
  checks: {
    id: DoctorCheckId;
    status: DoctorStatus;
    optional: boolean;
    summary: string;
    fix: string | null;
  }[];
} {
  return {
    version: 1,
    ok: report.ok,
    exitCode: report.exitCode,
    checks: report.checks.map((item) => ({
      id: item.id,
      status: item.status,
      optional: item.optional,
      summary: item.summary,
      fix: item.fix,
    })),
  };
}

export interface InstalledDoctorOptions {
  readonly nodeVersion?: string;
  readonly cliVersion: string;
  readonly checkUpdates: boolean;
  readonly fetchLatestVersion?: () => Promise<string | null>;
  readonly project: DoctorProjectInput;
  readonly extensionId?: string;
  readonly verifyInstall?: () => Promise<VerifyResult>;
  readonly probePac?: () => Promise<{ readonly ok: boolean }>;
  readonly testAi?: () => Promise<AiProbe>;
  readonly pacTimeoutMs?: number;
}

/** Wire the real install, PAC probe, and AI probe around `runDoctor`. */
export async function runInstalledDoctor(
  options: InstalledDoctorOptions,
): Promise<DoctorReport> {
  const extensionId = options.extensionId ?? RELEASE_EXTENSION_ID;
  const extensionIdValid = EXTENSION_ID_RE.test(extensionId);
  const timeoutMs = options.pacTimeoutMs ?? DOCTOR_PAC_TIMEOUT_MS;
  return runDoctor({
    nodeVersion: options.nodeVersion ?? process.versions.node,
    cliVersion: options.cliVersion,
    checkUpdates: options.checkUpdates,
    fetchLatestVersion:
      options.checkUpdates === true
        ? (options.fetchLatestVersion ?? fetchLatestCliVersion)
        : async () => null,
    project: options.project,
    extensionId: extensionIdValid ? extensionId : RELEASE_EXTENSION_ID,
    extensionIdValid,
    verifyInstall:
      options.verifyInstall ??
      (() => createInstalledTrustController().verify()),
    probePac: options.probePac ?? (() => probePacAnswer(timeoutMs)),
    testAi: options.testAi ?? (() => probeAiProvider()),
    pacTimeoutMs: timeoutMs,
  });
}

function own(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return (record as Record<string, unknown>)[key];
}

/**
 * Build a doctor run from a native-host envelope. The envelope may carry the
 * active project. It may not name a filesystem path: the host does not read
 * arbitrary paths from extension messages.
 */
export async function doctorFromHostMetadata(
  metadata: Readonly<Record<string, unknown>>,
  options: {
    readonly cliVersion: string;
    readonly nodeVersion?: string;
    readonly fetchLatestVersion?: () => Promise<string | null>;
    readonly verifyInstall?: () => Promise<VerifyResult>;
    readonly probePac?: () => Promise<{ readonly ok: boolean }>;
    readonly testAi?: () => Promise<AiProbe>;
  },
): Promise<DoctorReport> {
  const rawId = own(metadata, "extensionId");
  const extensionId =
    typeof rawId === "string" && EXTENSION_ID_RE.test(rawId)
      ? rawId
      : typeof rawId === "string"
        ? rawId
        : RELEASE_EXTENSION_ID;
  const checkUpdates = own(metadata, "checkUpdates") === true;
  const omitted = own(metadata, "projectOmitted") === "too-large";
  const hasProject = Object.hasOwn(metadata, "project");
  const project: DoctorProjectInput = omitted
    ? { source: "active", data: null, omitted: "too-large" }
    : {
        source: "active",
        data: hasProject ? own(metadata, "project") : null,
      };
  return runInstalledDoctor({
    cliVersion: options.cliVersion,
    ...(options.nodeVersion !== undefined
      ? { nodeVersion: options.nodeVersion }
      : {}),
    checkUpdates,
    ...(options.fetchLatestVersion !== undefined
      ? { fetchLatestVersion: options.fetchLatestVersion }
      : {}),
    project,
    extensionId,
    ...(options.verifyInstall !== undefined
      ? { verifyInstall: options.verifyInstall }
      : {}),
    ...(options.probePac !== undefined ? { probePac: options.probePac } : {}),
    ...(options.testAi !== undefined ? { testAi: options.testAi } : {}),
  });
}

const NPM_LATEST = "https://registry.npmjs.org/@rogatio/cli/latest";

/** Public registry lookup. Called only when the user passed `--check-updates`. */
export async function fetchLatestCliVersion(
  timeoutMs = 5_000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NPM_LATEST, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const version = own(body, "version");
    return typeof version === "string" ? exactRegistryVersion(version) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start a loopback listener, request the PAC script, and stop the listener.
 * This does not change Chrome's proxy settings.
 */
export async function probePacAnswer(
  timeoutMs: number,
): Promise<{ readonly ok: boolean }> {
  let script: string;
  try {
    script = generatePacScript([{ hostname: "doctor.invalid" }], {
      host: "127.0.0.1",
      port: 9,
    });
  } catch {
    return { ok: false };
  }
  if (!script.includes("FindProxyForURL")) return { ok: false };

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/pac") {
      response.writeHead(200, {
        "content-type": "application/x-ns-proxy-autoconfig",
        "cache-control": "no-store",
      });
      response.end(script);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") return { ok: false };
    const body = await new Promise<string | null>((resolve) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/pac",
          method: "GET",
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("error", () => resolve(null));
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (response.statusCode !== 200) {
              resolve(null);
              return;
            }
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
      req.end();
    });
    if (body === null) return { ok: false };
    return {
      ok: body.includes("FindProxyForURL") && body.includes("doctor.invalid"),
    };
  } catch {
    return { ok: false };
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

/**
 * The same Hello completion `rogatio ai test` sends. Errors are dropped so a
 * provider message cannot enter the doctor report.
 */
export async function probeAiProvider(options?: {
  readonly readConfig?: () => Promise<AIProviderConfig | null>;
  readonly complete?: (config: AIProviderConfig) => Promise<void>;
  readonly timeoutMs?: number;
}): Promise<AiProbe> {
  const readConfig = options?.readConfig ?? readProviderConfig;
  let config: AIProviderConfig | null;
  try {
    config = await readConfig();
  } catch {
    return { configured: false, ok: false };
  }
  if (config === null) return { configured: false, ok: false };

  const timeoutMs = options?.timeoutMs ?? DOCTOR_AI_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (options?.complete) {
      await options.complete(config);
    } else {
      const client = createAIClient(config);
      await client.complete({
        messages: [{ role: "user", content: "Hello" }],
        model: config.model,
        temperature: 0,
        signal: controller.signal,
      });
    }
    return { configured: true, ok: true };
  } catch {
    return { configured: true, ok: false };
  } finally {
    clearTimeout(timer);
  }
}
