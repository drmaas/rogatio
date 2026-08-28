import { failure } from "./errors.js";
import type { RuntimeResult } from "./types.js";

export const NATIVE_FRAME_MAX_BYTES = 64 * 1024;
export const NATIVE_POLICY_MAX_BYTES = 256 * 1024;
export const NATIVE_POLICY_MAX_FRAMES = 32;
export const NATIVE_POLICY_STAGE_TIMEOUT_MS = 5000;

export enum NativeFrameType {
  PolicyBegin = "policy-begin",
  PolicyPart = "policy-part",
  PolicyCommit = "policy-commit",
  RuntimeStart = "runtime.start",
  RuntimeActivate = "runtime.activate",
  RuntimeStop = "runtime.stop",
  RuntimeStatus = "runtime.status",
  RequestPrepare = "request.prepare",
}

export interface NativeFrame {
  readonly protocol: "f17-v1";
  readonly type: NativeFrameType;
  readonly requestId?: string;
  readonly extensionId?: string;
  readonly policyDigest?: string;
  readonly totalBytes?: number;
  readonly partCount?: number;
  readonly index?: number;
  readonly data?: string;
}

export function encodeNativeFrame(frame: NativeFrame): Uint8Array {
  const json = JSON.stringify(frame);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > NATIVE_FRAME_MAX_BYTES) {
    throw new Error("Frame exceeds maximum size");
  }
  const result = new Uint8Array(4 + bytes.byteLength);
  new DataView(result.buffer).setUint32(0, bytes.byteLength, true);
  result.set(bytes, 4);
  return result;
}

export function decodeNativeFrame(
  buffer: Uint8Array,
): RuntimeResult<NativeFrame> {
  if (buffer.byteLength < 4) {
    return failure("runtime.native-frame-too-small");
  }
  const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(
    0,
    true,
  );
  if (length > NATIVE_FRAME_MAX_BYTES) {
    return failure("runtime.native-frame-too-large");
  }
  if (buffer.byteLength !== 4 + length) {
    return failure("runtime.native-frame-length-mismatch");
  }
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.slice(4),
    );
    const frame = JSON.parse(json) as NativeFrame;
    if (frame.protocol !== "f17-v1") {
      return failure("runtime.native-frame-invalid-protocol");
    }
    return { ok: true, value: frame };
  } catch {
    return failure("runtime.native-frame-invalid-json");
  }
}

export interface PolicyStageState {
  readonly totalBytes: number;
  readonly partCount: number;
  readonly receivedParts: Map<number, Uint8Array>;
  readonly expectedDigest: string;
  readonly startTime: number;
}

export function createPolicyStageState(
  totalBytes: number,
  partCount: number,
  expectedDigest: string,
): PolicyStageState {
  return {
    totalBytes,
    partCount,
    receivedParts: new Map(),
    expectedDigest,
    startTime: Date.now(),
  };
}

export function addPolicyPart(
  state: PolicyStageState,
  index: number,
  data: Uint8Array,
): RuntimeResult<void> {
  if (Date.now() - state.startTime > NATIVE_POLICY_STAGE_TIMEOUT_MS) {
    return failure("runtime.request-body-policy-stage-timeout");
  }
  if (index < 0 || index >= state.partCount) {
    return failure("runtime.request-body-policy-invalid-part-index");
  }
  if (state.receivedParts.has(index)) {
    return failure("runtime.request-body-policy-duplicate-part");
  }
  state.receivedParts.set(index, data);
  return { ok: true, value: undefined };
}

export function commitPolicyStage(
  state: PolicyStageState,
): RuntimeResult<Uint8Array> {
  if (state.receivedParts.size !== state.partCount) {
    return failure("runtime.request-body-policy-incomplete");
  }
  let totalReceived = 0;
  for (let i = 0; i < state.partCount; i += 1) {
    const part = state.receivedParts.get(i);
    if (!part) {
      return failure("runtime.request-body-policy-missing-part");
    }
    totalReceived += part.byteLength;
  }
  if (totalReceived !== state.totalBytes) {
    return failure("runtime.request-body-policy-byte-count-mismatch");
  }
  const assembled = new Uint8Array(totalReceived);
  let offset = 0;
  for (let i = 0; i < state.partCount; i += 1) {
    const part = state.receivedParts.get(i);
    if (!part) {
      return failure("runtime.request-body-policy-missing-part");
    }
    assembled.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, value: assembled };
}
