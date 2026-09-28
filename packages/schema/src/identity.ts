import { LIMITS } from "./limits.js";

/**
 * Identity derivation for groups and rules.
 *
 * Ids are minted from an entity's name, and names are compared per project, so
 * that every label the product shows identifies exactly one entity. The minting
 * convention is deliberately *not* a validation rule: the project schema accepts
 * any id matching its own pattern, so projects authored by hand and every
 * existing fixture keep working unchanged.
 *
 * Everything here is pure and total. No function throws on a hostile or absent
 * name, and no function reads anything but its arguments.
 */

export type EntityKind = "group" | "rule";

/** Runs of characters that are not ASCII alphanumerics. */
const NON_ALPHANUMERIC = /[^a-z0-9]+/u;

/** Runs of any whitespace, including tabs and newlines. */
const WHITESPACE_RUN = /\s+/gu;

const FALLBACK_PREFIX: Readonly<Record<EntityKind, string>> = Object.freeze({
  group: "Group",
  rule: "Rule",
});

/**
 * The comparison key for per-project name uniqueness: trimmed, internal
 * whitespace runs collapsed to one space, lower-cased.
 *
 * Every `\s` class is collapsed, which includes the non-ASCII spaces (U+00A0,
 * U+2028 and friends). That is stricter than "spaces and tabs", and deliberately
 * so: a name that differs only by an invisible space should not be able to sit
 * beside its twin looking identical.
 *
 * `toLowerCase` is deliberately locale-independent. A locale-sensitive fold would
 * make uniqueness depend on the host's environment, and the same project would
 * validate in one locale and fail in another.
 */
export function normalizeNameKey(name: string): string {
  if (typeof name !== "string") return "";
  return name.trim().replace(WHITESPACE_RUN, " ").toLowerCase();
}

/**
 * Lower-case, split on non-alphanumeric runs, capitalize each token, join.
 * Returns an empty string when the name yields no tokens, which is the signal
 * for the caller to use the kind's fallback prefix.
 */
function pascalCase(value: string): string {
  const tokens = value.toLowerCase().split(NON_ALPHANUMERIC);
  let result = "";
  for (const token of tokens) {
    const first = token.charAt(0);
    if (first.length === 0) continue;
    result += first.toUpperCase() + token.slice(1);
  }
  return result;
}

/**
 * Append an incrementing integer until the candidate is free, keeping the result
 * within `maxLength` including its suffix. The first use is unsuffixed.
 */
function allocate(
  stem: string,
  reserved: Set<string>,
  maxLength: number,
): string {
  for (let suffix = 1; ; suffix += 1) {
    const suffixText = suffix === 1 ? "" : String(suffix);
    // Keep at least one character of the stem so a very long name still yields a
    // readable id rather than a bare counter.
    const room = Math.max(1, maxLength - suffixText.length);
    const candidate = `${stem.slice(0, room)}${suffixText}`;
    if (reserved.has(candidate)) continue;
    reserved.add(candidate);
    return candidate;
  }
}

/**
 * The id for a new group or rule, derived from its name.
 *
 * Group and rule ids share one project-wide namespace, so `reserved` is the
 * union of every id already in the project. The returned id is added to
 * `reserved`, so a caller can allocate repeatedly against one set.
 */
export function deriveEntityId(
  name: unknown,
  kind: EntityKind,
  reserved: Set<string>,
): string {
  const derived = pascalCase(typeof name === "string" ? name : "");
  return allocate(
    derived.length > 0 ? derived : FALLBACK_PREFIX[kind],
    reserved,
    LIMITS.maxIdLength,
  );
}

/**
 * A name that is unique in the project, based on `base`.
 *
 * The base is returned as handed in; only the comparison is normalized, so the
 * function never has to remember an earlier spelling. The returned key is added
 * to `reserved`.
 */
export function uniqueName(base: string, reserved: Set<string>): string {
  const label = typeof base === "string" ? base : "";
  for (let suffix = 1; ; suffix += 1) {
    const suffixText = suffix === 1 ? "" : ` ${suffix}`;
    const room = Math.max(1, LIMITS.maxLabelLength - suffixText.length);
    const candidate = `${label.slice(0, room)}${suffixText}`;
    const key = normalizeNameKey(candidate);
    if (reserved.has(key)) continue;
    reserved.add(key);
    return candidate;
  }
}
