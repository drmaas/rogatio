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

function urlMatches(matcher: NormalizedMatcher, url: string): boolean {
  const regex = new RegExp(matcher.urlRegex.source, matcher.urlRegex.flags);
  return regex.test(url);
}

function originMatches(origins: readonly string[], target: string): boolean {
  try {
    const targetUrl = new URL(target);
    const targetOrigin = targetUrl.origin;
    return origins.includes(targetOrigin);
  } catch {
    return false;
  }
}

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

function _initiatorMatches(
  matcher: NormalizedMatcher,
  initiator: string,
): boolean {
  try {
    const initiatorUrl = new URL(initiator);
    const initiatorOrigin = initiatorUrl.origin;
    return matcher.origins.includes(initiatorOrigin);
  } catch {
    return false;
  }
}

function isCandidate(
  op: RogatioOperation,
  enabledGroupIds: readonly string[],
  grantedOrigins: readonly string[],
  context: RuleMatchContext,
): boolean {
  if (!enabledGroupIds.includes(op.groupId)) return false;

  const matcher = op.matcher;
  const allGranted = matcher.origins.every((origin) =>
    grantedOrigins.includes(origin),
  );
  if (!allGranted) return false;

  if (!urlMatches(matcher, context.url)) return false;
  if (!originMatches(matcher.origins, context.target)) return false;
  if (!methodMatches(matcher.method, context.method)) return false;
  if (!resourceTypeMatches(matcher.resourceTypes, context.resourceType))
    return false;

  if (context.phase === "request") {
    if (
      op.kind === "response-body" ||
      op.kind === "redirect" ||
      op.kind === "query" ||
      op.kind === "header" ||
      op.kind === "mock" ||
      op.kind === "request-body"
    ) {
      return true;
    }
    return op.kind === "matcher";
  } else {
    if (op.kind === "response-body") return true;
    return false;
  }
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
  grantedOrigins: readonly string[],
  context: RuleMatchContext,
): WinnerResult {
  const candidates = operations.filter((op) =>
    isCandidate(op, enabledGroupIds, grantedOrigins, context),
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
