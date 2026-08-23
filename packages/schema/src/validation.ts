import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { LIMITS } from "./limits.js";
import { isSiteOrigin, normalizeSiteOrigin } from "./origins.js";
import { compileUrlRegex } from "./regex.js";
import { projectSchema } from "./schema.js";
import type { RogatioProject } from "./types.js";

export interface ValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export type ProjectValidationResult =
  | { valid: true; data: RogatioProject }
  | { valid: false; errors: ValidationIssue[] };

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  ownProperties: true,
  // The redirect `then` clause requires `redirect` via `if/then` while the
  // property is declared on the enclosing rule, which strictRequired forbids.
  strictRequired: false,
});

ajv.addFormat("rogatio-origin", {
  type: "string",
  validate: isSiteOrigin,
});
ajv.addFormat("rogatio-url-regex", {
  type: "string",
  validate: (value: string) => compileUrlRegex(value) !== null,
});

function ajvIssues(
  errors: ErrorObject[] | null | undefined,
): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "validation failed",
    params: error.params,
  }));
}

type SnapshotResult = { valid: true; value: unknown } | { valid: false };

function snapshotOwnData(
  value: unknown,
  ancestors = new WeakSet<object>(),
): SnapshotResult {
  if (value === null || typeof value !== "object") {
    return { valid: true, value };
  }
  if (ancestors.has(value)) return { valid: false };

  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return { valid: false };
    }

    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > LIMITS.maxRulesPerProject
      ) {
        return { valid: false };
      }

      const length = lengthDescriptor.value;
      for (const propertyName of Object.getOwnPropertyNames(value)) {
        if (propertyName === "length") continue;
        const index = Number(propertyName);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= length ||
          String(index) !== propertyName
        ) {
          return { valid: false };
        }
      }

      const snapshot: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          return { valid: false };
        }
        const child = snapshotOwnData(descriptor.value, ancestors);
        if (!child.valid) return child;
        snapshot[index] = child.value;
      }
      return { valid: true, value: snapshot };
    }

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return { valid: false };
      }
      const child = snapshotOwnData(descriptor.value, ancestors);
      if (!child.valid) return child;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: child.value,
        writable: true,
      });
    }
    return { valid: true, value: snapshot };
  } catch {
    return { valid: false };
  } finally {
    ancestors.delete(value);
  }
}

const compiledProjectValidator: ValidateFunction<RogatioProject> =
  ajv.compile(projectSchema);
const ownArrayEntriesError: ErrorObject = {
  instancePath: "",
  keyword: "ownProperties",
  message: "must contain only own array entries",
  params: {},
  schemaPath: "",
};
const guardedProjectValidator = Object.assign(
  (value: unknown): value is RogatioProject => {
    const snapshot = snapshotOwnData(value);
    if (!snapshot.valid) {
      guardedProjectValidator.errors = [ownArrayEntriesError];
      return false;
    }

    const valid = compiledProjectValidator(snapshot.value);
    guardedProjectValidator.errors = compiledProjectValidator.errors ?? null;
    return valid;
  },
  {
    errors: null as ErrorObject[] | null,
    schema: compiledProjectValidator.schema,
    schemaEnv: compiledProjectValidator.schemaEnv,
  },
);

export const projectValidator: ValidateFunction<RogatioProject> =
  guardedProjectValidator;

