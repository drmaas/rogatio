export interface ParsedTestUrl {
  origin: string;
  href: string;
}

export type ParseTestUrlResult =
  | { ok: true; value: ParsedTestUrl }
  | { ok: false };

export function parseTestUrl(input: unknown): ParseTestUrlResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false };
  }
  if (url.origin === "null") {
    return { ok: false };
  }
  return { ok: true, value: { origin: url.origin, href: url.href } };
}
