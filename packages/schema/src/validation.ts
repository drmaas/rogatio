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
  strict: true,
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

function hasOwnArrayEntries(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== "object") return true;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (
        !Object.hasOwn(value, index) ||
        !hasOwnArrayEntries(value[index], ancestors)
      ) {
        return false;
      }
    }
  } else {
    for (const key of Object.keys(value)) {
      if (
        !hasOwnArrayEntries((value as Record<string, unknown>)[key], ancestors)
      ) {
        return false;
      }
    }
  }

  ancestors.delete(value);
  return true;
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
    if (!hasOwnArrayEntries(value)) {
      guardedProjectValidator.errors = [ownArrayEntriesError];
      return false;
    }

    const valid = compiledProjectValidator(value);
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

export function validateProjectDetailed(
  value: unknown,
): ProjectValidationResult {
  if (!hasOwnArrayEntries(value)) {
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

  if (!projectValidator(value)) {
    return { valid: false, errors: ajvIssues(projectValidator.errors) };
  }

  const errors = semanticIssues(value);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, data: value };
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
