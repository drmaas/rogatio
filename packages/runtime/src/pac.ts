import { normalizeSiteOrigin } from "@rogatio/schema";
import { MAX_PAC_ORIGINS } from "./types.js";

export interface PacEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface PacOptions {
  readonly proxyType?: "PROXY" | "HTTPS";
}

/**
 * Generate a deterministic Chrome PAC script for the given site origins.
 * Origins are validated, deduplicated, and sorted so output is stable
 * (spec REQ-025..REQ-027). Invalid origins are dropped; more than
 * MAX_PAC_ORIGINS distinct origins throws.
 */
export function generatePacScript(
  origins: readonly string[],
  endpoint: PacEndpoint,
  options?: PacOptions,
): string {
  if (!Array.isArray(origins)) {
    throw new Error("pac origins must be an array");
  }

  const valid: string[] = [];
  for (const origin of origins) {
    const normalized = normalizeSiteOrigin(origin);
    if (normalized !== null) valid.push(normalized);
  }

  const unique = Array.from(new Set(valid)).sort();
  if (unique.length > MAX_PAC_ORIGINS) {
    throw new Error("pac origin count exceeds maximum");
  }

  const proxyType = options?.proxyType ?? "PROXY";
  const proxy = `${proxyType} ${endpoint.host}:${endpoint.port}`;
  const originsLiteral = JSON.stringify(unique);
  const proxyLiteral = JSON.stringify(proxy);

  return [
    "function FindProxyForURL(url, host) {",
    `  var origins = ${originsLiteral};`,
    "  var origin = null;",
    "  try { origin = new URL(url).origin; } catch (e) { origin = null; }",
    "  if (origin !== null && origins.indexOf(origin) !== -1) {",
    `    return ${proxyLiteral};`,
    "  }",
    "  return 'DIRECT';",
    "}",
  ].join("\n");
}
