import {
  decodePacSteer,
  isPacSafeSource,
  literalHostname,
  literalUrl,
  type SteeredOrigin,
  steeredRequestOrigin,
} from "@rogatio/compiler";
import type { SourceCondition } from "@rogatio/schema";
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
  readonly steer?: SteeredOrigin;
}

/**
 * Derive request-body PAC routes from sources.
 * Host-key rules compare the PAC host. A URL regex that names one literal
 * host steers `scheme://host/*`. The path regex is not copied into the script.
 * Unsafe sources are omitted. No RegExp in the script.
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
      continue;
    }
    const steer = steeredRequestOrigin(source);
    if (steer !== null) {
      const key = steerKey(steer);
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({ steer });
      }
      continue;
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

function steerKey(origin: SteeredOrigin): string {
  const port = origin.port !== undefined ? `:${origin.port}` : "";
  return `steer:${origin.scheme}://${origin.host}${port}`;
}

function routeValue(route: PacRoute): string {
  if (route.steer !== undefined) return steerKey(route.steer);
  return route.url ?? route.hostname ?? "";
}

/** Decode a session pacRoutes string into a PAC route. Invalid entries are omitted. */
export function pacRouteFromEntry(entry: string): PacRoute | null {
  const steer = decodePacSteer(entry);
  if (steer !== null) return { steer };
  if (entry.includes("://")) {
    return isExactHttpUrl(entry) ? { url: entry } : null;
  }
  if (entry.length === 0) return null;
  return { hostname: entry };
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
  if (route.steer !== undefined) {
    return {
      key: steerKey(route.steer),
      line: steerPredicate(route.steer),
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

function steerPredicate(origin: SteeredOrigin): string {
  const hostCheck = `host === ${JSON.stringify(origin.host)}`;
  const base =
    origin.port !== undefined
      ? `${origin.scheme}://${origin.host}:${origin.port}`
      : `${origin.scheme}://${origin.host}`;
  if (origin.port !== undefined) {
    const withSlash = JSON.stringify(`${base}/`);
    const exact = JSON.stringify(base);
    const withQuery = JSON.stringify(`${base}?`);
    return `${hostCheck} && (url.indexOf(${withSlash}) === 0 || url === ${exact} || url.indexOf(${withQuery}) === 0)`;
  }
  return `${hostCheck} && url.indexOf(${JSON.stringify(base)}) === 0`;
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
 * Literal hosts compare the PAC `host` argument. Steered origins compare
 * `host` and a `scheme://host` prefix of `url`. Exact URLs compare `url`.
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
