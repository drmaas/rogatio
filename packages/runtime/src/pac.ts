import { literalHostname } from "@rogatio/compiler";
import type { SourceCondition } from "@rogatio/schema";
import { isPacSafeSource } from "./pac-safety.js";
import { MAX_PAC_ROUTES } from "./types.js";

export interface PacEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface PacOptions {
  readonly proxyType?: "PROXY" | "HTTPS";
}

export interface PacRoute {
  readonly hostname: string;
}

/**
 * Derive literal-host PAC routes from compiled body-rule sources.
 * Non-literal and unsafe sources are omitted (fail-closed for T13).
 */
export function pacRoutesFromSources(
  sources: readonly SourceCondition[],
): readonly PacRoute[] {
  const hosts = new Set<string>();
  for (const source of sources) {
    if (!isPacSafeSource(source)) continue;
    const hostname = literalHostname(source);
    if (hostname !== null) hosts.add(hostname);
  }
  return [...hosts].sort().map((hostname) => ({ hostname }));
}

/**
 * Generate a deterministic Chrome PAC script for literal host routes only.
 * Uses string equality on the PAC `host` argument — no RegExp, no URL parsing.
 */
export function generatePacScript(
  routes: readonly PacRoute[],
  endpoint: PacEndpoint,
  options?: PacOptions,
): string {
  if (!Array.isArray(routes)) {
    throw new Error("runtime.pac-route-limit");
  }

  const unique = routes
    .map((route) => route.hostname)
    .filter((hostname) => typeof hostname === "string" && hostname.length > 0);
  const sorted = [...new Set(unique)].sort();
  if (sorted.length > MAX_PAC_ROUTES) {
    throw new Error("runtime.pac-route-limit");
  }

  const proxyType = options?.proxyType ?? "PROXY";
  const proxy = `${proxyType} ${endpoint.host}:${endpoint.port}`;
  const proxyLiteral = JSON.stringify(proxy);

  const checks = sorted.map(
    (hostname) =>
      `  if (host === ${JSON.stringify(hostname)}) {\n    return ${proxyLiteral};\n  }`,
  );

  return [
    "function FindProxyForURL(url, host) {",
    ...checks,
    "  return 'DIRECT';",
    "}",
    "",
  ].join("\n");
}
