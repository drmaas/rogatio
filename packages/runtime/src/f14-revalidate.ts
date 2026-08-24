import type { RogatioOperation } from "@rogatio/compiler";
import {
  compileUrlRegex,
  normalizeSiteOrigin,
  type ResourceType,
} from "@rogatio/schema";
import type {
  AuthorityDecision,
  F14RevalidationRequest,
  RogatioProject,
} from "./f14-types.js";
import { snapshotOwnData } from "./snapshot.js";

function originOf(value: string): string | null {
  const direct = normalizeSiteOrigin(value);
  if (direct !== null) return direct;
  try {
    return normalizeSiteOrigin(new URL(value).origin);
  } catch {
    return null;
  }
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

/**
 * Re-derive request authority from the canonical project plus the compiled
 * operations. Never reads a browser-supplied grant boolean (spec REQ-014..REQ-023).
 */
export function revalidateAuthority(
  project: unknown,
  operations: readonly RogatioOperation[],
  request: F14RevalidationRequest,
): AuthorityDecision {
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
  const regex = compileUrlRegex(matcher.urlRegex.source);
  if (regex === null || !regex.test(request.url)) {
    return { allowed: false, reason: "url-mismatch" };
  }

  const targetOrigin = request.target
    ? originOf(request.target)
    : originOf(request.url);
  if (targetOrigin === null || !matcher.origins.includes(targetOrigin)) {
    return { allowed: false, reason: "target-unauthorized" };
  }

  if (request.initiator !== undefined) {
    const initiatorOrigin = originOf(request.initiator);
    if (
      initiatorOrigin === null ||
      !matcher.origins.includes(initiatorOrigin)
    ) {
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
    const resourceType =
      typeof request.resourceType === "string"
        ? request.resourceType
        : undefined;
    if (
      resourceType === undefined ||
      !matcher.resourceTypes.includes(resourceType as ResourceType)
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
