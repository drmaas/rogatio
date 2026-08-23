function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

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
