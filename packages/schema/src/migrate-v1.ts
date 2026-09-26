import { normalizeSiteOrigin } from "./origins.js";
import type { RogatioProject, RogatioRule, SourceCondition } from "./types.js";
import { PROJECT_VERSION } from "./types.js";

export type MigrationNoticeCode =
  | "migration.possible-scope-widen"
  | "migration.initiator-policy";

export interface MigrationNotice {
  readonly code: MigrationNoticeCode;
  readonly path: string;
  readonly message: string;
}

export type MigrateV1Result =
  | { ok: true; project: RogatioProject; notices: MigrationNotice[] }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (proto === Object.prototype || proto === null)
  );
}

function ownString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function ownStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) return null;
    const entry = value[i];
    if (typeof entry !== "string") return null;
    out.push(entry);
  }
  return out;
}

const INVALID_INPUT = "migration.invalid-input";

class MigrationError extends Error {
  constructor() {
    super(INVALID_INPUT);
    this.name = "MigrationError";
  }
}

/**
 * Prove an anchored literal-host URL-regex prefix is contained in the old
 * effective origin set. Anything inconclusive returns false (caller warns).
 * A host boundary is `/`, `$`, or a fixed port followed by `/` or `$`.
 */
export function regexProvenInsideOrigins(
  urlRegex: string,
  effectiveOrigins: ReadonlySet<string>,
): boolean {
  if (effectiveOrigins.size === 0) return false;
  if (urlRegex.includes("|")) return false;
  if (!urlRegex.startsWith("^")) return false;

  let index = 1;
  let schemes: Array<"http" | "https">;
  if (urlRegex.startsWith("https?://", index)) {
    schemes = ["http", "https"];
    index += "https?://".length;
  } else if (urlRegex.startsWith("https://", index)) {
    schemes = ["https"];
    index += "https://".length;
  } else if (urlRegex.startsWith("http://", index)) {
    schemes = ["http"];
    index += "http://".length;
  } else {
    return false;
  }

  let host = "";
  while (index < urlRegex.length) {
    const char = urlRegex[index];
    if (char === "\\") {
      if (urlRegex[index + 1] !== ".") return false;
      host += ".";
      index += 2;
      continue;
    }
    if (char === "/" || char === ":" || char === "$") break;
    if (!/^[A-Za-z0-9-]$/.test(char ?? "")) return false;
    host += char;
    index += 1;
  }
  if (!isLiteralHost(host)) return false;

  let port: string | null = null;
  if (urlRegex[index] === "/") {
    // path boundary
  } else if (urlRegex[index] === "$") {
    // end anchor
  } else if (urlRegex[index] === ":") {
    index += 1;
    const start = index;
    while (
      index < urlRegex.length &&
      (urlRegex[index] ?? "") >= "0" &&
      (urlRegex[index] ?? "") <= "9"
    ) {
      index += 1;
    }
    if (index === start) return false;
    port = urlRegex.slice(start, index);
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return false;
    }
    if (urlRegex[index] !== "/" && urlRegex[index] !== "$") return false;
  } else {
    return false;
  }

  for (const scheme of schemes) {
    const origin = normalizeSiteOrigin(
      port === null ? `${scheme}://${host}` : `${scheme}://${host}:${port}`,
    );
    if (origin === null || !effectiveOrigins.has(origin)) return false;
  }
  return true;
}

function isLiteralHost(host: string): boolean {
  if (
    host.length === 0 ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    return false;
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const parts = host.split(".");
    for (const part of parts) {
      const value = Number(part);
      if (!Number.isInteger(value) || value < 0 || value > 255) return false;
    }
    return true;
  }
  return /^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/.test(host);
}

function effectiveOriginSet(
  groupOrigins: readonly string[],
  ruleOrigins: readonly string[],
): Set<string> {
  const set = new Set<string>();
  for (const raw of [...groupOrigins, ...ruleOrigins]) {
    const normalized = normalizeSiteOrigin(raw);
    if (normalized !== null) set.add(normalized);
  }
  return set;
}

function migrateRule(
  raw: unknown,
  groupOrigins: readonly string[],
  groupIndex: number,
  ruleIndex: number,
  notices: MigrationNotice[],
): RogatioRule | null {
  if (!isPlainObject(raw)) return null;
  const id = ownString(raw.id);
  const name = ownString(raw.name);
  const urlRegex = ownString(raw.urlRegex);
  if (id === null || name === null || urlRegex === null) return null;
  const ruleOrigins = ownStringArray(raw.origins);
  if (ruleOrigins === null) return null;
  const resourceTypes = raw.resourceTypes;
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) return null;
  const priority = raw.priority;
  if (typeof priority !== "number" || !Number.isInteger(priority)) return null;

  const source: SourceCondition = {
    key: "url",
    operator: "regex",
    value: urlRegex,
  };

  const effective = effectiveOriginSet(groupOrigins, ruleOrigins);
  const path = `/groups/${groupIndex}/rules/${ruleIndex}`;
  if (!regexProvenInsideOrigins(urlRegex, effective)) {
    notices.push({
      code: "migration.possible-scope-widen",
      path,
      message:
        "dropping origins may widen this rule; source keeps the previous urlRegex bytes",
    });
  }

  const rule: RogatioRule = {
    id,
    name,
    source,
    resourceTypes: resourceTypes as RogatioRule["resourceTypes"],
    priority,
  };

  // Copy optional fields without trusting prototype pollution.
  for (const key of [
    "method",
    "type",
    "redirect",
    "action",
    "headerDirection",
    "headerOperation",
    "headerName",
    "headerValue",
    "responseBody",
    "requestBody",
    "redactSensitiveInLogs",
  ] as const) {
    if (Object.hasOwn(raw, key)) {
      const value = raw[key];
      (rule as unknown as Record<string, unknown>)[key] =
        value === undefined ? undefined : structuredClone(value);
    }
  }

  return rule;
}

