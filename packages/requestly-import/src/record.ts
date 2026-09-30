export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function ownString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function ownBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

export function displayName(name: string): string {
  const collapsed = name.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : "(unnamed)";
}

export function cleanLabel(name: string, fallback: string): string {
  const collapsed = name.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : fallback;
}
