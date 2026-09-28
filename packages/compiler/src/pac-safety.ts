import type { SourceCondition } from "@rogatio/schema";

const SCAN_LIMIT = 4096;

/**
 * Refuse a quantified group that contains an unbounded quantifier (`*`, `+`,
 * or `{n,}`). A group such as `([^/]+)` is safe: the `+` is inside the group,
 * and the group itself is not quantified. Inconclusive patterns (lookaround,
 * backreference, scan overflow) are unsafe.
 */
export function isPacSafeSource(source: SourceCondition): boolean {
  if (source.operator !== "regex") return false;
  return scanPacSafety(source.value).safe;
}

type SafetyScan = { readonly safe: true } | { readonly safe: false };

function scanPacSafety(pattern: string): SafetyScan {
  if (pattern.length > SCAN_LIMIT) return { safe: false };
  let index = 0;
  const length = pattern.length;
  while (index < length) {
    const char = pattern[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      index = skipCharacterClass(pattern, index + 1);
      continue;
    }
    if (char === "(") {
      const groupStart = index;
      if (pattern[index + 1] === "?") return { safe: false };
      const groupEnd = skipGroup(pattern, groupStart);
      if (groupEnd >= length || pattern[groupEnd] !== ")") {
        return { safe: false };
      }
      const groupBody = pattern.slice(groupStart + 1, groupEnd);
      const inner = scanPacSafety(groupBody);
      if (!inner.safe) return { safe: false };
      const quantifier = quantifierAt(pattern, groupEnd + 1);
      if (
        quantifier === "unbounded" &&
        containsUnboundedQuantifier(groupBody)
      ) {
        return { safe: false };
      }
      index =
        quantifier === null
          ? groupEnd + 1
          : skipQuantifier(pattern, groupEnd + 1);
      continue;
    }
    index += 1;
  }
  return { safe: true };
}

function quantifierAt(
  pattern: string,
  index: number,
): "bounded" | "unbounded" | null {
  const char = pattern[index];
  if (char === "*" || char === "+") return "unbounded";
  if (char !== "{") return null;
  const close = pattern.indexOf("}", index);
  if (close === -1) return "unbounded";
  const quant = pattern.slice(index + 1, close);
  if (/^\d+$/.test(quant) || /^\d+,\d+$/.test(quant)) return "bounded";
  return "unbounded";
}

function skipQuantifier(pattern: string, index: number): number {
  const char = pattern[index];
  if (char === "*" || char === "+") return index + 1;
  if (char !== "{") return index;
  const close = pattern.indexOf("}", index);
  return close === -1 ? pattern.length : close + 1;
}

function skipCharacterClass(pattern: string, start: number): number {
  let index = start;
  if (pattern[index] === "^") index += 1;
  while (index < pattern.length) {
    if (pattern[index] === "\\") {
      index += 2;
      continue;
    }
    if (pattern[index] === "]") return index + 1;
    index += 1;
  }
  return pattern.length;
}

function skipGroup(pattern: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      index = skipCharacterClass(pattern, index + 1);
      continue;
    }
    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
      continue;
    }
    index += 1;
  }
  return pattern.length;
}

function containsUnboundedQuantifier(groupBody: string): boolean {
  let index = 0;
  while (index < groupBody.length) {
    const char = groupBody[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      index = skipCharacterClass(groupBody, index + 1);
      continue;
    }
    if (char === "(") {
      index = skipGroup(groupBody, index) + 1;
      continue;
    }
    if (char === "*" || char === "+") return true;
    if (char === "{") {
      if (quantifierAt(groupBody, index) === "unbounded") return true;
      index = skipQuantifier(groupBody, index);
      continue;
    }
    index += 1;
  }
  return false;
}
