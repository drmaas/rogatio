import type { Stats } from "node:fs";
import { close, fstat, read } from "node:fs";
import { createRequire } from "node:module";
import type { ConfinedHandle } from "./platform-file.js";

/** Apple fcntl.h F_GETPATH. The buffer must be MAXPATHLEN bytes. */
const F_GETPATH = 50;
const MAXPATHLEN = 1024;
/** Apple fcntl.h O_CLOEXEC. Set on openat so the descriptor is not inherited. */
const O_CLOEXEC = 0x1000000;
const LIB_SYSTEM = "/usr/lib/libSystem.B.dylib";

interface DarwinBinding {
  openat(dirfd: number, path: string, flags: number): number;
  pathOf(fd: number): string | null;
}

type KoffiFunction = (...args: unknown[]) => unknown;

interface KoffiLibrary {
  func(prototype: string): KoffiFunction;
}

interface KoffiModule {
  load(path: string): KoffiLibrary;
}

let binding: DarwinBinding | undefined;

function loadKoffi(): KoffiModule {
  const require = createRequire(import.meta.url);
  const loaded = require("koffi") as KoffiModule | { default: KoffiModule };
  if (typeof (loaded as KoffiModule).load === "function") {
    return loaded as KoffiModule;
  }
  return (loaded as { default: KoffiModule }).default;
}

function decodePath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length >= MAXPATHLEN
  ) {
    return null;
  }
  const end = value.indexOf("\0");
  const path = end === -1 ? value : value.slice(0, end);
  return path.length > 0 ? path : null;
}

/**
 * macOS confinement primitives Node does not expose: open a single path
 * component from a held directory descriptor, and read that descriptor's path.
 * A failed load means the platform cannot prove confinement.
 */
export function loadDarwinConfined(): DarwinBinding {
  if (binding) return binding;
  const koffi = loadKoffi();
  const lib = koffi.load(LIB_SYSTEM);
  const openat = lib.func(
    "int openat(int dirfd, const char *pathname, int flags, ...)",
  );
  const fcntl = lib.func("int fcntl(int fd, int cmd, ...)");
  binding = {
    openat(dirfd, path, flags) {
      const fd = openat(dirfd, path, flags | O_CLOEXEC);
      if (typeof fd !== "number" || fd < 0) {
        throw new Error("openat failed");
      }
      return fd;
    },
    pathOf(fd) {
      try {
        const out = ["\0".repeat(MAXPATHLEN)];
        const result = fcntl(fd, F_GETPATH, "_Out_ char *", out);
        if (typeof result !== "number" || result < 0) return null;
        return decodePath(out[0]);
      } catch {
        return null;
      }
    },
  };
  return binding;
}

export function darwinConfinedAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    loadDarwinConfined();
    return true;
  } catch {
    return false;
  }
}

function isSingleComponent(component: string): boolean {
  return (
    component.length > 0 &&
    component !== "." &&
    component !== ".." &&
    !component.includes("/") &&
    !component.includes("\\") &&
    !component.includes("\0")
  );
}

export function handleFromFd(fd: number): ConfinedHandle {
  let closed = false;
  return {
    fd,
    read(buffer, offset, length, position) {
      return new Promise((resolve, reject) => {
        read(fd, buffer, offset, length, position, (error, bytesRead) => {
          if (error) reject(error);
          else resolve({ bytesRead });
        });
      });
    },
    stat() {
      return new Promise((resolve, reject) => {
        fstat(fd, (error, stats) => {
          if (error) reject(error);
          else resolve(stats as Stats);
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        close(fd, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

export async function openDarwinRelative(
  dirFd: number,
  component: string,
  flags: number,
): Promise<ConfinedHandle> {
  if (!isSingleComponent(component)) throw new Error("openat rejected");
  const fd = loadDarwinConfined().openat(dirFd, component, flags);
  return handleFromFd(fd);
}

export async function darwinPathOf(fd: number): Promise<string | null> {
  return loadDarwinConfined().pathOf(fd);
}
