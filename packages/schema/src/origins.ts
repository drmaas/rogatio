export function normalizeSiteOrigin(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value)
    return null;
  if (value.includes("?") || value.includes("#")) return null;

  const match = /^(https?):\/\/([^/?#\\\s]+)(\/)?$/i.exec(value);
  if (!match || match[2].includes("@")) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === "null" || url.hostname.length === 0) return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.hostname.includes("*")) return null;
  if (url.hostname.endsWith(".")) return null;
  if (url.pathname !== "/") return null;

  return url.origin;
}

export function isSiteOrigin(value: unknown): value is string {
  return typeof value === "string" && normalizeSiteOrigin(value) !== null;
}
