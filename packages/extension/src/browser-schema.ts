import type {
  HeaderDirection,
  HttpMethod,
  ResourceType,
  RogatioProject,
} from "@rogatio/schema";

const FORBIDDEN_REQUEST_HEADERS = Object.freeze([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

const FORBIDDEN_RESPONSE_HEADERS = Object.freeze([
  "connection",
  "content-encoding",
  "content-length",
  "date",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

const FORBIDDEN_REQUEST_PREFIXES = Object.freeze(["proxy-", "sec-"]);

function isForbiddenHeader(name: string, direction: HeaderDirection): boolean {
  const normalized = name.toLowerCase();
  const forbidden =
    direction === "request"
      ? FORBIDDEN_REQUEST_HEADERS
      : FORBIDDEN_RESPONSE_HEADERS;

  return (
    forbidden.includes(normalized as never) ||
    (direction === "request" &&
      FORBIDDEN_REQUEST_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      ))
  );
}

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
  maxQueryParamsPerRule: 64,
  maxQueryNameLength: 256,
  maxQueryValueLength: 2048,
  maxHeaderNameLength: 256,
  maxHeaderValueLength: 4096,
  maxHeadersPerRule: 1,
  maxRequestBodyBytes: 4 * 1024 * 1024,
  maxRequestBodyPatternLength: 2048,
  maxRequestBodyReplacementLength: 4096,
  maxRequestBodyOperations: 32,
  maxLocalOrigins: 32,
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

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) return true;
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      if (i === 0) return true;
      const prev = value.charCodeAt(i - 1);
      if (prev < 0xd800 || prev > 0xdbff) return true;
    }
  }
  return false;
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
    parsed.hostname.endsWith(".") ||
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

const PROJECT_KEYS = [
  "version",
  "name",
  "description",
  "groups",
  "requestBodyPolicy",
] as const;
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
  "action",
  "headerDirection",
  "headerOperation",
  "headerName",
  "headerValue",
  "mock",
  "responseBody",
  "requestBody",
] as const;

const QUERY_ACTION_KEYS = ["type", "params"] as const;
const QUERY_PARAM_KEYS = ["name", "value"] as const;
const REQUEST_BODY_REPLACE_KEYS = ["mode", "body"] as const;
const REQUEST_BODY_REGEX_KEYS = ["mode", "pattern", "replacement"] as const;

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
  if (
    typeof value.value !== "string" ||
    value.value.length === 0 ||
    value.value.length > LIMITS.maxQueryValueLength
  )
    errors.push(issue(`${path}/value`, "invalid-value"));
}

function validateQueryAction(
  errors: ValidationIssue[],
  value: unknown,
  path: string,
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
  }
}

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
      if (
        rule.type !== undefined &&
        rule.type !== "redirect" &&
        rule.type !== "query" &&
        rule.type !== "header" &&
        rule.type !== "mock" &&
        rule.type !== "response-body" &&
        rule.type !== "request-body"
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
      if (rule.action !== undefined)
        validateQueryAction(errors, rule.action, `${rulePath}/action`);
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
          }
        }
        if (operation === "remove" && headerValue !== undefined) {
          errors.push(issue(`${rulePath}/headerValue`, "unexpected"));
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
      const effective = [
        ...(Array.isArray(group.origins) ? group.origins : []),
        ...(Array.isArray(rule.origins) ? rule.origins : []),
      ].some((item) => origin(item) !== null);
      if (!effective)
        errors.push(issue(`${rulePath}/origins`, "no-effective-origin"));
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
          const normalized = origin(originValue);
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
