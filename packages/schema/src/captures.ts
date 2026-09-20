export interface CaptureTemplateIssue {
  readonly code: "invalid-syntax" | "out-of-range";
  readonly message: string;
  readonly offset: number;
  readonly referenced?: number;
  readonly groups: number;
}

function skipBalancedGroup(source: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return source.length;
}

/** Count numbered capturing groups using the project's regex rules. */
export function countCapturingGroups(urlRegex: string): number {
  let count = 0;
  let index = 0;
  while (index < urlRegex.length) {
    const char = urlRegex[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      if (urlRegex[index + 1] === "?") {
        index = skipBalancedGroup(urlRegex, index);
        continue;
      }
      count += 1;
    }
    index += 1;
  }
  return count;
}

/** Validate URL-capture references in an authored replacement string. */
export function validateCaptureTemplate(
  template: string,
  urlRegex: string,
): readonly CaptureTemplateIssue[] {
  const groups = countCapturingGroups(urlRegex);
  const issues: CaptureTemplateIssue[] = [];
  for (let index = 0; index < template.length; index += 1) {
    if (template[index] !== "$") continue;
    const next = template[index + 1];
    if (next === "$") {
      index += 1;
      continue;
    }
    if (next === undefined || next < "0" || next > "9") {
      issues.push({
        code: "invalid-syntax",
        message:
          "Capture references must use $1 through $9; use $$ for a literal $.",
        offset: index,
        groups,
      });
      continue;
    }
    const referenced = Number(next);
    if (
      referenced === 0 ||
      ((template[index + 2] ?? "") >= "0" && (template[index + 2] ?? "") <= "9")
    ) {
      issues.push({
        code: "invalid-syntax",
        message: "Capture references must use one digit: $1 through $9.",
        offset: index,
        referenced,
        groups,
      });
      continue;
    }
    if (referenced > groups) {
      issues.push({
        code: "out-of-range",
        message: `Capture group $${referenced} is not defined by the URL pattern, which has ${groups} group${groups === 1 ? "" : "s"}.`,
        offset: index,
        referenced,
        groups,
      });
    }
  }
  return issues;
}

/** Return true when a template contains a URL capture reference. */
export function containsUrlCaptureReference(template: string): boolean {
  for (let index = 0; index < template.length - 1; index += 1) {
    if (
      template[index] === "$" &&
      template[index + 1] >= "1" &&
      template[index + 1] <= "9"
    ) {
      return true;
    }
    if (template[index] === "$" && template[index + 1] === "$") index += 1;
  }
  return false;
}

/** Apply URL captures. Missing optional captures become empty strings. */
export function substituteUrlCaptures(
  template: string,
  captures: readonly (string | undefined)[],
): string {
  let output = "";
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];
    if (char !== "$") {
      output += char;
      continue;
    }
    const next = template[index + 1];
    if (next === "$") {
      output += "$";
      index += 1;
      continue;
    }
    if (next !== undefined && next >= "1" && next <= "9") {
      output += captures[Number(next) - 1] ?? "";
      index += 1;
      continue;
    }
    output += "$";
  }
  return output;
}

/** Return URL regex captures for a complete request URL. */
export function matchUrlCaptures(
  urlRegex: string,
  url: string,
): readonly (string | undefined)[] | null {
  try {
    const match = new RegExp(urlRegex).exec(url);
    return match === null ? null : match.slice(1);
  } catch {
    return null;
  }
}
