import type {
  HeaderOperation,
  MatcherOperation,
  MockOperation,
  NormalizedMatcher,
  QueryOperation,
  RedirectOperation,
  ResponseBodyOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { queryParamsToDNR, validateMatcherShape } from "@rogatio/compiler";
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

export interface HeaderProjection {
  readonly id: number;
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
  readonly action: {
    readonly direction: "request" | "response";
    readonly operation: "set" | "append" | "remove";
    readonly headerName: string;
    readonly headerValue?: string;
  };
  readonly installable: true;
}

export type InstallableProjection = HeaderProjection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMatcherOperation(value: unknown): value is MatcherOperation {
  if (!isRecord(value) || value.kind !== "matcher") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  return true;
}

function isRedirectOperation(value: unknown): value is RedirectOperation {
  if (!isRecord(value) || value.kind !== "redirect") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  const redirect = value.redirect;
  return isRecord(redirect) && typeof redirect.destination === "string";
}

function isMockOperation(value: unknown): value is MockOperation {
  if (!isRecord(value) || value.kind !== "mock") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  return isRecord(value.mock) && typeof value.mock.status === "number";
}

function isResponseBodyOperation(
  value: unknown,
): value is ResponseBodyOperation {
  if (!isRecord(value) || value.kind !== "response-body") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  return (
    isRecord(value.responseBody) &&
    Array.isArray(value.responseBody.replacements)
  );
}

function isQueryOperation(value: unknown): value is QueryOperation {
  if (!isRecord(value) || value.kind !== "query") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  const action = value.action;
  return (
    isRecord(action) &&
    action.type === "query" &&
    Array.isArray(action.params) &&
    action.params.length > 0
  );
}

function isHeaderOperation(value: unknown): value is HeaderOperation {
  if (!isRecord(value) || value.kind !== "header") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  const header = value.header;
  if (!isRecord(header)) return false;
  if (header.direction !== "request" && header.direction !== "response")
    return false;
  if (
    header.operation !== "set" &&
    header.operation !== "append" &&
    header.operation !== "remove"
  )
    return false;
  if (typeof header.name !== "string" || header.name.length === 0) return false;
  if (
    (header.operation === "set" || header.operation === "append") &&
    typeof header.value !== "string"
  )
    return false;
  if (header.operation === "remove" && header.value !== undefined) return false;
  return true;
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
    } else if (isResponseBodyOperation(operation)) {
      matcher = {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      };
      installable = true;
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
    } else if (isMockOperation(operation)) {
      // Mock rules are installable, but their DNR redirect target depends on the
      // runtime connection info, so no dnrRule is emitted at projection time.
      matcher = {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      };
      installable = true;
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

export function projectHeaders(
  operations: readonly HeaderOperation[],
): readonly HeaderProjection[] {
  const result: HeaderProjection[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation: unknown = operations[index];
    if (!isHeaderOperation(operation)) {
      throw new Error(extensionDiagnostic("extension.invalid-operation").code);
    }
    result.push({
      id: 2_000_001 + index,
      groupId: operation.groupId,
      ruleId: operation.ruleId,
      matcher: {
        urlRegex: { ...operation.matcher.urlRegex },
        origins: [...operation.matcher.origins],
        resourceTypes: [...operation.matcher.resourceTypes],
        priority: operation.matcher.priority,
        ...(operation.matcher.method !== undefined
          ? { method: operation.matcher.method }
          : {}),
      },
      action: {
        direction: operation.header.direction,
        operation: operation.header.operation,
        headerName: operation.header.name,
        headerValue: operation.header.value,
      },
      installable: true,
    });
  }
  return result;
}
