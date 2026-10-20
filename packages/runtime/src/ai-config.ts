import { constants, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AIProviderConfig } from "./ai-client.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NOT_REGULAR_FILE = "provider config path is not a regular file";

function getConfigDir(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      return path.join(localAppData, "rogatio");
    }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      return path.join(userProfile, "AppData", "Local", "rogatio");
    }
    throw new Error("Unable to determine Windows config directory");
  }

  if (platform === "darwin") {
    const home = process.env.HOME;
    if (!home) throw new Error("HOME not set");
    return path.join(home, "Library", "Application Support", "rogatio");
  }

  // Linux and others
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "rogatio");
  }
  const home = process.env.HOME;
  if (!home) throw new Error("HOME not set");
  return path.join(home, ".config", "rogatio");
}

export function getProviderConfigPath(): string {
  return path.join(getConfigDir(), "provider.json");
}

/**
 * Windows does not define `O_NOFOLLOW`. Treat a missing constant as no extra
 * flag so `open` still succeeds; callers still reject a non-regular file
 * with `lstat`.
 */
function optionalFlag(flag: number | undefined): number {
  return typeof flag === "number" ? flag : 0;
}

/**
 * Replace a regular provider.json. `O_EXCL` is omitted so an existing regular
 * file can be truncated. `O_NOFOLLOW` matches `writeExclusiveCertificate`.
 * `O_NONBLOCK` keeps a fifo from blocking the open; the regular-file check
 * then leaves it unwritten.
 */
function writeFlags(): number {
  return (
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    optionalFlag(constants.O_NOFOLLOW) |
    optionalFlag(constants.O_NONBLOCK)
  );
}

function readFlags(): number {
  return (
    constants.O_RDONLY |
    optionalFlag(constants.O_NOFOLLOW) |
    optionalFlag(constants.O_NONBLOCK)
  );
}

function isRegularProviderFile(info: Stats): boolean {
  return info.isFile() && !info.isSymbolicLink() && !info.isFIFO();
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function isRejectedOpenError(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "ELOOP" || code === "ENXIO" || code === "EISDIR";
}

async function assertRegularProviderFile(configPath: string): Promise<void> {
  const info = await fs.lstat(configPath);
  if (!isRegularProviderFile(info)) {
    throw new Error(NOT_REGULAR_FILE);
  }
}

async function openProviderFile(
  configPath: string,
  flags: number,
  mode?: number,
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle =
      mode === undefined
        ? await fs.open(configPath, flags)
        : await fs.open(configPath, flags, mode);
  } catch (error) {
    if (isRejectedOpenError(error)) throw new Error(NOT_REGULAR_FILE);
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!isRegularProviderFile(opened)) {
      throw new Error(NOT_REGULAR_FILE);
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function readProviderConfig(): Promise<AIProviderConfig | null> {
  const configPath = getProviderConfigPath();
  try {
    await assertRegularProviderFile(configPath);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }

  let handle: FileHandle;
  try {
    handle = await openProviderFile(configPath, readFlags());
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  try {
    const content = await handle.readFile({ encoding: "utf8" });
    return JSON.parse(content) as AIProviderConfig;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function writeProviderConfig(
  config: AIProviderConfig,
): Promise<void> {
  const configPath = getProviderConfigPath();
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await fs.chmod(configDir, PRIVATE_DIR_MODE);

  try {
    await assertRegularProviderFile(configPath);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }

  const content = JSON.stringify(config, null, 2);
  const handle = await openProviderFile(
    configPath,
    writeFlags(),
    PRIVATE_FILE_MODE,
  );
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(Buffer.from(content, "utf8"));
    await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

export async function deleteProviderConfig(): Promise<void> {
  const configPath = getProviderConfigPath();
  try {
    await fs.unlink(configPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }
}
