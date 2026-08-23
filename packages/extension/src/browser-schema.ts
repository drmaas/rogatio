import type { HttpMethod, ResourceType, RogatioProject } from "@rogatio/schema";

export const PROJECT_VERSION = 1 as const;
export const RESOURCE_TYPES = Object.freeze([
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "media",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const);
export const HTTP_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
] as const);
export const LIMITS = Object.freeze({
  maxGroups: 64,
  maxRulesPerGroup: 256,
  maxRulesPerProject: 4096,
  maxOriginsPerScope: 32,
  maxIdLength: 64,
  maxLabelLength: 100,
  maxDescriptionLength: 1000,
  maxUrlRegexLength: 2048,
  maxResourceTypesPerRule: 16,
  minPriority: 1,
  maxPriority: 1000,
  maxRedirectDestinationLength: 2048,
  maxCaptureGroups: 9,
});

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotOwnData(
  value: unknown,
  ancestors = new WeakSet<object>(),
): { valid: true; value: unknown } | { valid: false } {
  if (value === null || typeof value !== "object")
    return { valid: true, value };
  if (ancestors.has(value)) return { valid: false };
  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) return { valid: false };
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !length ||
        !("value" in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > LIMITS.maxRulesPerProject
      ) {
        return { valid: false };
      }
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "length") continue;
        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= length.value ||
          String(index) !== key
        ) {
          return { valid: false };
        }
      }
      const result: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return { valid: false };
        }
        const child = snapshotOwnData(descriptor.value, ancestors);
        if (!child.valid) return child;
        result.push(child.value);
      }
      return { valid: true, value: result };
    }
    const result = Object.create(null) as JsonRecord;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return { valid: false };
      }
      const child = snapshotOwnData(descriptor.value, ancestors);
      if (!child.valid) return child;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: child.value,
      });
    }
    return { valid: true, value: result };
  } catch {
    return { valid: false };
  } finally {
    ancestors.delete(value);
  }
}

function origin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value)
    return null;
  const match = /^(https?):\/\/([^/?#\\\s]+)(\/)?$/i.exec(value);
  if (!match || match[2].includes("@")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin === "null" ||
    parsed.hostname.length === 0 ||
    parsed.username ||
    parsed.password ||
    parsed.hostname.includes("*") ||
    parsed.pathname !== "/"
  )
    return null;
  return parsed.origin;
}

export function normalizeSiteOrigin(value: string): string | null {
  return origin(value);
}

export function isSiteOrigin(value: unknown): value is string {
  return origin(value) !== null;
}

export function compileUrlRegex(value: string): RegExp | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > LIMITS.maxUrlRegexLength
  )
    return null;
  try {
    return new RegExp(value);
  } catch {
    return null;
  }
}

export function isValidUrlRegex(value: unknown): value is string {
  return typeof value === "string" && compileUrlRegex(value) !== null;
}

export interface RedirectDestinationIssue {
  readonly code: string;
  readonly message: string;
}

function skipBalancedGroup(source: string, start: number): number {
  let depth = 0;
  let index = start;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return length;
}

