import { sameOrigin, sourceMatches } from "./source-match.js";
import type { NormalizedMatcher, RogatioOperation } from "./types.js";

export interface RuleMatchContext {
  readonly url: string;
  readonly target: string;
  readonly method: string;
  readonly initiator: string;
  readonly resourceType: string;
  readonly phase: "request" | "response";
}

export type WinnerResult =
  | {
      readonly kind: "winner";
      readonly operation: RogatioOperation;
      readonly sourceOrder: number;
    }
  | {
      readonly kind: "none";
    };

function resourceTypeMatches(
  resourceTypes: readonly string[],
  resourceType: string,
): boolean {
  return resourceTypes.includes(resourceType);
}

function methodMatches(
  method: NormalizedMatcher["method"],
  requestMethod: string,
): boolean {
  return method === undefined || method === requestMethod;
}

function isCandidate(
  op: RogatioOperation,
  enabledGroupIds: readonly string[],
  context: RuleMatchContext,
): boolean {
  if (!enabledGroupIds.includes(op.groupId)) return false;

  const matcher = op.matcher;
  if (!sourceMatches(matcher.source, context.url)) return false;
  if (!sameOrigin(context.url, context.target)) return false;
  if (!methodMatches(matcher.method, context.method)) return false;
  if (!resourceTypeMatches(matcher.resourceTypes, context.resourceType))
    return false;

  if (context.phase === "request") {
    if (
      op.kind === "response-body" ||
      op.kind === "redirect" ||
      op.kind === "query" ||
      op.kind === "header" ||
      op.kind === "request-body"
    ) {
      return true;
    }
    return op.kind === "matcher";
  }
  return op.kind === "response-body";
}

function getSourceOrder(
  op: RogatioOperation,
  operations: readonly RogatioOperation[],
): number {
  const index = operations.findIndex(
    (o) => o.groupId === op.groupId && o.ruleId === op.ruleId,
  );
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export function selectWinningOperation(
  operations: readonly RogatioOperation[],
  enabledGroupIds: readonly string[],
  context: RuleMatchContext,
): WinnerResult {
  const candidates = operations.filter((op) =>
    isCandidate(op, enabledGroupIds, context),
  );

  if (candidates.length === 0) {
    return { kind: "none" };
  }

  const sorted = candidates.sort((a, b) => {
    const priorityDiff = b.matcher.priority - a.matcher.priority;
    if (priorityDiff !== 0) return priorityDiff;

    const orderA = getSourceOrder(a, operations);
    const orderB = getSourceOrder(b, operations);
    return orderA - orderB;
  });

  const winner = sorted[0];
  return {
    kind: "winner",
    operation: winner,
    sourceOrder: getSourceOrder(winner, operations),
  };
}
