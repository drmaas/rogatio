import type {
  HeaderDirection,
  HttpMethod,
  ResourceType,
  RogatioProject,
} from "@rogatio/schema";
import { validateRedirectDestination } from "../../schema/src/browser-validation.js";
import {
  containsUrlCaptureReference,
  validateCaptureTemplate,
} from "../../schema/src/captures.js";
import { hasControl } from "../../schema/src/control.js";
import { isForbiddenHeader } from "../../schema/src/headers.js";
import { normalizeNameKey } from "../../schema/src/identity.js";
import { LIMITS } from "../../schema/src/limits.js";
import { normalizeSiteOrigin } from "../../schema/src/origins.js";
import { isValidMockLogicalPath } from "../../schema/src/path.js";
import { isValidUrlRegex } from "../../schema/src/regex.js";
import {
  HTTP_METHODS,
  PROJECT_VERSION,
  RESOURCE_TYPES,
} from "../../schema/src/types.js";
import { hasLoneSurrogate } from "../../schema/src/utf16.js";

// These helpers live canonically in @rogatio/schema. The extension build aliases the
// bare "@rogatio/schema" specifier to this file, so we re-export the real
// implementations via relative imports (which bypass the alias).
export type { RedirectDestinationIssue } from "../../schema/src/browser-validation.js";
export {
  countCapturingGroups,
  validateRedirectDestination,
} from "../../schema/src/browser-validation.js";
export { safeClone } from "../../schema/src/clone.js";
export { hasControl } from "../../schema/src/control.js";
export { formatSha256, isSha256Digest } from "../../schema/src/digest.js";
export {
  FORBIDDEN_REQUEST_HEADERS,
  FORBIDDEN_RESPONSE_HEADERS,
  isForbiddenHeader,
} from "../../schema/src/headers.js";
export {
  deriveEntityId,
  type EntityKind,
  normalizeNameKey,
  uniqueName,
} from "../../schema/src/identity.js";
export { LIMITS } from "../../schema/src/limits.js";
export { migrateV1Project } from "../../schema/src/migrate-v1.js";
export { isSiteOrigin, normalizeSiteOrigin } from "../../schema/src/origins.js";
export { compileUrlRegex, isValidUrlRegex } from "../../schema/src/regex.js";
export {
  HTTP_METHODS,
  PROJECT_VERSION,
  RESOURCE_TYPES,
} from "../../schema/src/types.js";
export { containsUrlCaptureReference, hasLoneSurrogate };

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

const PROJECT_KEYS = [
  "version",
  "name",
  "description",
  "groups",
  "requestBodyPolicy",
] as const;
const GROUP_KEYS = ["id", "name", "rules"] as const;
const SOURCE_KEYS = ["key", "operator", "value"] as const;
const RULE_KEYS = [
  "id",
  "name",
  "source",
  "resourceTypes",
  "priority",
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
  "mock",
  "redactSensitiveInLogs",
] as const;

const MOCK_ACTION_KEYS = [
  "status",
  "headers",
  "delayMs",
  "body",
  "file",
] as const;
const MOCK_HEADER_KEYS = ["name", "value"] as const;

const QUERY_ACTION_KEYS = ["type", "params"] as const;
const QUERY_PARAM_KEYS = ["name", "operation", "value"] as const;
const REQUEST_BODY_REPLACE_KEYS = ["mode", "body"] as const;
const REQUEST_BODY_REGEX_KEYS = ["mode", "pattern", "replacement"] as const;
const RESPONSE_BODY_REPLACE_KEYS = ["mode", "body"] as const;
const RESPONSE_BODY_REGEX_KEYS = ["mode", "replacements"] as const;
const RESPONSE_BODY_UNTAGGED_REGEX_KEYS = ["replacements"] as const;
const RESPONSE_BODY_REPLACEMENT_KEYS = ["pattern", "replacement"] as const;

