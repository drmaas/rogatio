import { hasControl } from "@rogatio/schema";

export function normalizeLogicalPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.includes("\\") || value.includes("%") || hasControl(value)) {
    return null;
  }
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) {
    return null;
  }

  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        /[*?[\]]/.test(part),
    )
  ) {
    return null;
  }
  return parts.join("/");
}