/**
 * Pure v1 → v2 project migration. No I/O. Notices are return values only.
 */
function assertAcyclic(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new MigrationError();
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new MigrationError();
  if (Array.isArray(value)) {
    const lengthDesc = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDesc === undefined ||
      !("value" in lengthDesc) ||
      typeof lengthDesc.value !== "number" ||
      !Number.isSafeInteger(lengthDesc.value) ||
      lengthDesc.value < 0
    ) {
      throw new MigrationError();
    }
    const length = lengthDesc.value;
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") continue;
      if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
        throw new MigrationError();
      }
    }
    for (let index = 0; index < length; index += 1) {
      const desc = Object.getOwnPropertyDescriptor(value, String(index));
      if (desc === undefined || !("value" in desc) || desc.get || desc.set) {
        throw new MigrationError();
      }
      assertAcyclic(desc.value, seen);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MigrationError();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new MigrationError();
    }
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (
      desc === undefined ||
      !("value" in desc) ||
      desc.get ||
      desc.set ||
      !desc.enumerable
    ) {
      throw new MigrationError();
    }
    assertAcyclic(desc.value, seen);
  }
}

export function migrateV1Project(input: unknown): MigrateV1Result {
  try {
    assertAcyclic(input, new WeakSet());
    return migrateOwned(input);
  } catch {
    return { ok: false, error: INVALID_INPUT };
  }
}

function migrateOwned(input: unknown): MigrateV1Result {
  if (!isPlainObject(input)) {
    return { ok: false, error: "migration.invalid-project" };
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return { ok: false, error: "migration.invalid-project" };
  }
  const version = input.version;
  if (version !== 1) {
    return { ok: false, error: "migration.not-v1" };
  }
  const name = ownString(input.name);
  if (name === null) {
    return { ok: false, error: "migration.invalid-project" };
  }
  const groupsRaw = input.groups;
  if (!Array.isArray(groupsRaw)) {
    return { ok: false, error: "migration.invalid-project" };
  }

  const notices: MigrationNotice[] = [];
  const groups: RogatioProject["groups"] = [];

  for (let gi = 0; gi < groupsRaw.length; gi += 1) {
    if (!Object.hasOwn(groupsRaw, gi)) {
      return { ok: false, error: "migration.invalid-project" };
    }
    const groupRaw = groupsRaw[gi];
    if (!isPlainObject(groupRaw)) {
      return { ok: false, error: "migration.invalid-project" };
    }
    const groupId = ownString(groupRaw.id);
    const groupName = ownString(groupRaw.name);
    const groupOrigins = ownStringArray(groupRaw.origins);
    const rulesRaw = groupRaw.rules;
    if (
      groupId === null ||
      groupName === null ||
      groupOrigins === null ||
      !Array.isArray(rulesRaw)
    ) {
      return { ok: false, error: "migration.invalid-project" };
    }
    const rules: RogatioRule[] = [];
    for (let ri = 0; ri < rulesRaw.length; ri += 1) {
      if (!Object.hasOwn(rulesRaw, ri)) {
        return { ok: false, error: "migration.invalid-project" };
      }
      const migrated = migrateRule(rulesRaw[ri], groupOrigins, gi, ri, notices);
      if (migrated === null) {
        return { ok: false, error: "migration.invalid-rule" };
      }
      rules.push(migrated);
    }
    groups.push({ id: groupId, name: groupName, rules });
  }

  notices.push({
    code: "migration.initiator-policy",
    path: "/",
    message:
      "initiator must now be a present http(s) origin; the old origins allowlist no longer applies",
  });

  // Stable order: rule notices already pushed in group/rule index order;
  // keep initiator notice last.
  const project: RogatioProject = {
    version: PROJECT_VERSION,
    name,
    groups,
  };
  if (Object.hasOwn(input, "description")) {
    const description = ownString(input.description);
    if (description === null) {
      return { ok: false, error: "migration.invalid-project" };
    }
    project.description = description;
  }
  if (Object.hasOwn(input, "requestBodyPolicy")) {
    project.requestBodyPolicy =
      input.requestBodyPolicy as RogatioProject["requestBodyPolicy"];
  }

  return { ok: true, project, notices };
}