function validateQueryParam(
  errors: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (!isRecord(value) || !hasOnlyKeys(value, QUERY_PARAM_KEYS)) {
    errors.push(issue(path, "invalid-structure"));
    return;
  }
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > LIMITS.maxQueryNameLength
  )
    errors.push(issue(`${path}/name`, "invalid-value"));

  const operation = value.operation === undefined ? "set" : value.operation;
  if (operation !== "set" && operation !== "remove") {
    errors.push(issue(`${path}/operation`, "invalid-value"));
    return;
  }

  if (operation === "set") {
    if (
      typeof value.value !== "string" ||
      value.value.length === 0 ||
      value.value.length > LIMITS.maxQueryValueLength
    ) {
      errors.push(issue(`${path}/value`, "invalid-value"));
    }
    return;
  }

  if (value.value !== undefined) {
    errors.push(issue(`${path}/value`, "unexpected"));
  }
}

function sourcePattern(rule: JsonRecord): string {
  const source = rule.source;
  return isRecord(source) && typeof source.value === "string"
    ? source.value
    : "";
}

function validateSource(
  errors: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (!isRecord(value) || !hasOnlyKeys(value, SOURCE_KEYS)) {
    errors.push(issue(path, "invalid-structure"));
    return;
  }
  if (value.key !== "url" && value.key !== "host") {
    errors.push(issue(`${path}/key`, "invalid-value"));
  }
  if (value.operator !== "regex") {
    errors.push(issue(`${path}/operator`, "invalid-value"));
  }
  if (!isValidUrlRegex(value.value)) {
    errors.push(issue(`${path}/value`, "invalid-format"));
  }
}

function addCaptureIssues(
  errors: ValidationIssue[],
  value: string,
  sourceValue: string,
  path: string,
): void {
  for (const capture of validateCaptureTemplate(value, sourceValue)) {
    errors.push({
      instancePath: path,
      keyword: `capture-${capture.code}`,
      message: capture.message,
      params: {
        offset: capture.offset,
        groups: capture.groups,
        ...(capture.referenced === undefined
          ? {}
          : { referenced: capture.referenced }),
      },
    });
  }
}

function pushSchemaIssue(
  errors: ValidationIssue[],
  instancePath: string,
  keyword: string,
  message: string,
  params: Record<string, unknown> = {},
): void {
  errors.push({ instancePath, keyword, message, params });
}

function validateMockHeaderStructure(
  errors: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (!isRecord(value)) {
    pushSchemaIssue(errors, path, "type", "must be object", { type: "object" });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!MOCK_HEADER_KEYS.includes(key as (typeof MOCK_HEADER_KEYS)[number])) {
      pushSchemaIssue(
        errors,
        path,
        "additionalProperties",
        "must NOT have additional properties",
        { additionalProperty: key },
      );
    }
  }
  if (typeof value.name !== "string") {
    pushSchemaIssue(
      errors,
      `${path}/name`,
      "required",
      "must have required property 'name'",
      { missingProperty: "name" },
    );
  } else if (value.name.length === 0) {
    pushSchemaIssue(
      errors,
      `${path}/name`,
      "minLength",
      "must NOT have fewer than 1 characters",
      { limit: 1 },
    );
  } else if (value.name.length > LIMITS.maxMockHeaderNameLength) {
    pushSchemaIssue(
      errors,
      `${path}/name`,
      "maxLength",
      `must NOT have more than ${LIMITS.maxMockHeaderNameLength} characters`,
      { limit: LIMITS.maxMockHeaderNameLength },
    );
  }
  if (typeof value.value !== "string") {
    pushSchemaIssue(
      errors,
      `${path}/value`,
      "required",
      "must have required property 'value'",
      { missingProperty: "value" },
    );
  } else if (value.value.length > LIMITS.maxMockHeaderValueLength) {
    pushSchemaIssue(
      errors,
      `${path}/value`,
      "maxLength",
      `must NOT have more than ${LIMITS.maxMockHeaderValueLength} characters`,
      { limit: LIMITS.maxMockHeaderValueLength },
    );
  }
}

