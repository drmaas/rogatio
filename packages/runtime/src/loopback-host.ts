/**
 * Exact Host allowlist for a listener bound to one loopback port.
 * `names` are hostnames. An IPv6 name is matched as a bracketed Host,
 * so `::1` matches `[::1]:<port>`.
 * The editor server passes `127.0.0.1` and `localhost`. The intercept
 * proxy also passes `::1`.
 */
export function isAllowedLoopbackHost(
  host: string | undefined,
  boundPort: number,
  names: readonly string[],
): boolean {
  if (
    typeof host !== "string" ||
    !Number.isInteger(boundPort) ||
    boundPort <= 0
  ) {
    return false;
  }
  const port = String(boundPort);
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0) continue;
    if (host === formatLoopbackHost(name, port)) return true;
  }
  return false;
}

/** Hostnames the intercept proxy accepts on endpoints it serves itself. */
export const INTERCEPT_PROXY_LOOPBACK_NAMES = [
  "127.0.0.1",
  "localhost",
  "::1",
] as const;

function formatLoopbackHost(name: string, port: string): string {
  if (name.startsWith("[") && name.endsWith("]")) return `${name}:${port}`;
  if (name.includes(":")) return `[${name}]:${port}`;
  return `${name}:${port}`;
}
