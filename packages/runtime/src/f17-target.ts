import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

const PRIVATE_RANGES = [
  { start: ipToInt("10.0.0.0"), end: ipToInt("10.255.255.255") },
  { start: ipToInt("172.16.0.0"), end: ipToInt("172.31.255.255") },
  { start: ipToInt("192.168.0.0"), end: ipToInt("192.168.255.255") },
  { start: ipToInt("127.0.0.0"), end: ipToInt("127.255.255.255") },
  { start: ipToInt("169.254.0.0"), end: ipToInt("169.254.255.255") },
  { start: ipToInt("0.0.0.0"), end: ipToInt("0.255.255.255") },
  { start: ipToInt("224.0.0.0"), end: ipToInt("239.255.255.255") },
  { start: ipToInt("240.0.0.0"), end: ipToInt("255.255.255.255") },
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function isPublicAddress(ip: string): boolean {
  const intIp = ipToInt(ip);
  return !PRIVATE_RANGES.some(
    (range) => intIp >= range.start && intIp <= range.end,
  );
}

export function classifyAddress(ip: string): "public" | "private" | "invalid" {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return "invalid";
  }
  const parts = ip.split(".").map(Number);
  if (parts.some((p) => p < 0 || p > 255)) return "invalid";
  return isPublicAddress(ip) ? "public" : "private";
}

export async function resolveAndPin(
  target: string,
): Promise<RuntimeResult<string>> {
  try {
    const url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failure("runtime.request-body-invalid-scheme");
    }
    const hostname = url.hostname;

    const addresses: string[] = [];
    try {
      const { promises: dns } = await import("node:dns");
      const records = await dns.resolve(hostname, "A");
      for (const addr of records) addresses.push(addr);
    } catch {}
    try {
      const { promises: dns } = await import("node:dns");
      const records = await dns.resolve(hostname, "AAAA");
      for (const addr of records) addresses.push(addr);
    } catch {}

    if (addresses.length === 0) {
      return failure("runtime.request-body-dns-failed");
    }

    const classifications = addresses.map(classifyAddress);
    if (classifications.some((c) => c === "invalid")) {
      return failure("runtime.request-body-dns-invalid");
    }
    const hasPublic = classifications.includes("public");
    const hasPrivate = classifications.includes("private");
    if (hasPublic && hasPrivate) {
      return failure("runtime.request-body-dns-mixed-public-private");
    }

    const pinned = addresses[0];
    return { ok: true, value: pinned };
  } catch {
    return failure("runtime.request-body-dns-failed");
  }
}

export function validateTargetUrl(
  target: string,
  allowedOrigins: readonly string[],
  localOrigins: readonly string[],
): RuntimeResult<void> {
  try {
    const url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failure("runtime.request-body-invalid-scheme");
    }
    if (url.username || url.password) {
      return failure("runtime.request-body-target-credentials");
    }
    const origin = url.origin;
    const isLocal = localOrigins.includes(origin);
    const isPublic = allowedOrigins.includes(origin);
    if (!isLocal && !isPublic) {
      return failure("runtime.request-body-target-denied");
    }
    return { ok: true, value: undefined };
  } catch {
    return failure("runtime.request-body-target-invalid");
  }
}
