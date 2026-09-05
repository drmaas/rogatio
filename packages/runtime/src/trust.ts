import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { createCertificate, generateCaKeyPair } from "./x509.js";

/** Immutable  trust-limit profile (spec REQ-021). */
export const TRUST_LIMITS = {
  manifestMaxBytes: 4096,
  maxAllowedOrigins: 64,
  caKeyBits: 2048,
  caValidityDays: 3650,
} as const;

export type TrustPlatform = "darwin" | "linux" | "win32" | string;

export type TrustState =
  | "installed"
  | "uninstalled"
  | "trusted"
  | "untrusted"
  | "unsupported"
  | "noop";

export interface TrustResult {
  readonly ok: boolean;
  readonly state: TrustState;
  readonly reasons?: readonly string[];
}

export interface NativeMessagingManifest {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly type: "stdio";
  readonly allowed_origins: readonly string[];
}

export interface TrustCapabilities {
  readonly manifest: boolean;
  readonly caTrust: boolean;
  readonly reasons: readonly string[];
}

export interface TrustStatus {
  readonly installed: boolean;
  readonly trusted: boolean;
  readonly platform: TrustPlatform;
  readonly capabilityReasons: readonly string[];
}

export type ErrorCode =
  | "trust.unsupported"
  | "trust.invalid-manifest"
  | "trust.invalid-host-path"
  | "trust.invalid-origin"
  | "trust.write-failed"
  | "trust.capability-error"
  | "trust.internal";

export class TrustError extends Error {
  readonly code: ErrorCode;
  readonly reasons: readonly string[];
  constructor(
    code: ErrorCode,
    message: string,
    reasons: readonly string[] = [],
  ) {
    super(message);
    this.name = "TrustError";
    this.code = code;
    this.reasons = reasons;
  }
}

const ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}\/?$/;

const DEFAULT_CAPABILITIES: TrustCapabilities = {
  manifest: false,
  caTrust: false,
  reasons: ["no-capability-provider"],
};

/**
 * Deterministic native-messaging host manifest. `path` must be absolute and confined
 * to `installRoot`; `allowed_origins` must be valid `chrome-extension://` origins.
 * Output is sorted/de-duplicated and free of secrets (spec REQ-005..008).
 */
export function generateNativeMessagingManifest(
  hostPath: string,
  name: string,
  allowedOrigins: readonly string[],
  installRoot: string,
): NativeMessagingManifest {
  if (typeof hostPath !== "string" || !isAbsolute(hostPath)) {
    throw new TrustError(
      "trust.invalid-host-path",
      "host path must be an absolute path",
    );
  }
  const rel = relative(installRoot, hostPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new TrustError(
      "trust.invalid-host-path",
      "host path escapes the configured install root",
    );
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new TrustError("trust.invalid-manifest", "host name is required");
  }
  if (!Array.isArray(allowedOrigins)) {
    throw new TrustError(
      "trust.invalid-manifest",
      "allowed_origins must be an array",
    );
  }
  if (allowedOrigins.length > TRUST_LIMITS.maxAllowedOrigins) {
    throw new TrustError(
      "trust.invalid-manifest",
      "allowed_origins exceeds the configured maximum",
    );
  }
  const seen = new Set<string>();
  for (const origin of allowedOrigins) {
    if (typeof origin !== "string" || !ORIGIN_RE.test(origin)) {
      throw new TrustError(
        "trust.invalid-origin",
        `invalid allowed origin: ${String(origin)}`,
      );
    }
    seen.add(origin.endsWith("/") ? origin : `${origin}/`);
  }
  return {
    name,
    description: "Rogatio request-body native runtime host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [...seen].sort(),
  };
}

/**
 * Pure, injectable capability detection (spec REQ-016/017). Default is a negative
 * result so no device-local write happens in an environment without an explicit
 * capability provider; capability-based, never OS-name-based.
 */
export function detectTrustCapabilities(
  options: { platform?: string; manifestDir?: string } = {},
): TrustCapabilities {
  void options;
  return { ...DEFAULT_CAPABILITIES };
}

export interface RequestBodyTrustControllerOptions {
  readonly platform?: string;
  readonly hostPath?: string;
  readonly hostName?: string;
  readonly allowedOrigins?: readonly string[];
  readonly installRoot?: string;
  readonly manifestDir?: string;
  readonly caKeyFileName?: string;
  readonly caPubFileName?: string;
  readonly caCertFileName?: string;
  readonly detectCapabilities?: () =>
    | TrustCapabilities
    | Promise<TrustCapabilities>;
  readonly caTrustInstaller?: (certPem: string) => Promise<void> | void;
  readonly caTrustRemover?: () => Promise<void> | void;
}

/** Platform default install root for the trust material (capability-configurable). */
export function defaultTrustInstallRoot(platform: string): string {
  if (platform === "darwin") return "/Applications/Rogatio";
  if (platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? "", "Rogatio");
  }
  return join(process.env.HOME ?? "", ".local", "share", "rogatio");
}

function isWellFormedManifest(
  value: unknown,
): value is NativeMessagingManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.name === "string" &&
    typeof m.path === "string" &&
    m.type === "stdio" &&
    Array.isArray(m.allowed_origins) &&
    m.allowed_origins.every((o) => typeof o === "string")
  );
}

