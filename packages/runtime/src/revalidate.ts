import type { RogatioOperation } from "@rogatio/compiler";
import { sameOrigin } from "@rogatio/compiler";
import { normalizeSiteOrigin, type ResourceType } from "@rogatio/schema";
import { sourceMatchesWithinDeadline } from "./deadline-match.js";
import { snapshotOwnData } from "./snapshot.js";
import type {
  AuthorityDecision,
  RevalidationRequest,
  RogatioProject,
} from "./types.js";

function originOf(value: string): string | null {
  const direct = normalizeSiteOrigin(value);
  if (direct !== null) return direct;
  try {
    return normalizeSiteOrigin(new URL(value).origin);
  } catch {
    return null;
  }
}

function isHttpOrigin(origin: string): boolean {
  return origin.startsWith("http://") || origin.startsWith("https://");
}

function projectHasRule(
  project: RogatioProject,
  groupId: string,
  ruleId: string,
): boolean {
  if (!Array.isArray(project.groups)) return false;
  const group = project.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined || !Array.isArray(group.rules)) return false;
  return group.rules.some((rule) => rule.id === ruleId);
}

function isBodyOperation(operation: RogatioOperation): boolean {
  return (
    operation.kind === "request-body" || operation.kind === "response-body"
  );
}

/**
 * Re-derive request authority from the canonical project plus the compiled
 * operations. Never reads a browser-supplied grant boolean (spec REQ-014..REQ-023).
 */
export async function revalidateAuthority(
  project: unknown,
  operations: readonly RogatioOperation[],
  request: RevalidationRequest,
): Promise<AuthorityDecision> {
  const projectSnap = snapshotOwnData(project);
  if (!projectSnap.valid) return { allowed: false, reason: "project-invalid" };
  const opsSnap = snapshotOwnData(operations);
  if (!opsSnap.valid) return { allowed: false, reason: "project-invalid" };
  const reqSnap = snapshotOwnData(request);
  if (!reqSnap.valid) return { allowed: false, reason: "project-invalid" };

  const operation = operations.find(
    (candidate) =>
      candidate.groupId === request.groupId &&
      candidate.ruleId === request.ruleId &&
      "matcher" in candidate,
  );
  if (operation === undefined || !("matcher" in operation)) {
    return { allowed: false, reason: "operation-unknown" };
  }

  if (
    !projectHasRule(
      projectSnap.value as RogatioProject,
      request.groupId,
      request.ruleId,
    )
  ) {
    return { allowed: false, reason: "project-inconsistent" };
  }

  const matcher = operation.matcher;
  if (!(await sourceMatchesWithinDeadline(matcher.source, request.url))) {
    return { allowed: false, reason: "url-mismatch" };
  }

  const requestOrigin = originOf(request.url);
  const targetUrl = request.target ?? request.url;
  const targetOrigin = originOf(targetUrl);
  if (
    requestOrigin === null ||
    targetOrigin === null ||
    !sameOrigin(request.url, targetUrl)
  ) {
    return { allowed: false, reason: "target-unauthorized" };
  }

  if (isBodyOperation(operation)) {
    if (request.initiator === undefined) {
      return { allowed: false, reason: "initiator-unauthorized" };
    }
    const initiatorOrigin = originOf(request.initiator);
    if (initiatorOrigin === null || !isHttpOrigin(initiatorOrigin)) {
      return { allowed: false, reason: "initiator-unauthorized" };
    }
  }

  if (matcher.method !== undefined) {
    const method =
      typeof request.method === "string"
        ? request.method.toUpperCase()
        : undefined;
    if (method !== matcher.method) {
      return { allowed: false, reason: "method-mismatch" };
    }
  }

  if (matcher.resourceTypes.length > 0) {
    // The response-body listener omits resourceType. That HTTP entry point
    // has none of its own, and copying the rule's resourceTypes would make
    // this comparison agree with the rule. A supplied type still has to be
    // one of the rule's types. Other operations still require one.
    const supplied = request.resourceType;
    if (supplied === undefined) {
      if (operation.kind !== "response-body") {
        return { allowed: false, reason: "resource-type-unauthorized" };
      }
    } else if (
      typeof supplied !== "string" ||
      !matcher.resourceTypes.includes(supplied as ResourceType)
    ) {
      return { allowed: false, reason: "resource-type-unauthorized" };
    }
  }

  return {
    allowed: true,
    groupId: request.groupId,
    ruleId: request.ruleId,
    operation,
  };
}
