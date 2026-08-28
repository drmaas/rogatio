import {
  ENVELOPE_MAX_BYTES,
  PROTOCOL,
  type Envelope,
  type EnvelopeInput,
  type EnvelopeMessageType,
} from "./types.js";

const FORBIDDEN_BODY_KEYS = new Set(["body", "requestBody", "responseBody"]);

const ENVELOPE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "runtime.start",
  "runtime.stop",
  "runtime.status",
  "authority.grant",
  "authority.revoke",
  "transform.request",
  "transform.result",
]);

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

/**
 * Recursively scan own enumerable data for any key that names a request/response
 * body. Bodies must never cross the native-messaging envelope (spec REQ-006..REQ-008).
 */
export function containsBodyKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsBodyKey(item)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) return true;
    if (containsBodyKey((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

function assertNoBodyContent(metadata: Record<string, unknown>): void {
  if (containsBodyKey(metadata)) {
    throw new EnvelopeError(
      "envelope must not carry request or response body content",
    );
  }
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function serializeEnvelope(input: EnvelopeInput): string {
  if (!ENVELOPE_MESSAGE_TYPES.has(input.type)) {
    throw new EnvelopeError(`unknown envelope type: ${String(input.type)}`);
  }
  if (input.metadata === undefined || typeof input.metadata !== "object") {
    throw new EnvelopeError("envelope metadata is required");
  }
  assertNoBodyContent(input.metadata);

  const envelope: Envelope = {
    protocol: PROTOCOL,
    type: input.type,
    metadata: input.metadata,
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  };

  const serialized = JSON.stringify(envelope);
  if (utf8ByteLength(serialized) > ENVELOPE_MAX_BYTES) {
    throw new EnvelopeError("envelope exceeds maximum size");
  }
  return serialized;
}

export function parseEnvelope(json: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EnvelopeError("envelope is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new EnvelopeError("envelope must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (record.protocol !== PROTOCOL) {
    throw new EnvelopeError("envelope protocol mismatch");
  }
  if (
    typeof record.type !== "string" ||
    !ENVELOPE_MESSAGE_TYPES.has(record.type)
  ) {
    throw new EnvelopeError("envelope type invalid");
  }
  if (typeof record.metadata !== "object" || record.metadata === null) {
    throw new EnvelopeError("envelope metadata missing");
  }
  assertNoBodyContent(record.metadata as Record<string, unknown>);

  const envelope: Envelope = {
    protocol: PROTOCOL,
    type: record.type as EnvelopeMessageType,
    metadata: record.metadata as Readonly<Record<string, unknown>>,
    ...(typeof record.requestId === "string"
      ? { requestId: record.requestId }
      : {}),
    ...(typeof record.timestamp === "number"
      ? { timestamp: record.timestamp }
      : {}),
  };
  return envelope;
}