async function writeFileAtomic(path: string, data: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

async function existsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function codeOf(error: unknown, fallback: ErrorCode): ErrorCode {
  return error instanceof TrustError ? error.code : fallback;
}

function unsupportedResult(caps: TrustCapabilities): TrustResult {
  return { ok: false, state: "unsupported", reasons: caps.reasons };
}

/**
 * Device-local request-body trust controller (spec REQ-009..015, REQ-018..020).
 * Owns manifest install/uninstall and confined device-local CA trust; every mutating
 * operation is capability-gated and idempotent; `status` never leaks paths, CA material,
 * or third-party tooling text.
 */
export function createRequestBodyTrustController(
  options: RequestBodyTrustControllerOptions = {},
) {
  const platform = options.platform ?? process.platform;
  const hostName = options.hostName ?? "com.rogatio.runtime";
  const installRoot = options.installRoot ?? defaultTrustInstallRoot(platform);
  const hostPath = options.hostPath ?? join(installRoot, "runtime-host");
  const manifestDir = options.manifestDir ?? installRoot;
  const caKeyFile = join(
    installRoot,
    options.caKeyFileName ?? ".rogatio-ca.key",
  );
  const caPubFile = join(
    installRoot,
    options.caPubFileName ?? ".rogatio-ca.pub",
  );
  const detect = options.detectCapabilities ?? detectTrustCapabilities;
  const caTrustInstaller = options.caTrustInstaller;
  const caTrustRemover = options.caTrustRemover;

  const caCertFile = join(
    installRoot,
    options.caCertFileName ?? ".rogatio-ca.crt",
  );
  const manifestPath = (): string => join(manifestDir, `${hostName}.json`);
  let installerCalled = false;

  async function install(extensionId: string): Promise<TrustResult> {
    if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
      return {
        ok: false,
        state: "unsupported",
        reasons: ["invalid-extension-id"],
      };
    }
    const allowedOrigins = [`chrome-extension://${extensionId}/`];
    let manifest: NativeMessagingManifest;
    try {
      manifest = generateNativeMessagingManifest(
        hostPath,
        hostName,
        allowedOrigins,
        installRoot,
      );
    } catch (error) {
      return {
        ok: false,
        state: "unsupported",
        reasons: [codeOf(error, "trust.invalid-manifest")],
      };
    }
    const data = JSON.stringify(manifest, null, 2);
    if (data.length > TRUST_LIMITS.manifestMaxBytes) {
      return {
        ok: false,
        state: "unsupported",
        reasons: ["manifest-too-large"],
      };
    }
    const caps = await detect();
    if (!caps.manifest) return unsupportedResult(caps);
    try {
      await writeFileAtomic(manifestPath(), data);
    } catch (error) {
      return {
        ok: false,
        state: "unsupported",
        reasons: [codeOf(error, "trust.write-failed")],
      };
    }
    const caTrustCaps = await detect();
    if (!caTrustCaps.caTrust) {
      try {
        await rm(manifestPath(), { force: true });
      } catch {
        // best-effort rollback; original capability reason still wins
      }
      return unsupportedResult(caTrustCaps);
    }
    const trustResult = await trust();
    if (!trustResult.ok) {
      try {
        await rm(caKeyFile, { force: true });
        await rm(caPubFile, { force: true });
        await rm(caCertFile, { force: true });
      } catch {
        // best-effort rollback; original error code still wins
      }
      try {
        await rm(manifestPath(), { force: true });
      } catch {
        // best-effort rollback
      }
      installerCalled = false;
      return trustResult;
    }
    return { ok: true, state: "installed" };
  }

  async function runCaTrust(): Promise<void> {
    const caps = await detect();
    if (!caps.caTrust) {
      throw new TrustError(
        "trust.unsupported",
        "caTrust capability absent",
        caps.reasons,
      );
    }
    if (!(await existsFile(caKeyFile)) || !(await existsFile(caCertFile))) {
      const { privateKey } = generateCaKeyPair(TRUST_LIMITS.caKeyBits);

      // Generate self-signed X.509 CA certificate
      const certResult = createCertificate(
        "CN=Rogatio Request-Body CA",
        privateKey,
        TRUST_LIMITS.caValidityDays,
      );
      const certPem = certResult.certPem;
      const certKeyPem = certResult.keyPem;

      await writeFileAtomic(caKeyFile, certKeyPem);
      await writeFileAtomic(caPubFile, certPem); // Store cert as public key for compatibility
      await writeFileAtomic(caCertFile, certPem);
    }
    if (caTrustInstaller && !installerCalled) {
      await caTrustInstaller(await readFile(caCertFile, "utf8"));
      installerCalled = true;
    }
  }

  async function removeCa(): Promise<void> {
    const caWasPresent = await existsFile(caKeyFile);
    await rm(caKeyFile, { force: true });
    await rm(caPubFile, { force: true });
    await rm(caCertFile, { force: true });
    if (caWasPresent && caTrustRemover) {
      await caTrustRemover();
    }
  }

  async function uninstall(): Promise<TrustResult> {
    try {
      await rm(manifestPath(), { force: true });
      await removeCa();
      installerCalled = false;
    } catch (error) {
      return {
        ok: false,
        state: "unsupported",
        reasons: [error instanceof Error ? error.message : String(error)],
      };
    }
    return { ok: true, state: "uninstalled" };
  }

  async function trust(): Promise<TrustResult> {
    try {
      await runCaTrust();
    } catch (error) {
      return {
        ok: false,
        state: "unsupported",
        reasons: [codeOf(error, "trust.internal")],
      };
    }
    return { ok: true, state: "trusted" };
  }

  async function status(): Promise<TrustStatus> {
    let installed = false;
    try {
      const raw = await readFile(manifestPath(), "utf8");
      installed = isWellFormedManifest(JSON.parse(raw) as unknown);
    } catch {
      installed = false;
    }
    // Check actual trust: both CA key and certificate must exist
    const trusted =
      (await existsFile(caKeyFile)) && (await existsFile(caCertFile));
    const caps = await detect();
    return {
      installed,
      trusted,
      platform,
      capabilityReasons: caps.reasons,
    };
  }

  return { install, uninstall, status };
}