function countCapturingGroups(urlRegex: string): number {
  let count = 0;
  let index = 0;
  const length = urlRegex.length;
  while (index < length) {
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

export function validateRedirectDestination(
  destination: string,
  urlRegex: string,
): readonly RedirectDestinationIssue[] {
  const issues: RedirectDestinationIssue[] = [];
  if (typeof destination !== "string" || destination.length === 0) {
    return [
      {
        code: "schema.required",
        message: "Redirect destination must be a non-empty string.",
      },
    ];
  }
  if (destination.length > LIMITS.maxRedirectDestinationLength) {
    return [
      {
        code: "schema.out-of-range",
        message: `Redirect destination must be at most ${LIMITS.maxRedirectDestinationLength} characters.`,
      },
    ];
  }
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return [
      {
        code: "schema.invalid-format",
        message: "Redirect destination must be an absolute URL.",
      },
    ];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return [
      {
        code: "schema.invalid-value",
        message: "Redirect destination must use the http or https scheme.",
      },
    ];
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return [
      {
        code: "schema.invalid-value",
        message: "Redirect destination must not contain credentials.",
      },
    ];
  }
  if (url.hostname.length === 0 || url.hostname.includes("*")) {
    return [
      {
        code: "schema.invalid-format",
        message: "Redirect destination must have a valid host.",
      },
    ];
  }
  const groups = countCapturingGroups(urlRegex);
  const backreference = /\\([1-9])/g;
  let match = backreference.exec(destination);
  while (match !== null) {
    const referenced = Number(match[1]);
    if (referenced > groups) {
      issues.push({
        code: "schema.invalid-value",
        message: `Redirect destination references capture group ${referenced} but the URL pattern defines ${groups}.`,
      });
    }
    match = backreference.exec(destination);
  }
  return issues;
}

export interface ValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export type ProjectValidationResult =
  | { valid: true; data: RogatioProject }
  | { valid: false; errors: ValidationIssue[] };

function issue(instancePath: string, keyword: string): ValidationIssue {
  return { instancePath, keyword, message: "invalid project data", params: {} };
}

function hasUniqueItems(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

const PROJECT_KEYS = ["version", "name", "description", "groups"] as const;
const GROUP_KEYS = ["id", "name", "origins", "rules"] as const;
const RULE_KEYS = [
  "id",
  "name",
  "urlRegex",
  "origins",
  "resourceTypes",
  "priority",
  "method",
  "type",
  "redirect",
] as const;

export function validateProjectDetailed(
  value: unknown,
): ProjectValidationResult {
  const snapshot = snapshotOwnData(value);
  if (!snapshot.valid || !isRecord(snapshot.value))
    return { valid: false, errors: [issue("", "ownProperties")] };
  const project = snapshot.value;
  const errors: ValidationIssue[] = [];
  if (!hasOnlyKeys(project, PROJECT_KEYS))
    errors.push(issue("", "unknown-property"));
  if (project.version !== PROJECT_VERSION)
    errors.push(issue("/version", "invalid-value"));
  if (
    typeof project.name !== "string" ||
    project.name.length === 0 ||
    project.name.length > LIMITS.maxLabelLength ||
    !/\S/u.test(project.name)
  )
    errors.push(issue("/name", "invalid-value"));
  if (
    project.description !== undefined &&
    (typeof project.description !== "string" ||
      project.description.length > LIMITS.maxDescriptionLength)
  )
    errors.push(issue("/description", "invalid-value"));
  if (
    !Array.isArray(project.groups) ||
    project.groups.length > LIMITS.maxGroups
  )
    return { valid: false, errors: [...errors, issue("/groups", "required")] };
  const ids = new Set<string>();
  let ruleCount = 0;
  for (
    let groupIndex = 0;
    groupIndex < project.groups.length;
    groupIndex += 1
  ) {
    const group = project.groups[groupIndex];
    const groupPath = `/groups/${groupIndex}`;
    if (!isRecord(group)) {
      errors.push(issue(groupPath, "invalid-structure"));
      continue;
    }
    if (!hasOnlyKeys(group, GROUP_KEYS))
      errors.push(issue(groupPath, "unknown-property"));
    if (
      typeof group.id !== "string" ||
      group.id.length === 0 ||
      group.id.length > LIMITS.maxIdLength ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(group.id)
    )
      errors.push(issue(`${groupPath}/id`, "invalid-value"));
    if (typeof group.id === "string" && ids.has(group.id))
      errors.push(issue(`${groupPath}/id`, "duplicate-id"));
    if (typeof group.id === "string") ids.add(group.id);
    if (
      typeof group.name !== "string" ||
      group.name.length === 0 ||
      group.name.length > LIMITS.maxLabelLength ||
      !/\S/u.test(group.name)
    )
      errors.push(issue(`${groupPath}/name`, "invalid-value"));
    if (
      !Array.isArray(group.origins) ||
      group.origins.length > LIMITS.maxOriginsPerScope ||
      !hasUniqueItems(group.origins) ||
      group.origins.some((item) => origin(item) === null)
    )
      errors.push(issue(`${groupPath}/origins`, "invalid-format"));
    if (
      !Array.isArray(group.rules) ||
      group.rules.length > LIMITS.maxRulesPerGroup
    ) {
      errors.push(issue(`${groupPath}/rules`, "invalid-structure"));
      continue;
    }
    for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
      const rule = group.rules[ruleIndex];
      const rulePath = `${groupPath}/rules/${ruleIndex}`;
      ruleCount += 1;
      if (!isRecord(rule)) {
        errors.push(issue(rulePath, "invalid-structure"));
        continue;
      }
      if (!hasOnlyKeys(rule, RULE_KEYS))
        errors.push(issue(rulePath, "unknown-property"));
      if (
        typeof rule.id !== "string" ||
        rule.id.length === 0 ||
        rule.id.length > LIMITS.maxIdLength ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(rule.id)
      )
        errors.push(issue(`${rulePath}/id`, "invalid-value"));
      if (typeof rule.id === "string" && ids.has(rule.id))
        errors.push(issue(`${rulePath}/id`, "duplicate-id"));
      if (typeof rule.id === "string") ids.add(rule.id);
      if (
        typeof rule.name !== "string" ||
        rule.name.length === 0 ||
        rule.name.length > LIMITS.maxLabelLength ||
        !/\S/u.test(rule.name)
      )
        errors.push(issue(`${rulePath}/name`, "invalid-value"));
      if (!isValidUrlRegex(rule.urlRegex))
        errors.push(issue(`${rulePath}/urlRegex`, "invalid-format"));
      if (
        !Array.isArray(rule.origins) ||
        rule.origins.length > LIMITS.maxOriginsPerScope ||
        !hasUniqueItems(rule.origins) ||
        rule.origins.some((item) => origin(item) === null)
      )
        errors.push(issue(`${rulePath}/origins`, "invalid-format"));
      if (
        !Array.isArray(rule.resourceTypes) ||
        rule.resourceTypes.length === 0 ||
        rule.resourceTypes.length > LIMITS.maxResourceTypesPerRule ||
        !hasUniqueItems(rule.resourceTypes) ||
        rule.resourceTypes.some(
          (item) => !RESOURCE_TYPES.includes(item as ResourceType),
        )
      )
        errors.push(issue(`${rulePath}/resourceTypes`, "invalid-value"));
      if (
        typeof rule.priority !== "number" ||
        !Number.isSafeInteger(rule.priority) ||
        rule.priority < LIMITS.minPriority ||
        rule.priority > LIMITS.maxPriority
      )
        errors.push(issue(`${rulePath}/priority`, "out-of-range"));
      if (
        rule.method !== undefined &&
        !HTTP_METHODS.includes(rule.method as HttpMethod)
      )
        errors.push(issue(`${rulePath}/method`, "invalid-value"));
      if (rule.type !== undefined && rule.type !== "redirect")
        errors.push(issue(`${rulePath}/type`, "invalid-value"));
      if (rule.type === "redirect") {
        const redirect = (rule as Record<string, unknown>).redirect;
        const destination =
          redirect !== null &&
          typeof redirect === "object" &&
          typeof (redirect as Record<string, unknown>).destination === "string"
            ? ((redirect as Record<string, unknown>).destination as string)
            : undefined;
        if (destination === undefined) {
          errors.push(issue(`${rulePath}/redirect/destination`, "required"));
        } else {
          for (const destIssue of validateRedirectDestination(
            destination,
            typeof rule.urlRegex === "string" ? rule.urlRegex : "",
          )) {
            errors.push({
              instancePath: `${rulePath}/redirect/destination`,
              keyword: destIssue.code,
              message: destIssue.message,
              params: {},
            });
          }
        }
      }
      const effective = [
        ...(Array.isArray(group.origins) ? group.origins : []),
        ...(Array.isArray(rule.origins) ? rule.origins : []),
      ].some((item) => origin(item) !== null);
      if (!effective)
        errors.push(issue(`${rulePath}/origins`, "no-effective-origin"));
    }
  }
  if (ruleCount > LIMITS.maxRulesPerProject)
    errors.push(issue("/groups", "rule-limit"));
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, data: snapshot.value as unknown as RogatioProject };
}

export function validateProject(value: unknown): value is RogatioProject {
  return validateProjectDetailed(value).valid;
}

export function assertValidProject(value: unknown): RogatioProject {
  const result = validateProjectDetailed(value);
  if (!result.valid) throw new Error("schema.invalid-project");
  return result.data;
}

export class ProjectValidationError extends Error {}
