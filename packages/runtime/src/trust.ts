import { createPrivateKey, sign, verify, X509Certificate } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { isInstallableCaCertificate } from "./trust-platform/ca-pem.js";
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

export interface VerifyResult {
  readonly ok: boolean;
  readonly manifestExists: boolean;
  readonly manifestValid: boolean;
  readonly binaryExists: boolean;
  readonly binaryExecutable: boolean;
  readonly caTrusted: boolean;
  readonly allowedOriginsCount: number;
  /** Origins copied from the host manifest, or empty when it cannot be read. */
  readonly allowedOrigins: readonly string[];
  readonly reasons: readonly string[];
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
  /**
   * Removes one previously trusted Rogatio CA. The fingerprint and PEM are
   * the same validated certificate. Argv-only.
   */
  readonly caTrustAnchorRemover?: (
    fingerprintSha1: string,
    certPem: string,
  ) => Promise<void> | void;
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

/**
 * Windows does not define `O_NOFOLLOW`. Treat a missing constant as "no
 * extra flag" so `open` still succeeds; callers still reject symlinks with
 * `lstat` or `O_EXCL`.
 */
function noFollowFlag(): number {
  const flag = fsConstants.O_NOFOLLOW;
  return typeof flag === "number" ? flag : 0;
}

async function writeFileAtomic(
  path: string,
  data: string,
  mode?: number,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    noFollowFlag();
  let created = false;
  let handle: FileHandle | undefined;
  try {
    // Exclusive create does not follow a symlink already at the temp path.
    handle = await open(tmp, flags, 0o600);
    created = true;
    await handle.writeFile(data, "utf8");
    await handle.chmod(mode ?? 0o644);
    await handle.close();
    handle = undefined;
    await rename(tmp, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (created) {
      try {
        await rm(tmp, { force: true });
      } catch {
        // best-effort cleanup of the temp file we created
      }
    }
    throw error;
  }
}

const CA_POSSESSION_PAYLOAD = Buffer.from("rogatio-ca-possession");

/**
 * `createCertificate("CN=Rogatio Request-Body CA", ...)` stores that string
 * as the common name, so Node reports the subject below.
 */
const ROGATIO_REQUEST_BODY_CA_SUBJECT = "CN=CN=Rogatio Request-Body CA";

/**
 * A stored pair is reusable only when the certificate is a CA and the key
 * file can sign as that certificate's private key.
 */
function caCertificateMatchesPrivateKey(
  certPem: string,
  keyPem: string,
): boolean {
  try {
    if (!isInstallableCaCertificate(certPem)) return false;
    const certificate = new X509Certificate(certPem);
    if (!certificate.ca) return false;
    const privateKey = createPrivateKey(keyPem);
    if (privateKey.type !== "private") return false;
    const signature = sign("sha256", CA_POSSESSION_PAYLOAD, privateKey);
    return verify(
      "sha256",
      CA_POSSESSION_PAYLOAD,
      certificate.publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * Read a regular file without following a symlink. Returns undefined when
 * the path is missing, not a regular file, or cannot be opened.
 */
async function readNoFollowRegularFile(
  path: string,
): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    const info = await lstat(path);
    if (!info.isFile()) return undefined;
    handle = await open(path, fsConstants.O_RDONLY | noFollowFlag());
    const opened = await handle.stat();
    if (!opened.isFile()) return undefined;
    return await handle.readFile({ encoding: "utf8" });
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * The previous anchor is removable only when the cert path is a regular file
 * and the bytes are the Rogatio Request-Body CA. Symlinks are not followed.
 */
async function readPreviousRogatioCa(
  caCertFile: string,
): Promise<{ fingerprint: string; pem: string } | undefined> {
  const pem = await readNoFollowRegularFile(caCertFile);
  if (pem === undefined) return undefined;
  try {
    const certificate = new X509Certificate(pem);
    if (!certificate.ca) return undefined;
    if (certificate.subject !== ROGATIO_REQUEST_BODY_CA_SUBJECT) {
      return undefined;
    }
    const fingerprint = sha1Fingerprint(pem);
    if (!fingerprint) return undefined;
    return { fingerprint, pem };
  } catch {
    return undefined;
  }
}

/**
 * A regular file that could not be read must not be overwritten. A missing
 * path or a non-regular file, such as a symlink, has no bytes to keep.
 */
async function assertReadableIfRegular(
  path: string,
  snapshot: string | undefined,
): Promise<void> {
  if (snapshot !== undefined) return;
  try {
    const info = await lstat(path);
    if (!info.isFile()) return;
  } catch {
    return;
  }
  throw new TrustError("trust.write-failed", "CA file could not be read", [
    "trust.write-failed",
  ]);
}

async function discardPreviousCa(caPreviousCertFile: string): Promise<void> {
  try {
    await rm(caPreviousCertFile, { force: true });
  } catch {
    // The next regeneration replaces a leftover copy.
  }
}

function sha1Fingerprint(certPem: string): string | undefined {
  try {
    const hex = new X509Certificate(certPem).fingerprint
      .replaceAll(":", "")
      .toLowerCase();
    return /^[0-9a-f]{40}$/.test(hex) ? hex : undefined;
  } catch {
    return undefined;
  }
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
  const caTrustAnchorRemover = options.caTrustAnchorRemover;
  let anchorRemovalWarning: string | undefined;
  /** Fingerprint accepted in `.rogatio-ca.previous.crt` during this attempt. */
  let rememberedFingerprint: string | undefined;
  /** True when this attempt is replacing an existing Rogatio CA. */
  let replacingPrevious = false;
  /** True when the on-disk pair was already reusable, so failure must not delete it. */
  let reusedExisting = false;
  /** Key and public certificate bytes from before a replacement write. */
  let previousKeyPem: string | undefined;
  let previousPubPem: string | undefined;
  /** True only after that file's writeFileAtomic resolves during this attempt. */
  let replacedKey = false;
  let replacedPub = false;
  let replacedCert = false;

  const caCertFile = join(
    installRoot,
    options.caCertFileName ?? ".rogatio-ca.crt",
  );
  const caPreviousCertFile = join(
    dirname(caCertFile),
    ".rogatio-ca.previous.crt",
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
        await rollbackReplacedCa();
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
    return trustResult.reasons
      ? { ok: true, state: "installed", reasons: trustResult.reasons }
      : { ok: true, state: "installed" };
  }

  async function reusableCaMaterial(): Promise<boolean> {
    try {
      const [keyStat, certStat] = await Promise.all([
        lstat(caKeyFile),
        lstat(caCertFile),
      ]);
      if (!keyStat.isFile() || !certStat.isFile()) return false;
      // Windows has no POSIX mode bits or uid. Requiring 0600 and the
      // current uid would regenerate, and re-prompt to trust, a valid CA
      // on every install. Symlinks are already rejected above.
      if (process.platform !== "win32") {
        if ((keyStat.mode & 0o777) !== 0o600) return false;
        const uid = process.getuid?.();
        if (uid !== undefined && keyStat.uid !== uid) return false;
      }
      const [certPem, keyPem] = await Promise.all([
        readFile(caCertFile, "utf8"),
        readFile(caKeyFile, "utf8"),
      ]);
      return caCertificateMatchesPrivateKey(certPem, keyPem);
    } catch {
      return false;
    }
  }

  async function retireAnchor(anchor: {
    fingerprint: string;
    pem: string;
  }): Promise<void> {
    if (!caTrustAnchorRemover) return;
    try {
      await caTrustAnchorRemover(anchor.fingerprint, anchor.pem);
    } catch {
      anchorRemovalWarning = "previous-anchor-not-removed";
      console.error("[rogatio] previous CA trust anchor was not removed");
    }
  }

  async function removeReplacedCaFiles(): Promise<void> {
    if (replacedKey) await rm(caKeyFile, { force: true });
    if (replacedPub) await rm(caPubFile, { force: true });
    if (replacedCert) await rm(caCertFile, { force: true });
  }

  /**
   * Write the snapshot back when this attempt has one. When the snapshot is
   * missing and the write completed, remove the new file so it is not left
   * beside the previous certificate.
   */
  async function restoreOrDrop(
    path: string,
    snapshot: string | undefined,
    replaced: boolean,
    mode?: number,
  ): Promise<void> {
    if (snapshot !== undefined) {
      await writeFileAtomic(path, snapshot, mode);
      return;
    }
    if (replaced) await rm(path, { force: true });
  }

  /**
   * Leave either the previous key, public certificate, and certificate, or
   * only the files this attempt finished writing. A reusable CA is left as it
   * was. A fresh install removes a file only after that write resolves. A
   * replacement removes the files it wrote only when the new certificate
   * write finished and the live certificate changed. When that write did not
   * finish, a saved key or public certificate is written back, and a file
   * written without a saved copy is removed.
   */
  async function rollbackReplacedCa(): Promise<void> {
    if (reusedExisting) return;
    if (!replacingPrevious) {
      await removeReplacedCaFiles();
      return;
    }
    const saved = await readPreviousRogatioCa(caPreviousCertFile);
    const live = await readPreviousRogatioCa(caCertFile);
    const copyKept =
      rememberedFingerprint !== undefined &&
      saved?.fingerprint === rememberedFingerprint;
    const liveDiffers = live?.fingerprint !== rememberedFingerprint;
    if (copyKept && replacedCert && liveDiffers) {
      await removeReplacedCaFiles();
      return;
    }
    if (copyKept && !replacedCert) {
      await restoreOrDrop(caKeyFile, previousKeyPem, replacedKey, 0o600);
      await restoreOrDrop(caPubFile, previousPubPem, replacedPub);
    }
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
    // Reuse a device-local CA only when both files are regular and the key
    // proves possession. POSIX also requires mode 0600 owned by this user.
    anchorRemovalWarning = undefined;
    rememberedFingerprint = undefined;
    replacingPrevious = false;
    reusedExisting = false;
    previousKeyPem = undefined;
    previousPubPem = undefined;
    replacedKey = false;
    replacedPub = false;
    replacedCert = false;
    const reusable = await reusableCaMaterial();
    reusedExisting = reusable;
    const liveAnchor = await readPreviousRogatioCa(caCertFile);
    const siblingAnchor = await readPreviousRogatioCa(caPreviousCertFile);
    let preserved: { fingerprint: string; pem: string } | undefined;
    if (!reusable) {
      // Refuse to overwrite an unreadable regular file before any trust-store
      // edit or sibling write. A readable non-CA certificate still has bytes
      // here, so it is replaced below.
      const rawCert = await readNoFollowRegularFile(caCertFile);
      previousKeyPem = await readNoFollowRegularFile(caKeyFile);
      previousPubPem = await readNoFollowRegularFile(caPubFile);
      await assertReadableIfRegular(caCertFile, rawCert);
      await assertReadableIfRegular(caKeyFile, previousKeyPem);
      await assertReadableIfRegular(caPubFile, previousPubPem);
      replacingPrevious =
        liveAnchor !== undefined || siblingAnchor !== undefined;
      const { privateKey } = generateCaKeyPair(TRUST_LIMITS.caKeyBits);
      const certResult = await createCertificate(
        "CN=Rogatio Request-Body CA",
        privateKey,
        TRUST_LIMITS.caValidityDays,
      );
      const nextFingerprint = sha1Fingerprint(certResult.certPem);
      if (
        liveAnchor &&
        siblingAnchor &&
        siblingAnchor.fingerprint !== liveAnchor.fingerprint &&
        siblingAnchor.fingerprint !== nextFingerprint
      ) {
        // The sibling is a different CA. Remove its anchor before the
        // outgoing certificate overwrites those bytes.
        await retireAnchor(siblingAnchor);
      }
      if (liveAnchor) {
        await writeFileAtomic(caPreviousCertFile, liveAnchor.pem, 0o600);
        const accepted = await readPreviousRogatioCa(caPreviousCertFile);
        if (!accepted || accepted.fingerprint !== liveAnchor.fingerprint) {
          throw new TrustError("trust.internal", "invalid-ca-certificate", [
            "invalid-ca-certificate",
          ]);
        }
        rememberedFingerprint = accepted.fingerprint;
        preserved = accepted;
      } else if (
        siblingAnchor &&
        siblingAnchor.fingerprint !== nextFingerprint
      ) {
        rememberedFingerprint = siblingAnchor.fingerprint;
        preserved = siblingAnchor;
      } else if (siblingAnchor) {
        await discardPreviousCa(caPreviousCertFile);
      }
      await writeFileAtomic(caKeyFile, certResult.keyPem, 0o600);
      replacedKey = true;
      await writeFileAtomic(caPubFile, certResult.certPem);
      replacedPub = true;
      await writeFileAtomic(caCertFile, certResult.certPem);
      replacedCert = true;
    }
    let installedNew = false;
    if (caTrustInstaller && !installerCalled) {
      await caTrustInstaller(await readFile(caCertFile, "utf8"));
      installerCalled = true;
      installedNew = true;
    }
    if (reusable && siblingAnchor && (installedNew || !caTrustInstaller)) {
      if (liveAnchor && siblingAnchor.fingerprint === liveAnchor.fingerprint) {
        await discardPreviousCa(caPreviousCertFile);
      } else {
        await retireAnchor(siblingAnchor);
        await discardPreviousCa(caPreviousCertFile);
      }
    }
    if (!reusable && installedNew && preserved) {
      const current = await readPreviousRogatioCa(caCertFile);
      if (current && current.fingerprint === preserved.fingerprint) {
        await discardPreviousCa(caPreviousCertFile);
      } else if (current && current.fingerprint !== preserved.fingerprint) {
        await retireAnchor(preserved);
        await discardPreviousCa(caPreviousCertFile);
      }
    }
  }

  async function removeCa(): Promise<void> {
    const saved = await readPreviousRogatioCa(caPreviousCertFile);
    const live = await readPreviousRogatioCa(caCertFile);
    const caWasPresent = await existsFile(caKeyFile);
    await rm(caKeyFile, { force: true });
    await rm(caPubFile, { force: true });
    await rm(caCertFile, { force: true });
    if (caWasPresent && caTrustRemover) {
      await caTrustRemover();
    }
    if (!saved) return;
    if (!caWasPresent || saved.fingerprint !== live?.fingerprint) {
      if (!caTrustAnchorRemover) {
        throw new TrustError("trust.internal", "previous-anchor-not-removed", [
          "previous-anchor-not-removed",
        ]);
      }
      await caTrustAnchorRemover(saved.fingerprint, saved.pem);
    }
    await rm(caPreviousCertFile, { force: true });
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
    return anchorRemovalWarning
      ? { ok: true, state: "trusted", reasons: [anchorRemovalWarning] }
      : { ok: true, state: "trusted" };
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

  async function verify(): Promise<VerifyResult> {
    const reasons: string[] = [];
    let manifestExists = false;
    let manifestValid = false;
    let binaryExists = false;
    let binaryExecutable = false;
    let allowedOrigins: readonly string[] = [];
    try {
      const raw = await readFile(manifestPath(), "utf8");
      manifestExists = true;
      const parsed = JSON.parse(raw) as unknown;
      if (isWellFormedManifest(parsed)) {
        manifestValid = true;
        allowedOrigins = [...parsed.allowed_origins];
        try {
          const fileStat = await stat(parsed.path);
          binaryExists = fileStat.isFile();
          // Node never sets the Unix execute bit on Windows. A regular file
          // there is the wrapper Chrome will launch.
          binaryExecutable =
            platform === "win32" ? binaryExists : (fileStat.mode & 0o111) !== 0;
          if (!binaryExists) reasons.push("binary-not-found");
          if (!binaryExecutable) reasons.push("binary-not-executable");
        } catch {
          binaryExists = false;
          reasons.push("binary-not-found");
        }
        if (allowedOrigins.length === 0) reasons.push("no-allowed-origins");
      } else {
        reasons.push("manifest-invalid");
      }
    } catch {
      reasons.push("manifest-not-found");
    }
    const caTrusted =
      (await existsFile(caKeyFile)) && (await existsFile(caCertFile));
    if (!caTrusted) reasons.push("ca-not-trusted");
    const ok =
      manifestExists &&
      manifestValid &&
      binaryExists &&
      binaryExecutable &&
      caTrusted &&
      allowedOrigins.length > 0;
    return {
      ok,
      manifestExists,
      manifestValid,
      binaryExists,
      binaryExecutable,
      caTrusted,
      allowedOriginsCount: allowedOrigins.length,
      allowedOrigins,
      reasons,
    };
  }

  return { install, uninstall, status, verify };
}
