import { createHash } from "node:crypto";
import { failure } from "./errors.js";
import {
  addPolicyPart,
  commitPolicyStage,
  createPolicyStageState,
  NATIVE_POLICY_MAX_BYTES,
  NATIVE_POLICY_MAX_FRAMES,
  type PolicyStageState,
} from "./native-framing.js";
import type { RuntimeResult } from "./types.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isProjectStageType(type: string): boolean {
  return (
    type === "policy-begin" ||
    type === "policy-part" ||
    type === "policy-commit"
  );
}

export function beginProjectStage(frame: {
  readonly totalBytes?: number;
  readonly partCount?: number;
  readonly policyDigest?: string;
}): RuntimeResult<PolicyStageState> {
  const { totalBytes, partCount, policyDigest } = frame;
  if (
    typeof totalBytes !== "number" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 1 ||
    totalBytes > NATIVE_POLICY_MAX_BYTES ||
    typeof partCount !== "number" ||
    !Number.isSafeInteger(partCount) ||
    partCount < 1 ||
    partCount > NATIVE_POLICY_MAX_FRAMES ||
    typeof policyDigest !== "string" ||
    !DIGEST_PATTERN.test(policyDigest)
  ) {
    return failure("runtime.project-stage-invalid");
  }
  return {
    ok: true,
    value: createPolicyStageState(totalBytes, partCount, policyDigest),
  };
}

export function acceptProjectPart(
  state: PolicyStageState,
  frame: { readonly index?: number; readonly data?: string },
): RuntimeResult<void> {
  if (
    typeof frame.index !== "number" ||
    !Number.isSafeInteger(frame.index) ||
    typeof frame.data !== "string"
  ) {
    return failure("runtime.project-stage-invalid");
  }
  const bytes = Buffer.from(frame.data, "base64");
  return addPolicyPart(state, frame.index, bytes);
}

export function finishProjectStage(
  state: PolicyStageState,
): RuntimeResult<Uint8Array> {
  const assembled = commitPolicyStage(state);
  if (!assembled.ok) return assembled;
  const digest = `sha256:${createHash("sha256").update(assembled.value).digest("hex")}`;
  if (digest !== state.expectedDigest) {
    return failure("runtime.project-stage-invalid");
  }
  return assembled;
}
