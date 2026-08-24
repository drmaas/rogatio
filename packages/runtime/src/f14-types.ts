import type { RogatioOperation } from "@rogatio/compiler";
import type { HttpMethod, ResourceType, RogatioProject } from "@rogatio/schema";

export const F14_PROTOCOL = "f14-v1" as const;

/** Maximum serialized envelope size in bytes (spec REQ-009). */
export const F14_ENVELOPE_MAX_BYTES = 64 * 1024;

/** Maximum distinct PAC origins per generated script (spec REQ-027). */
export const F14_MAX_PAC_ORIGINS = 256;

/** Maximum concurrent body transforms (spec REQ-013). */
export const F14_MAX_CONCURRENT_TRANSFORMS = 32;

/** Revalidation interval in milliseconds (spec REQ-024). */
export const F14_REVALIDATION_INTERVAL_MS = 5_000;

export type NativeRuntimeState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "unsupported";

export type AuthorityDenyReason =
  | "project-invalid"
  | "operation-unknown"
  | "project-inconsistent"
  | "url-mismatch"
  | "target-unauthorized"
  | "initiator-unauthorized"
  | "method-mismatch"
  | "resource-type-unauthorized";

export interface F14RevalidationRequest {
  readonly groupId: string;
  readonly ruleId: string;
  readonly url: string;
  readonly method?: string;
  readonly resourceType?: string;
  readonly initiator?: string;
  readonly target?: string;
}

export interface AuthorityDecisionAllowed {
  readonly allowed: true;
  readonly groupId: string;
  readonly ruleId: string;
  readonly operation: RogatioOperation;
}

export interface AuthorityDecisionDenied {
  readonly allowed: false;
  readonly reason: AuthorityDenyReason;
}

export type AuthorityDecision =
  | AuthorityDecisionAllowed
  | AuthorityDecisionDenied;

export type F14EnvelopeMessageType =
  | "runtime.start"
  | "runtime.stop"
  | "runtime.status"
  | "authority.grant"
  | "authority.revoke"
  | "transform.request"
  | "transform.result";

export interface F14Envelope {
  readonly protocol: typeof F14_PROTOCOL;
  readonly type: F14EnvelopeMessageType;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface F14EnvelopeInput {
  readonly type: F14EnvelopeMessageType;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly metadata: Record<string, unknown>;
}

export type { HttpMethod, ResourceType, RogatioOperation, RogatioProject };
