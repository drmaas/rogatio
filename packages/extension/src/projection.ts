import type {
  HeaderOperation,
  MatcherOperation,
  NormalizedMatcher,
  QueryOperation,
  RedirectOperation,
  ResponseBodyOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import {
  type DnrQueryTransform,
  queryActionToDNR,
  validateMatcherShape,
} from "@rogatio/compiler";
import { extensionDiagnostic } from "./diagnostics.js";
import { projectSourceCondition } from "./source-projection.js";

export interface DnrRule {
  readonly id: number;
  readonly priority: number;
  readonly condition: {
    readonly regexFilter: string;
    readonly resourceTypes: readonly string[];
    readonly requestMethods?: readonly string[];
    readonly requestDomains?: readonly string[];
  };
  readonly action: {
    readonly type: "redirect";
    readonly redirect: {
      readonly destination?: string;
      readonly transform?: {
        readonly queryTransform: DnrQueryTransform;
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

function copyMatcher(matcher: NormalizedMatcher): NormalizedMatcher {
  return {
    source: { ...matcher.source },
    resourceTypes: [...matcher.resourceTypes],
    priority: matcher.priority,
    ...(matcher.method !== undefined ? { method: matcher.method } : {}),
  };
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

function isResponseBodyOperation(
  value: unknown,
): value is ResponseBodyOperation {
  if (!isRecord(value) || value.kind !== "response-body") return false;
  if (typeof value.groupId !== "string" || typeof value.ruleId !== "string")
    return false;
  if (!validateMatcherShape(value.matcher)) return false;
  const responseBody = value.responseBody;
  if (!isRecord(responseBody)) return false;
  if (responseBody.mode === "replace")
    return typeof responseBody.body === "string";
  return Array.isArray(responseBody.replacements);
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

function buildDnrRule(
  operation: RedirectOperation | QueryOperation,
  index: number,
): DnrRule | undefined {
  const matcher = copyMatcher(operation.matcher);
  const projection = projectSourceCondition(matcher);
  if (!projection.projectable) return undefined;
  const base = {
    id: 1_000_001 + index,
    priority: matcher.priority,
    condition: {
      regexFilter: projection.condition.regexFilter,
      resourceTypes: matcher.resourceTypes,
      ...(matcher.method !== undefined
        ? { requestMethods: [matcher.method] as readonly string[] }
        : {}),
      ...(projection.condition.requestDomains !== undefined
        ? { requestDomains: projection.condition.requestDomains }
        : {}),
    },
  };
  if (operation.kind === "redirect") {
    return {
      ...base,
      action: {
        type: "redirect",
        redirect: { destination: operation.redirect.destination },
      },
    };
  }
  return {
    ...base,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: queryActionToDNR(operation.action),
        },
      },
    },
  };
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
      matcher = copyMatcher(operation.matcher);
      installable = false;
    } else if (isRedirectOperation(operation)) {
      matcher = copyMatcher(operation.matcher);
      dnrRule = buildDnrRule(operation, index);
      installable = dnrRule !== undefined;
    } else if (isResponseBodyOperation(operation)) {
      matcher = copyMatcher(operation.matcher);
      installable = projectSourceCondition(matcher).projectable;
    } else if (isQueryOperation(operation)) {
      matcher = copyMatcher(operation.matcher);
      dnrRule = buildDnrRule(operation, index);
      installable = dnrRule !== undefined;
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
    if (!projectSourceCondition(operation.matcher).projectable) {
      continue;
    }
    result.push({
      id: 2_000_001 + index,
      groupId: operation.groupId,
      ruleId: operation.ruleId,
      matcher: copyMatcher(operation.matcher),
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
