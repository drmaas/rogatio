import type {
  MatcherOperation,
  NormalizedMatcher,
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { queryParamsToDNR } from "@rogatio/compiler";
import {
  compileUrlRegex,
  HTTP_METHODS,
  LIMITS,
  normalizeSiteOrigin,
  RESOURCE_TYPES,
} from "./browser-schema.js";
import { extensionDiagnostic } from "./diagnostics.js";

export interface DnrRule {
  readonly id: number;
  readonly priority: number;
  readonly condition: {
    readonly regexFilter: string;
    readonly resourceTypes: readonly string[];
    readonly requestMethods?: readonly string[];
    readonly requestDomains?: readonly string[];
    readonly initiatorDomains?: readonly string[];
  };
  readonly action: {
    readonly type: "redirect";
    readonly redirect: {
      readonly destination?: string;
      readonly transform?: {
        readonly query: {
          readonly addOrReplaceParams: readonly {
            readonly name: string;
            readonly value: string;
            readonly replaceOnly: false;
          }[];
        };
      };
    };
  };
}

export interface RuleProjection {
  readonly id: number;
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly installable: boolean;
  readonly dnrRule?: DnrRule;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMatcherOperation(value: unknown): value is MatcherOperation {
  if (!isRecord(value) || value.kind !== "matcher") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  const matcher = value.matcher;
  if (!isRecord(matcher) || !isRecord(matcher.urlRegex)) return false;
  if (
    typeof matcher.urlRegex.source !== "string" ||
    matcher.urlRegex.flags !== "" ||
    compileUrlRegex(matcher.urlRegex.source) === null ||
    !Array.isArray(matcher.origins) ||
    !matcher.origins.every(
      (origin) =>
        typeof origin === "string" && normalizeSiteOrigin(origin) !== null,
    ) ||
    !Array.isArray(matcher.resourceTypes) ||
    !matcher.resourceTypes.every((type) =>
      RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]),
    ) ||
    typeof matcher.priority !== "number" ||
    !Number.isSafeInteger(matcher.priority) ||
    matcher.priority < LIMITS.minPriority ||
    matcher.priority > LIMITS.maxPriority
  )
    return false;
  if (
    matcher.method !== undefined &&
    !HTTP_METHODS.includes(matcher.method as (typeof HTTP_METHODS)[number])
  )
    return false;
  return true;
}

function isRedirectOperation(value: unknown): value is RedirectOperation {
  if (!isRecord(value) || value.kind !== "redirect") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  const matcher = value.matcher;
  if (!isRecord(matcher) || !isRecord(matcher.urlRegex)) return false;
  if (
    typeof matcher.urlRegex.source !== "string" ||
    matcher.urlRegex.flags !== "" ||
    compileUrlRegex(matcher.urlRegex.source) === null ||
    !Array.isArray(matcher.origins) ||
    !matcher.origins.every(
      (origin) =>
        typeof origin === "string" && normalizeSiteOrigin(origin) !== null,
    ) ||
    !Array.isArray(matcher.resourceTypes) ||
    !matcher.resourceTypes.every((type) =>
      RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]),
    ) ||
    typeof matcher.priority !== "number" ||
    !Number.isSafeInteger(matcher.priority) ||
    matcher.priority < LIMITS.minPriority ||
    matcher.priority > LIMITS.maxPriority
  )
    return false;
  if (
    matcher.method !== undefined &&
    !HTTP_METHODS.includes(matcher.method as (typeof HTTP_METHODS)[number])
  )
    return false;
  const redirect = value.redirect;
  return isRecord(redirect) && typeof redirect.destination === "string";
}

function isQueryOperation(value: unknown): value is QueryOperation {
  if (!isRecord(value) || value.kind !== "query") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  const matcher = value.matcher;
  if (!isRecord(matcher) || !isRecord(matcher.urlRegex)) return false;
  if (
    typeof matcher.urlRegex.source !== "string" ||
    matcher.urlRegex.flags !== "" ||
    compileUrlRegex(matcher.urlRegex.source) === null ||
    !Array.isArray(matcher.origins) ||
    !matcher.origins.every(
      (origin) =>
        typeof origin === "string" && normalizeSiteOrigin(origin) !== null,
    ) ||
    !Array.isArray(matcher.resourceTypes) ||
    !matcher.resourceTypes.every((type) =>
      RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]),
    ) ||
    typeof matcher.priority !== "number" ||
    !Number.isSafeInteger(matcher.priority) ||
    matcher.priority < LIMITS.minPriority ||
    matcher.priority > LIMITS.maxPriority
  )
    return false;
  if (
    matcher.method !== undefined &&
    !HTTP_METHODS.includes(matcher.method as (typeof HTTP_METHODS)[number])
  )
    return false;
  const action = value.action;
  return (
    isRecord(action) &&
    action.type === "query" &&
    Array.isArray(action.params) &&
    action.params.length > 0
  );
}

export function projectMatchers(
  operations: readonly RogatioOperation[],
): readonly RuleProjection[] {
  const result: RuleProjection[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation: unknown = operations[index];
    let matcher: NormalizedMatcher;
    let installable = false;
    let dnrRule: DnrRule | undefined;

    if (isMatcherOperation(operation)) {
      matcher = {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      };
      installable = false;
    } else if (isRedirectOperation(operation)) {
      matcher = {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      };
      const hostnames = matcher.origins.map((origin) =>
        origin.replace(/^https?:\/\//, ""),
      );
      installable = true;
      dnrRule = {
        id: 1_000_001 + index,
        priority: matcher.priority,
        condition: {
          regexFilter: matcher.urlRegex.source,
          resourceTypes: matcher.resourceTypes,
          ...(matcher.method !== undefined
            ? { requestMethods: [matcher.method] }
            : {}),
          requestDomains: hostnames,
          initiatorDomains: hostnames,
        },
        action: {
          type: "redirect",
          redirect: {
            destination: operation.redirect.destination,
          },
        },
      };
    } else if (isQueryOperation(operation)) {
      matcher = {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      };
      const hostnames = matcher.origins.map((origin) =>
        origin.replace(/^https?:\/\//, ""),
      );
      installable = true;
      dnrRule = {
        id: 1_000_001 + index,
        priority: matcher.priority,
        condition: {
          regexFilter: matcher.urlRegex.source,
          resourceTypes: matcher.resourceTypes,
          ...(matcher.method !== undefined
            ? { requestMethods: [matcher.method] }
            : {}),
          requestDomains: hostnames,
          initiatorDomains: hostnames,
        },
        action: {
          type: "redirect",
          redirect: {
            transform: {
              query: {
                addOrReplaceParams: queryParamsToDNR(operation.action),
              },
            },
          },
        },
      };
    } else {
      throw new Error(extensionDiagnostic("extension.invalid-operation").code);
    }

    result.push({
      id: 1_000_001 + index,
      groupId: operation.groupId,
      ruleId: operation.ruleId,
      matcher,
      installable,
      ...(dnrRule !== undefined ? { dnrRule } : {}),
    });
  }
  return result;
}