function semanticIssues(project: RogatioProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, string>();
  let ruleCount = 0;

  for (
    let groupIndex = 0;
    groupIndex < project.groups.length;
    groupIndex += 1
  ) {
    const group = project.groups[groupIndex];
    const groupPath = `/groups/${groupIndex}`;
    const existingGroup = ids.get(group.id);
    if (existingGroup) {
      issues.push({
        instancePath: `${groupPath}/id`,
        keyword: "uniqueId",
        message: `must be unique; already used at ${existingGroup}`,
        params: { previousPath: existingGroup },
      });
    } else {
      ids.set(group.id, `${groupPath}/id`);
    }

    for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
      const rule = group.rules[ruleIndex];
      ruleCount += 1;
      const rulePath = `${groupPath}/rules/${ruleIndex}`;
      const existingRule = ids.get(rule.id);
      if (existingRule) {
        issues.push({
          instancePath: `${rulePath}/id`,
          keyword: "uniqueId",
          message: `must be unique; already used at ${existingRule}`,
          params: { previousPath: existingRule },
        });
      } else {
        ids.set(rule.id, `${rulePath}/id`);
      }

      if (rule.type !== undefined && rule.type !== "redirect") {
        issues.push({
          instancePath: `${rulePath}/type`,
          keyword: "enum",
          message: 'must be "redirect"',
          params: { allowedValue: "redirect" },
        });
      }

      if (rule.type === "redirect") {
        const destination =
          rule.redirect !== undefined ? rule.redirect.destination : undefined;
        if (rule.redirect === undefined || typeof destination !== "string") {
          issues.push({
            instancePath: `${rulePath}/redirect/destination`,
            keyword: "required",
            message: "Redirect rules require a destination string.",
            params: {},
          });
        } else {
          for (const issue of validateRedirectDestination(
            destination,
            rule.urlRegex,
          )) {
            issues.push({
              instancePath: `${rulePath}/redirect/destination`,
              keyword: issue.code,
              message: issue.message,
              params: {},
            });
          }
        }
      }

      const effectiveOrigins = new Set<string>();
      for (
        let originIndex = 0;
        originIndex < group.origins.length;
        originIndex += 1
      ) {
        const origin = normalizeSiteOrigin(group.origins[originIndex]);
        if (origin !== null) effectiveOrigins.add(origin);
      }
      for (
        let originIndex = 0;
        originIndex < rule.origins.length;
        originIndex += 1
      ) {
        const origin = normalizeSiteOrigin(rule.origins[originIndex]);
        if (origin !== null) effectiveOrigins.add(origin);
      }
      if (effectiveOrigins.size === 0) {
        issues.push({
          instancePath: `${rulePath}/origins`,
          keyword: "effectiveOrigin",
          message:
            "must combine with group origins to contain at least one origin",
          params: {},
        });
      }

      const action = rule.action;
      if (action && action.type === "query") {
        const seenNames = new Set<string>();
        for (let p = 0; p < action.params.length; p += 1) {
          const param = action.params[p];
          if (!param) continue;
          const paramName = param.name;
          if (seenNames.has(paramName)) {
            issues.push({
              instancePath: `${rulePath}/action/params/${p}/name`,
              keyword: "uniqueQueryParamName",
              message: `query param name must be unique; duplicate "${paramName}"`,
              params: { name: paramName },
            });
          } else {
            seenNames.add(paramName);
          }
        }
      }
    }
  }

  if (ruleCount > LIMITS.maxRulesPerProject) {
    issues.push({
      instancePath: "/groups",
      keyword: "maxRulesPerProject",
      message: `must contain at most ${LIMITS.maxRulesPerProject} rules in total`,
      params: { limit: LIMITS.maxRulesPerProject, actual: ruleCount },
    });
  }

  return issues;
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

export function countCapturingGroups(urlRegex: string): number {
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
        // Non-capturing: (?:...), (?=...), (?!...), (?<=...), (?<!...),
        // and named (?<name>...). All are excluded from the capture count.
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
    issues.push({
      code: "schema.required",
      message: "Redirect destination must be a non-empty string.",
    });
    return issues;
  }
  if (destination.length > LIMITS.maxRedirectDestinationLength) {
    issues.push({
      code: "schema.out-of-range",
      message: `Redirect destination must be at most ${LIMITS.maxRedirectDestinationLength} characters.`,
    });
    return issues;
  }
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    issues.push({
      code: "schema.invalid-format",
      message: "Redirect destination must be an absolute URL.",
    });
    return issues;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    issues.push({
      code: "schema.invalid-value",
      message: "Redirect destination must use the http or https scheme.",
    });
    return issues;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    issues.push({
      code: "schema.invalid-value",
      message: "Redirect destination must not contain credentials.",
    });
    return issues;
  }
  if (url.hostname.length === 0 || url.hostname.includes("*")) {
    issues.push({
      code: "schema.invalid-format",
      message: "Redirect destination must have a valid host.",
    });
    return issues;
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

export function validateProjectDetailed(
  value: unknown,
): ProjectValidationResult {
  const snapshot = snapshotOwnData(value);
  if (!snapshot.valid) {
    return {
      valid: false,
      errors: [
        {
          instancePath: "",
          keyword: "ownProperties",
          message: "must contain only own array entries",
          params: {},
        },
      ],
    };
  }

  if (!projectValidator(snapshot.value)) {
    return { valid: false, errors: ajvIssues(projectValidator.errors) };
  }

  const errors = semanticIssues(snapshot.value as RogatioProject);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, data: value as RogatioProject };
}

export function validateProject(value: unknown): value is RogatioProject {
  return validateProjectDetailed(value).valid;
}

export class ProjectValidationError extends Error {
  readonly errors: ValidationIssue[];

  constructor(errors: ValidationIssue[]) {
    super("Rogatio project validation failed");
    this.name = "ProjectValidationError";
    this.errors = errors;
  }
}

export function assertValidProject(value: unknown): RogatioProject {
  const result = validateProjectDetailed(value);
  if (!result.valid) throw new ProjectValidationError(result.errors);
  return result.data;
}
