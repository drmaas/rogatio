import {
  LIMITS,
  RESOURCE_TYPES,
  type ResourceType,
  type RogatioProject,
  type RogatioQueryAction,
  type RogatioRule,
  validateProjectDetailed,
} from "@rogatio/schema";
import { invariantDiagnostic, mapValidationIssues } from "./diagnostics.js";
import type {
  CompileResult,
  HeaderOperation,
  MatcherOperation,
  NormalizedMatcher,
  QueryOperation,
  RedirectOperation,
  RequestBodyOperation,
  ResponseBodyOperation,
  RogatioOperation,
} from "./types.js";

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

function canonicalResourceTypes(
  resourceTypes: readonly ResourceType[],
): ResourceType[] {
  const ordered: ResourceType[] = [];
  for (
    let canonicalIndex = 0;
    canonicalIndex < RESOURCE_TYPES.length;
    canonicalIndex += 1
  ) {
    const canonical = RESOURCE_TYPES[canonicalIndex];
    for (
      let sourceIndex = 0;
      sourceIndex < resourceTypes.length;
      sourceIndex += 1
    ) {
      if (resourceTypes[sourceIndex] === canonical) ordered.push(canonical);
    }
  }
  return ordered;
}

function resolveRedactSensitiveInLogs(rule: RogatioRule): boolean {
  return rule.redactSensitiveInLogs === true;
}

function compileMatcher(rule: RogatioRule): NormalizedMatcher {
  const matcher: {
    source: {
      key: "url" | "host";
      operator: "regex";
      value: string;
    };
    resourceTypes: ResourceType[];
    priority: number;
    method?: RogatioRule["method"];
  } = {
    source: {
      key: rule.source.key,
      operator: "regex",
      value: rule.source.value,
    },
    resourceTypes: canonicalResourceTypes(rule.resourceTypes),
    priority: rule.priority,
  };
  if (rule.method !== undefined) matcher.method = rule.method;
  return matcher;
}

function compileOperations(project: RogatioProject): RogatioOperation[] {
  const operations: RogatioOperation[] = [];
  for (
    let groupIndex = 0;
    groupIndex < project.groups.length;
    groupIndex += 1
  ) {
    const group = project.groups[groupIndex];
    for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
      const rule = group.rules[ruleIndex];
      const matcher = compileMatcher(rule);
      const redactSensitiveInLogs = resolveRedactSensitiveInLogs(rule);
      if (rule.type === "redirect") {
        const operation: RedirectOperation = {
          kind: "redirect",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
          redirect: { destination: rule.redirect?.destination ?? "" },
        };
        operations.push(operation);
      } else if (
        rule.type === "query" &&
        rule.action &&
        "type" in rule.action &&
        rule.action.type === "query"
      ) {
        const action = rule.action as RogatioQueryAction;
        const operation: QueryOperation = {
          kind: "query",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
          action,
        };
        operations.push(operation);
      } else if (rule.type === "header") {
        const operation: HeaderOperation = {
          kind: "header",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
          header: {
            direction: rule.headerDirection ?? "request",
            operation: rule.headerOperation ?? "set",
            name: rule.headerName ?? "",
            ...(rule.headerValue !== undefined
              ? { value: rule.headerValue }
              : {}),
          },
        };
        operations.push(operation);
      } else if (rule.type === "response-body") {
        const operation: ResponseBodyOperation = {
          kind: "response-body",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
          responseBody: rule.responseBody ?? { replacements: [] },
        };
        operations.push(operation);
      } else if (rule.type === "request-body") {
        const operation: RequestBodyOperation = {
          kind: "request-body",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
          requestBody: rule.requestBody ?? { mode: "replace", body: "" },
        };
        operations.push(operation);
      } else {
        const operation: MatcherOperation = {
          kind: "matcher",
          groupId: group.id,
          ruleId: rule.id,
          name: rule.name,
          redactSensitiveInLogs,
          matcher,
        };
        operations.push(operation);
      }
    }
  }
  return operations;
}

export function compileProject(value: unknown): CompileResult {
  const snapshot = snapshotOwnData(value);
  if (!snapshot.valid) {
    return {
      ok: false,
      operations: [],
      diagnostics: mapValidationIssues([
        {
          instancePath: "",
          keyword: "ownProperties",
          message: "must contain only own data properties",
          params: {},
        },
      ]),
    };
  }

  let validation: ReturnType<typeof validateProjectDetailed>;
  try {
    validation = validateProjectDetailed(snapshot.value);
  } catch {
    return { ok: false, operations: [], diagnostics: [invariantDiagnostic()] };
  }

  if (!validation.valid) {
    return {
      ok: false,
      operations: [],
      diagnostics: mapValidationIssues(validation.errors),
    };
  }

  try {
    return {
      ok: true,
      operations: compileOperations(validation.data),
      diagnostics: [],
    };
  } catch {
    return {
      ok: false,
      operations: [],
      diagnostics: [invariantDiagnostic()],
    };
  }
}
