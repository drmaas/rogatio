import type { Stats } from "node:fs";
import { constants, existsSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, readlink, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import {
  darwinConfinedAvailable,
  darwinPathOf,
  openDarwinRelative,
} from "./darwin-confined.js";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { normalizeLogicalPath } from "./path.js";
import type { RuntimeResult } from "./types.js";

export interface ConfinedHandle {
  readonly fd: number;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  stat(): Promise<Stats>;
  close(): Promise<void>;
}

export interface ConfinedDirectoryOps {
  openRelative(
    dirFd: number,
    component: string,
    flags: number,
  ): Promise<ConfinedHandle>;
  pathOf(fd: number): Promise<string | null>;
}

/**
 * Linux proves confinement through procfs. macOS proves it through openat and
 * F_GETPATH. Anything else, including a macOS host whose FFI library did not
 * load, cannot prove confinement and must not fall back to a path-only open.
 */
export function isConfinedFileSupported(): boolean {
  if (process.platform === "linux") {
    return (
      typeof constants.O_NOFOLLOW === "number" &&
      typeof constants.O_DIRECTORY === "number" &&
      typeof constants.O_NONBLOCK === "number" &&
      existsSync("/proc/self/fd")
    );
  }
  return darwinConfinedAvailable();
}

function fdRelativePath(dirFd: number, component: string): string {
  return `/proc/self/fd/${dirFd}/${component}`;
}

function withinRoot(root: string, candidate: string): boolean {
  const rest = relative(root, candidate);
  return (
    rest.length > 0 &&
    rest !== ".." &&
    !rest.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(rest)
  );
}

function fromNodeHandle(file: FileHandle): ConfinedHandle {
  return {
    fd: file.fd,
    read: (buffer, offset, length, position) =>
      file.read(buffer, offset, length, position),
    stat: () => file.stat(),
    close: () => file.close(),
  };
}

const linuxOps: ConfinedDirectoryOps = {
  async openRelative(dirFd, component, flags) {
    return fromNodeHandle(await open(fdRelativePath(dirFd, component), flags));
  },
  async pathOf(fd) {
    try {
      // readlink returns the kernel's canonical path without resolving anything
      // a second time, so no symlink can be followed while proving containment.
      return await readlink(`/proc/self/fd/${fd}`);
    } catch {
      return null;
    }
  },
};

function platformOps(): ConfinedDirectoryOps | undefined {
  if (process.platform === "linux" && isConfinedFileSupported())
    return linuxOps;
  if (process.platform === "darwin" && darwinConfinedAvailable()) {
    return { openRelative: openDarwinRelative, pathOf: darwinPathOf };
  }
  return undefined;
}

async function closeQuietly(file: ConfinedHandle): Promise<void> {
  try {
    await file.close();
  } catch {
    // Cleanup must not replace the stable operation result.
  }
}

async function proveDescriptorWithinRoot(
  file: ConfinedHandle,
  canonicalRoot: string,
  pathOf: ConfinedDirectoryOps["pathOf"],
): Promise<RuntimeResult<void>> {
  const resolved = await pathOf(file.fd);
  if (resolved === null || !withinRoot(canonicalRoot, resolved)) {
    return failure("runtime.file-race-rejected");
  }
  return { ok: true, value: undefined };
}

function openFlags(directory: boolean): number {
  if (directory) {
    return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  }
  // O_NONBLOCK keeps a FIFO or device leaf from blocking the open; the
  // regular-file check below rejects it.
  return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}

export async function openConfinedUsing(
  root: string,
  logicalPath: string,
  ops: ConfinedDirectoryOps,
): Promise<RuntimeResult<ConfinedHandle>> {
  const normalized = normalizeLogicalPath(logicalPath);
  if (normalized === null) return failure("runtime.file-denied");
  const components = normalized.split("/");

  let parent: ConfinedHandle | undefined;
  try {
    const canonicalRoot = await realpath(root);
    parent = fromNodeHandle(
      await open(canonicalRoot, constants.O_RDONLY | constants.O_DIRECTORY),
    );

    for (let index = 0; index < components.length - 1; index += 1) {
      const component = components[index] ?? "";
      const next = await ops.openRelative(
        parent.fd,
        component,
        openFlags(true),
      );
      await closeQuietly(parent);
      parent = next;
    }

    const leaf = components[components.length - 1] ?? "";
    const file = await ops.openRelative(parent.fd, leaf, openFlags(false));
    await closeQuietly(parent);
    parent = undefined;

    try {
      const containment = await proveDescriptorWithinRoot(
        file,
        canonicalRoot,
        ops.pathOf,
      );
      if (!containment.ok) {
        await closeQuietly(file);
        return containment;
      }

      const stat = await file.stat();
      if (!stat.isFile()) {
        await closeQuietly(file);
        return failure("runtime.file-denied");
      }
      if (stat.nlink !== 1) {
        await closeQuietly(file);
        return failure("runtime.file-race-rejected");
      }
      if (stat.size > RUNTIME_LIMITS.maxFileBytes) {
        await closeQuietly(file);
        return failure("runtime.size-limit");
      }
      return { ok: true, value: file };
    } catch {
      await closeQuietly(file);
      return failure("runtime.file-denied");
    }
  } catch {
    return failure("runtime.file-denied");
  } finally {
    if (parent !== undefined) await closeQuietly(parent);
  }
}

export async function openConfinedFile(
  root: string,
  logicalPath: string,
): Promise<RuntimeResult<ConfinedHandle>> {
  // A path that is illegal on every platform is a denial, not an unsupported
  // reader. The platform check comes after that.
  if (normalizeLogicalPath(logicalPath) === null) {
    return failure("runtime.file-denied");
  }
  const ops = platformOps();
  if (ops === undefined) return failure("runtime.platform-unsupported");
  return openConfinedUsing(root, logicalPath, ops);
}
