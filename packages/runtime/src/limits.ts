import type { RuntimeLimits } from "./types.js";

export const RUNTIME_LIMITS = Object.freeze({
  maxPresetBytes: 262_144,
  maxRequestLineBytes: 8_192,
  maxHeaderCount: 64,
  maxRequestHeaderBytes: 32_768,
  maxControlBodyBytes: 65_536,
  maxResponseHeaderBytes: 32_768,
  maxResponseBodyBytes: 4_194_304,
  maxFileBytes: 4_194_304,
  maxConcurrentSessions: 16,
  maxConcurrentOperations: 32,
  maxOperationsPerSession: 4,
  maxDnsAddresses: 32,
  bootstrapLifetimeMs: 60_000,
  sessionLifetimeMs: 600_000,
  connectTimeoutMs: 2_000,
  responseHeaderTimeoutMs: 5_000,
  bodyIdleTimeoutMs: 10_000,
  operationTimeoutMs: 30_000,
  maxRedirects: 0 as const,
}) satisfies RuntimeLimits;