function validateMockStructure(
  errors: ValidationIssue[],
  value: unknown,
  mockPath: string,
): void {
  if (!isRecord(value)) {
    pushSchemaIssue(errors, mockPath, "type", "must be object", {
      type: "object",
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!MOCK_ACTION_KEYS.includes(key as (typeof MOCK_ACTION_KEYS)[number])) {
      pushSchemaIssue(
        errors,
        mockPath,
        "additionalProperties",
        "must NOT have additional properties",
        { additionalProperty: key },
      );
    }
  }
  if (!("status" in value) || value.status === undefined) {
    pushSchemaIssue(
      errors,
      `${mockPath}/status`,
      "required",
      "must have required property 'status'",
      { missingProperty: "status" },
    );
  } else if (
    typeof value.status !== "number" ||
    !Number.isInteger(value.status)
  ) {
    pushSchemaIssue(errors, `${mockPath}/status`, "type", "must be integer", {
      type: "integer",
    });
  } else if (value.status < LIMITS.minMockStatus) {
    pushSchemaIssue(
      errors,
      `${mockPath}/status`,
      "minimum",
      `must be >= ${LIMITS.minMockStatus}`,
      { comparison: ">=", limit: LIMITS.minMockStatus },
    );
  } else if (value.status > LIMITS.maxMockStatus) {
    pushSchemaIssue(
      errors,
      `${mockPath}/status`,
      "maximum",
      `must be <= ${LIMITS.maxMockStatus}`,
      { comparison: "<=", limit: LIMITS.maxMockStatus },
    );
  }

  if (value.headers !== undefined) {
    const headersPath = `${mockPath}/headers`;
    if (!Array.isArray(value.headers)) {
      pushSchemaIssue(errors, headersPath, "type", "must be array", {
        type: "array",
      });
    } else {
      if (value.headers.length > LIMITS.maxMockHeadersPerRule) {
        pushSchemaIssue(
          errors,
          headersPath,
          "maxItems",
          `must NOT have more than ${LIMITS.maxMockHeadersPerRule} items`,
          { limit: LIMITS.maxMockHeadersPerRule },
        );
      }
      for (let index = 0; index < value.headers.length; index += 1) {
        validateMockHeaderStructure(
          errors,
          value.headers[index],
          `${headersPath}/${index}`,
        );
      }
    }
  }

  if (value.delayMs !== undefined) {
    const delayPath = `${mockPath}/delayMs`;
    if (typeof value.delayMs !== "number" || !Number.isInteger(value.delayMs)) {
      pushSchemaIssue(errors, delayPath, "type", "must be integer", {
        type: "integer",
      });
    } else if (value.delayMs < 0) {
      pushSchemaIssue(errors, delayPath, "minimum", "must be >= 0", {
        comparison: ">=",
        limit: 0,
      });
    } else if (value.delayMs > LIMITS.maxMockDelayMs) {
      pushSchemaIssue(
        errors,
        delayPath,
        "maximum",
        `must be <= ${LIMITS.maxMockDelayMs}`,
        { comparison: "<=", limit: LIMITS.maxMockDelayMs },
      );
    }
  }

  if (value.body !== undefined && typeof value.body !== "string") {
    pushSchemaIssue(errors, `${mockPath}/body`, "type", "must be string", {
      type: "string",
    });
  } else if (
    typeof value.body === "string" &&
    value.body.length > LIMITS.maxMockInlineBodyLength
  ) {
    pushSchemaIssue(
      errors,
      `${mockPath}/body`,
      "maxLength",
      `must NOT have more than ${LIMITS.maxMockInlineBodyLength} characters`,
      { limit: LIMITS.maxMockInlineBodyLength },
    );
  }

  if (value.file !== undefined && typeof value.file !== "string") {
    pushSchemaIssue(errors, `${mockPath}/file`, "type", "must be string", {
      type: "string",
    });
  } else if (typeof value.file === "string") {
    if (value.file.length === 0) {
      pushSchemaIssue(
        errors,
        `${mockPath}/file`,
        "minLength",
        "must NOT have fewer than 1 characters",
        { limit: 1 },
      );
    } else if (value.file.length > LIMITS.maxMockFilePathLength) {
      pushSchemaIssue(
        errors,
        `${mockPath}/file`,
        "maxLength",
        `must NOT have more than ${LIMITS.maxMockFilePathLength} characters`,
        { limit: LIMITS.maxMockFilePathLength },
      );
    }
  }
}

function validateMockSemantic(
  errors: ValidationIssue[],
  mock: {
    status: number;
    body?: unknown;
    file?: unknown;
    headers?: { name: string; value: string }[];
  },
  mockPath: string,
): void {
  const forbiddenMockStatuses = new Set([204, 205, 304]);
  if (forbiddenMockStatuses.has(mock.status)) {
    pushSchemaIssue(
      errors,
      `${mockPath}/status`,
      "mock-status",
      "Mock status must not be 204, 205, or 304 because those responses require special body handling.",
      { status: mock.status },
    );
  }

  const bodySet = mock.body !== undefined;
  const fileSet = mock.file !== undefined;
  if (bodySet === fileSet) {
    pushSchemaIssue(
      errors,
      mockPath,
      "mock-body-source",
      "Mock rules require exactly one of body or file.",
      {},
    );
  } else if (
    fileSet &&
    typeof mock.file === "string" &&
    !isValidMockLogicalPath(mock.file)
  ) {
    pushSchemaIssue(
      errors,
      `${mockPath}/file`,
      "mock-file-path",
      "Mock file must be a relative logical path without absolute segments, backslashes, percent escapes, control characters, dot segments, colons, or glob characters.",
      {},
    );
  }

  if (mock.headers !== undefined) {
    const seenHeaderNames = new Set<string>();
    for (let index = 0; index < mock.headers.length; index += 1) {
      const header = mock.headers[index];
      if (header === undefined) continue;
      const namePath = `${mockPath}/headers/${index}/name`;
      const valuePath = `${mockPath}/headers/${index}/value`;
      if (hasControl(header.name)) {
        pushSchemaIssue(
          errors,
          namePath,
          "mock-header-control",
          "Mock header names must not contain control characters.",
          {},
        );
      }
      if (hasControl(header.value)) {
        pushSchemaIssue(
          errors,
          valuePath,
          "mock-header-control",
          "Mock header values must not contain control characters.",
          {},
        );
      }
      const comparableName = header.name.trim();
      if (isForbiddenHeader(comparableName, "response")) {
        pushSchemaIssue(
          errors,
          namePath,
          "forbiddenHeader",
          `Header "${header.name}" is forbidden for response headers.`,
          {
            headerName: header.name,
            headerDirection: "response",
          },
        );
      }
      const normalizedName = comparableName.toLowerCase();
      if (seenHeaderNames.has(normalizedName)) {
        pushSchemaIssue(
          errors,
          namePath,
          "uniqueMockHeaderName",
          `mock header name must be unique; duplicate "${header.name}"`,
          { name: header.name },
        );
      } else {
        seenHeaderNames.add(normalizedName);
      }
    }
  }
}

function validateQueryAction(
  errors: ValidationIssue[],
  value: unknown,
  path: string,
  sourceValue: string,
): void {
  if (!isRecord(value) || !hasOnlyKeys(value, QUERY_ACTION_KEYS)) {
    errors.push(issue(path, "invalid-structure"));
    return;
  }
  if (value.type !== "query") {
    errors.push(issue(`${path}/type`, "invalid-value"));
    return;
  }
  if (
    !Array.isArray(value.params) ||
    value.params.length < 1 ||
    value.params.length > LIMITS.maxQueryParamsPerRule
  ) {
    errors.push(issue(`${path}/params`, "invalid-value"));
    return;
  }
  const seenNames = new Set<string>();
  for (let index = 0; index < value.params.length; index += 1) {
    const param = value.params[index];
    if (isRecord(param) && typeof param.name === "string") {
      if (seenNames.has(param.name))
        errors.push(
          issue(`${path}/params/${index}/name`, "uniqueQueryParamName"),
        );
      else seenNames.add(param.name);
    }
    validateQueryParam(errors, param, `${path}/params/${index}`);
    if (
      isRecord(param) &&
      (param.operation === undefined || param.operation === "set") &&
      typeof param.value === "string"
    ) {
      addCaptureIssues(
        errors,
        param.value,
        sourceValue,
        `${path}/params/${index}/value`,
      );
    }
  }
}

export function validateProjectDetailed(
  value: unknown,
): ProjectValidationResult {
  const snapshot = snapshotOwnData(value);
  if (!snapshot.valid || !isRecord(snapshot.value))
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
  // Name uniqueness is per project across groups and rules together, keyed by
  // the normalized name. It is separate from `ids` so a duplicate name is
  // reported independently of whether the two entities also share an id.
  const names = new Map<string, string>();
  const claimName = (name: unknown, namePath: string): void => {
    // An absent or empty name is already reported as invalid; a duplicate error
    // on top of it would be two errors for one defect.
    if (typeof name !== "string" || name.length === 0) return;
    const key = normalizeNameKey(name);
    const previous = names.get(key);
    if (previous === undefined) {
      names.set(key, namePath);
      return;
    }
    errors.push({
      ...issue(namePath, "duplicate-name"),
      params: { previousPath: previous },
    });
  };
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
    claimName(group.name, `${groupPath}/name`);
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
      if (!hasOnlyKeys(rule, RULE_KEYS)) {
        // Mock rules mirror Ajv's per-key `additionalProperties` diagnostics
        // for parity. Every other rule keeps the established
        // `unknown-property` diagnostic so existing output stays stable.
        if (rule.type === "mock" || Object.hasOwn(rule, "mock")) {
          for (const key of Object.keys(rule)) {
            if (!RULE_KEYS.includes(key as (typeof RULE_KEYS)[number])) {
              pushSchemaIssue(
                errors,
                rulePath,
                "additionalProperties",
                "must NOT have additional properties",
                { additionalProperty: key },
              );
            }
          }
        } else {
          errors.push(issue(rulePath, "unknown-property"));
        }
      }
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
      claimName(rule.name, `${rulePath}/name`);
      validateSource(errors, rule.source, `${rulePath}/source`);
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
      if (
        rule.redactSensitiveInLogs !== undefined &&
        typeof rule.redactSensitiveInLogs !== "boolean"
      )
        errors.push(
          issue(`${rulePath}/redactSensitiveInLogs`, "invalid-value"),
        );
      if (
        rule.type !== undefined &&
        rule.type !== "redirect" &&
        rule.type !== "query" &&
        rule.type !== "header" &&
        rule.type !== "response-body" &&
        rule.type !== "request-body" &&
        rule.type !== "mock"
      )
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
          const pattern = sourcePattern(rule);
          for (const destIssue of validateRedirectDestination(
            destination,
            pattern,
          )) {
            errors.push({
              instancePath: `${rulePath}/redirect/destination`,
              keyword: destIssue.code,
              message: destIssue.message,
              params: {},
            });
          }
          addCaptureIssues(
            errors,
            destination,
            pattern,
            `${rulePath}/redirect/destination`,
          );
        }
      }
      if (rule.action !== undefined)
        validateQueryAction(
          errors,
          rule.action,
          `${rulePath}/action`,
          sourcePattern(rule),
        );
      if (rule.type === "header") {
        const direction = (rule as Record<string, unknown>).headerDirection;
        const operation = (rule as Record<string, unknown>).headerOperation;
        const headerName = (rule as Record<string, unknown>).headerName;
        const headerValue = (rule as Record<string, unknown>).headerValue;
        if (direction !== "request" && direction !== "response") {
          errors.push(issue(`${rulePath}/direction`, "invalid-value"));
        }
        if (
          operation !== "set" &&
          operation !== "append" &&
          operation !== "remove"
        ) {
          errors.push(issue(`${rulePath}/operation`, "invalid-value"));
        }
        if (
          typeof headerName !== "string" ||
          headerName.length === 0 ||
          headerName.length > LIMITS.maxHeaderNameLength
        ) {
          errors.push(issue(`${rulePath}/headerName`, "out-of-range"));
        }
        if (
          typeof headerName === "string" &&
          direction !== undefined &&
          isForbiddenHeader(headerName, direction as HeaderDirection)
        ) {
          errors.push(issue(`${rulePath}/headerName`, "forbidden"));
        }
        if (operation === "set" || operation === "append") {
          if (
            typeof headerValue !== "string" ||
            headerValue.length > LIMITS.maxHeaderValueLength
          ) {
            errors.push(issue(`${rulePath}/headerValue`, "out-of-range"));
          } else {
            addCaptureIssues(
              errors,
              headerValue,
              sourcePattern(rule),
              `${rulePath}/headerValue`,
            );
          }
        }
        if (operation === "remove" && headerValue !== undefined) {
          errors.push(issue(`${rulePath}/headerValue`, "unexpected"));
        }
      }
      if (rule.type === "response-body") {
        const action = rule.responseBody as {
          mode?: string;
          body?: unknown;
          replacements?: unknown;
        };
        const actionPath = `${rulePath}/responseBody`;
        if (!action || typeof action !== "object") {
          errors.push(issue(actionPath, "response-body-action"));
        } else if (
          !hasOnlyKeys(action as JsonRecord, RESPONSE_BODY_REPLACE_KEYS) &&
          !hasOnlyKeys(action as JsonRecord, RESPONSE_BODY_REGEX_KEYS) &&
          !hasOnlyKeys(action as JsonRecord, RESPONSE_BODY_UNTAGGED_REGEX_KEYS)
        ) {
          errors.push(issue(actionPath, "response-body-unknown-property"));
        } else if (action.mode === "replace") {
          const body = action.body;
          if (typeof body !== "string") {
            errors.push(
              issue(`${actionPath}/body`, "response-body-replace-body"),
            );
          } else if (body.length > LIMITS.maxResponseBodyBytes) {
            errors.push(
              issue(`${actionPath}/body`, "response-body-replace-body"),
            );
          } else if (hasLoneSurrogate(body)) {
            errors.push(
              issue(`${actionPath}/body`, "response-body-lone-surrogate"),
            );
          } else {
            addCaptureIssues(
              errors,
              body,
              sourcePattern(rule),
              `${actionPath}/body`,
            );
          }
        } else {
          const replacements = action.replacements;
          if (
            !Array.isArray(replacements) ||
            replacements.length === 0 ||
            replacements.length > LIMITS.maxResponseBodyReplacements
          ) {
            errors.push(
              issue(`${actionPath}/replacements`, "response-body-replacements"),
            );
          } else {
            for (let index = 0; index < replacements.length; index += 1) {
              const entry = replacements[index];
              if (
                !isRecord(entry) ||
                !hasOnlyKeys(entry, RESPONSE_BODY_REPLACEMENT_KEYS)
              ) {
                errors.push(
                  issue(
                    `${actionPath}/replacements/${index}`,
                    "response-body-replacement",
                  ),
                );
                continue;
              }
              const pattern = entry.pattern;
              const replacement = entry.replacement;
              if (typeof pattern !== "string" || pattern.length === 0) {
                errors.push(
                  issue(
                    `${actionPath}/replacements/${index}/pattern`,
                    "response-body-pattern",
                  ),
                );
              } else if (pattern.length > LIMITS.maxResponseBodyPatternLength) {
                errors.push(
                  issue(
                    `${actionPath}/replacements/${index}/pattern`,
                    "response-body-pattern",
                  ),
                );
              } else if (!isValidUrlRegex(pattern)) {
                errors.push(
                  issue(
                    `${actionPath}/replacements/${index}/pattern`,
                    "response-body-pattern",
                  ),
                );
              }
              if (
                typeof replacement !== "string" ||
                replacement.length > LIMITS.maxResponseBodyReplacementLength
              ) {
                errors.push(
                  issue(
                    `${actionPath}/replacements/${index}/replacement`,
                    "response-body-replacement",
                  ),
                );
              }
            }
          }
        }
      }
      if (rule.type === "request-body") {
        const action = rule.requestBody as {
          mode?: string;
          body?: unknown;
          pattern?: unknown;
          replacement?: unknown;
        };
        const actionPath = `${rulePath}/requestBody`;
        if (!action || typeof action !== "object") {
          errors.push(issue(actionPath, "request-body-action"));
        } else if (
          !hasOnlyKeys(action as JsonRecord, REQUEST_BODY_REPLACE_KEYS) &&
          !hasOnlyKeys(action as JsonRecord, REQUEST_BODY_REGEX_KEYS)
        ) {
          errors.push(issue(actionPath, "request-body-unknown-property"));
        } else {
          const mode = action.mode;
          if (mode !== "replace" && mode !== "regex") {
            errors.push(issue(`${actionPath}/mode`, "request-body-mode"));
          }
          if (mode === "replace") {
            const body = action.body;
            if (typeof body !== "string") {
              errors.push(
                issue(`${actionPath}/body`, "request-body-replace-body"),
              );
            } else if (body.length > LIMITS.maxRequestBodyBytes) {
              errors.push(
                issue(`${actionPath}/body`, "request-body-replace-body"),
              );
            } else if (hasLoneSurrogate(body)) {
              errors.push(
                issue(`${actionPath}/body`, "request-body-lone-surrogate"),
              );
            } else {
              addCaptureIssues(
                errors,
                body,
                sourcePattern(rule),
                `${actionPath}/body`,
              );
            }
          }
          if (mode === "regex") {
            const pattern = action.pattern;
            const replacement = action.replacement;
            if (typeof pattern !== "string" || pattern.length === 0) {
              errors.push(
                issue(`${actionPath}/pattern`, "request-body-pattern"),
              );
            } else if (pattern.length > LIMITS.maxRequestBodyPatternLength) {
              errors.push(
                issue(`${actionPath}/pattern`, "request-body-pattern"),
              );
            } else if (!isValidUrlRegex(pattern)) {
              errors.push(
                issue(`${actionPath}/pattern`, "request-body-pattern"),
              );
            } else if (hasLoneSurrogate(pattern)) {
              errors.push(
                issue(`${actionPath}/pattern`, "request-body-lone-surrogate"),
              );
            }
            if (
              typeof replacement !== "string" ||
              replacement.length > LIMITS.maxRequestBodyReplacementLength
            ) {
              errors.push(
                issue(`${actionPath}/replacement`, "request-body-replacement"),
              );
            } else if (hasLoneSurrogate(replacement)) {
              errors.push(
                issue(
                  `${actionPath}/replacement`,
                  "request-body-lone-surrogate",
                ),
              );
            }
          }
        }
        if (
          rule.method !== "POST" &&
          rule.method !== "PUT" &&
          rule.method !== "PATCH"
        ) {
          errors.push(issue(`${rulePath}/method`, "request-body-method"));
        }
        const resourceTypes = rule.resourceTypes;
        if (
          !Array.isArray(resourceTypes) ||
          resourceTypes.length !== 1 ||
          resourceTypes[0] !== "xmlhttprequest"
        ) {
          errors.push(
            issue(`${rulePath}/resourceTypes`, "request-body-resource-types"),
          );
        }
      }
      if (rule.type === "mock") {
        const mock = (rule as Record<string, unknown>).mock;
        const mockPath = `${rulePath}/mock`;
        if (mock === undefined) {
          pushSchemaIssue(
            errors,
            mockPath,
            "required",
            "must have required property 'mock'",
            { missingProperty: "mock" },
          );
          pushSchemaIssue(errors, rulePath, "if", 'must match "then" schema', {
            failingKeyword: "then",
          });
        } else {
          const beforeMock = errors.length;
          validateMockStructure(errors, mock, mockPath);
          if (
            errors.length === beforeMock &&
            isRecord(mock) &&
            typeof mock.status === "number" &&
            Number.isInteger(mock.status)
          ) {
            validateMockSemantic(
              errors,
              mock as {
                status: number;
                body?: unknown;
                file?: unknown;
                headers?: { name: string; value: string }[];
              },
              mockPath,
            );
          }
        }
      }
    }
  }
  if (project.requestBodyPolicy != null) {
    const rawPolicy = project.requestBodyPolicy as { localOrigins?: unknown };
    if (typeof rawPolicy.localOrigins !== "undefined") {
      if (!Array.isArray(rawPolicy.localOrigins)) {
        errors.push(
          issue(
            "/requestBodyPolicy/localOrigins",
            "request-body-policy-local-origins",
          ),
        );
      } else {
        const seen = new Set<string>();
        for (let i = 0; i < rawPolicy.localOrigins.length; i += 1) {
          const originValue = rawPolicy.localOrigins[i];
          if (typeof originValue !== "string") {
            errors.push(
              issue(
                `/requestBodyPolicy/localOrigins/${i}`,
                "request-body-policy-local-origin",
              ),
            );
            continue;
          }
          const normalized = normalizeSiteOrigin(originValue);
          if (normalized === null) {
            errors.push(
              issue(
                `/requestBodyPolicy/localOrigins/${i}`,
                "request-body-policy-local-origin",
              ),
            );
          } else if (seen.has(normalized)) {
            errors.push(
              issue(
                `/requestBodyPolicy/localOrigins/${i}`,
                "request-body-policy-local-origin",
              ),
            );
          } else {
            seen.add(normalized);
          }
        }
        if (rawPolicy.localOrigins.length > LIMITS.maxLocalOrigins) {
          errors.push(
            issue(
              "/requestBodyPolicy/localOrigins",
              "request-body-policy-local-origins",
            ),
          );
        }
      }
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

export {
  matchUrlCaptures,
  substituteUrlCaptures,
} from "../../schema/src/captures.js";
