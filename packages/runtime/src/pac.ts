import { literalHostname, literalUrl } from "@rogatio/compiler";
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
  readonly hostname?: string;
  readonly url?: string;
}

/**
 * Derive PAC routes from body-rule sources.
 * Literal hosts and exact http(s) URLs only. Wildcard URL patterns and
 * unsafe sources are omitted. No RegExp and no host extraction.
 */
export function pacRoutesFromSources(
  sources: readonly SourceCondition[],
): readonly PacRoute[] {
  const routes: PacRoute[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!isPacSafeSource(source)) continue;
    const hostname = literalHostname(source);
    if (hostname !== null && !seen.has(`host:${hostname}`)) {
      seen.add(`host:${hostname}`);
      routes.push({ hostname });
    }
    const url = literalUrl(source);
    if (url !== null && !seen.has(`url:${url}`)) {
      seen.add(`url:${url}`);
      routes.push({ url });
    }
  }
  return routes.sort((left, right) =>
    routeValue(left).localeCompare(routeValue(right)),
  );
}

function routeValue(route: PacRoute): string {
  return route.url ?? route.hostname ?? "";
}

function pacCheck(
  route: PacRoute,
): { readonly key: string; readonly line: string } | null {
  if (typeof route.url === "string" && isExactHttpUrl(route.url)) {
    return {
      key: `url:${route.url}`,
      line: `url === ${JSON.stringify(route.url)}`,
    };
  }
  if (
    typeof route.hostname === "string" &&
    route.hostname.length > 0 &&
    !route.hostname.includes("://")
  ) {
    return {
      key: `host:${route.hostname}`,
      line: `host === ${JSON.stringify(route.hostname)}`,
    };
  }
  return null;
}

function isExactHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.href === value
    );
  } catch {
    return false;
  }
}

/**
 * Generate a deterministic Chrome PAC script.
 * Literal hosts compare the PAC `host` argument. Exact URLs compare `url`.
 * No RegExp and no URL parsing inside the script.
 */
export function generatePacScript(
  routes: readonly PacRoute[],
  endpoint: PacEndpoint,
  options?: PacOptions,
): string {
  if (!Array.isArray(routes)) {
    throw new Error("runtime.pac-route-limit");
  }

  const checksByKey = new Map<string, string>();
  for (const route of routes) {
    const check = pacCheck(route);
    if (check === null) continue;
    checksByKey.set(check.key, check.line);
  }
  const sorted = [...checksByKey.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (sorted.length > MAX_PAC_ROUTES) {
    throw new Error("runtime.pac-route-limit");
  }

  const proxyType = options?.proxyType ?? "PROXY";
  const proxy = `${proxyType} ${endpoint.host}:${endpoint.port}`;
  const proxyLiteral = JSON.stringify(proxy);

  const checks = sorted.map(
    ([, predicate]) =>
      `  if (${predicate}) {\n    return ${proxyLiteral};\n  }`,
  );

  return [
    "function FindProxyForURL(url, host) {",
    ...checks,
    "  return 'DIRECT';",
    "}",
    "",
  ].join("\n");
}
