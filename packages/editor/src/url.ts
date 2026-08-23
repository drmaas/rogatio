import type { UrlConversionResult } from "./types.js";

const F2_MAX_URL_REGEX_LENGTH = 2048;
const REGEX_META_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function urlToExactRegex(value: string): UrlConversionResult {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    return { ok: false, code: "editor.invalid-url" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "editor.invalid-url" };
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin === "null" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    return { ok: false, code: "editor.invalid-url" };
  }

  const escaped = url.href.replace(REGEX_META_CHARACTERS, "\\$&");
  const source = `^${escaped}$`;
  if (source.length > F2_MAX_URL_REGEX_LENGTH) {
    return { ok: false, code: "editor.url-too-long" };
  }

  return { ok: true, source };
}
