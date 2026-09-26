import type { SourceCondition } from "@rogatio/schema";

const SCAN_LIMIT = 4096;

/**
 * Refuse patterns with a quantified group that contains unbounded quantifiers.
 * Inconclusive patterns (lookaround, backreference, scan overflow) are unsafe.
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
      index += 1;
      if (pattern[index] === "?") {
        index = skipGroup(pattern, groupStart);
        continue;
      }
      const groupEnd = skipGroup(pattern, groupStart);
      const groupBody = pattern.slice(groupStart + 1, groupEnd);
      if (containsUnboundedQuantifier(groupBody)) return { safe: false };
      index = groupEnd + 1;
      continue;
    }
    index += 1;
  }
  return { safe: true };
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
    } else if (char === ")") {
      if (depth === 0) return index;
      depth -= 1;
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
      const close = groupBody.indexOf("}", index);
      if (close === -1) return true;
      const quant = groupBody.slice(index + 1, close);
      if (!/^\d+$/.test(quant) && !/^\d+,\d+$/.test(quant)) return true;
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return false;
}
