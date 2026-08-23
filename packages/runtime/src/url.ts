import { isIP } from "node:net";
import { normalizeSiteOrigin } from "@rogatio/schema";

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasValidPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue;
    if (!/^[0-9a-fA-F]{2}$/.test(value.slice(index + 1, index + 3))) {
      return false;
    }
    index += 2;
  }
  return true;
}

function rawAuthority(value: string): string | null {
  const separator = value.indexOf("://");
  if (separator < 0) return null;
  const afterScheme = separator + 3;
  let end = value.length;
  for (const marker of ["/", "?", "#"]) {
    const index = value.indexOf(marker, afterScheme);
    if (index >= 0 && index < end) end = index;
  }
  return value.slice(afterScheme, end);
}

function hasNonAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return true;
  }
  return false;
}

function validHostname(hostname: string): boolean {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (unbracketed.includes("%") || unbracketed.endsWith(".")) return false;
  if (isIP(unbracketed) !== 0) return true;
  if (unbracketed.length === 0 || unbracketed.length > 253) return false;
  return unbracketed.split(".").every((label) => ID_PATTERN.test(label));
}

export function canonicalizeOutboundTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.trim() !== value || hasControl(value)) return null;
  if (value.includes("\\") || value.includes("#")) return null;
  if (!hasValidPercentEncoding(value)) return null;
  if (/%(?:2f|2F|5c|5C)/.test(value)) return null;

  const authority = rawAuthority(value);
  if (authority === null || authority.length === 0) return null;
  if (
    authority.includes("@") ||
    authority.includes("*") ||
    hasNonAscii(authority)
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.hash.length > 0 || url.hostname.length === 0) return null;
  if (!validHostname(url.hostname)) return null;

  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const port = url.port.length === 0 ? defaultPort : Number(url.port);
  if (!Number.isInteger(port) || (port !== 80 && port !== 443)) return null;
  if (url.protocol === "http:" && port !== 80) return null;
  if (url.protocol === "https:" && port !== 443) return null;

  const canonical = url.href;
  if (canonical.includes("#") || canonical.includes("@")) return null;
  return canonical;
}

export function targetOrigin(value: string): string | null {
  const origin = normalizeSiteOrigin(new URL(value).origin);
  return origin;
}

export function isOriginAllowed(
  target: string,
  origins: readonly string[],
): boolean {
  const origin = targetOrigin(target);
  return origin !== null && origins.includes(origin);
}
