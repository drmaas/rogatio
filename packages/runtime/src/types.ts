import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import type { HttpMethod, ResourceType, RogatioProject } from "@rogatio/schema";

export const RUNTIME_PROTOCOL = "v1" as const;

export type RuntimeOperationKind = "outbound-http" | "confined-file";
export type PresetDigest = `sha256:${string}`;

export interface RuntimeGrant {
  readonly groupId: string;
  readonly ruleId: string;
  readonly operationId: string;
  readonly kind: RuntimeOperationKind;
  readonly target: string;
  readonly method: HttpMethod;
}

export interface RuntimeMockConfig {
  readonly ruleId: string;
  readonly status: number;
  readonly headers?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly delayMs?: number;
  readonly body?: string;
  readonly file?: string;
}

export interface RuntimeLimits {
  readonly maxPresetBytes: number;
  readonly maxRequestLineBytes: number;
  readonly maxHeaderCount: number;
  readonly maxRequestHeaderBytes: number;
  readonly maxControlBodyBytes: number;
  readonly maxResponseHeaderBytes: number;
  readonly maxResponseBodyBytes: number;
  readonly maxFileBytes: number;
  readonly maxConcurrentSessions: number;
  readonly maxConcurrentOperations: number;
  readonly maxOperationsPerSession: number;
  readonly maxDnsAddresses: number;
  readonly bootstrapLifetimeMs: number;
  readonly sessionLifetimeMs: number;
  readonly connectTimeoutMs: number;
  readonly responseHeaderTimeoutMs: number;
  readonly bodyIdleTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly maxRedirects: 0;
  readonly maxRequestBodyBytes: number;
  readonly maxRequestBodyPatternLength: number;
  readonly maxRequestBodyReplacementLength: number;
  readonly maxRequestBodyOperations: number;
  readonly maxRequestBodyTransforms: number;
  readonly maxRegexDeadlineMs: number;
  readonly maxLocalOrigins: number;
}

export interface RuntimePresetV1 {
  readonly version: 1;
  readonly limits: RuntimeLimits;
  readonly matchers: readonly MatcherOperation[];
  readonly grants: readonly RuntimeGrant[];
  readonly mocks?: readonly RuntimeMockConfig[];
}

export interface MockConnectionInfo {
  readonly protocol: "v1";
  readonly port: number;
  readonly presetDigest: PresetDigest;
  readonly mocks: readonly {
    readonly ruleId: string;
    readonly token: string;
  }[];
}

export interface NormalizedRuntimePreset extends RuntimePresetV1 {
  readonly canonicalBytes: Uint8Array;
  readonly digest: PresetDigest;
}

export interface AuthorizedOperation {
  readonly groupId: string;
  readonly ruleId: string;
  readonly operationId: string;
  readonly kind: RuntimeOperationKind;
  readonly target: string;
  readonly method: HttpMethod;
  readonly presetDigest: PresetDigest;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface OutboundRequest {
  readonly protocol: "http:" | "https:";
  readonly hostname: string;
  readonly address: string;
  readonly port: number;
  readonly path: string;
  readonly method: "GET" | "HEAD";
  readonly headers: Readonly<Record<string, string>>;
  readonly servername?: string;
  readonly signal: AbortSignal;
}

export interface OutboundResponse {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: AsyncIterable<Uint8Array>;
}

export interface OutboundResolver {
  lookup(
    hostname: string,
    signal?: AbortSignal,
  ): Promise<readonly ResolvedAddress[]>;
}

export interface OutboundTransport {
  request(options: OutboundRequest): Promise<OutboundResponse>;
}

export interface OutboundOptions {
  readonly resolver?: OutboundResolver;
  readonly transport?: OutboundTransport;
  readonly signal?: AbortSignal;
  readonly operationTimeoutMs?: number;
}

export type AddressClassification =
  | "public"
  | "invalid"
  | "loopback"
  | "unspecified"
  | "private"
  | "link-local"
  | "multicast"
  | "carrier-grade"
  | "documentation"
  | "benchmarking"
  | "reserved"
  | "mapped-private";

export type RuntimeErrorCode =
  | "runtime.invalid-preset"
  | "runtime.unsupported-version"
  | "runtime.invalid-canonical-value"
  | "runtime.pairing-denied"
  | "runtime.authorization-denied"
  | "runtime.local-bind-denied"
  | "runtime.request-malformed"
  | "runtime.headers-too-large"
  | "runtime.body-too-large"
  | "runtime.unsupported-method"
  | "runtime.invalid-target"
  | "runtime.credentials-rejected"
  | "runtime.address-denied"
  | "runtime.dns-failed"
  | "runtime.redirect-rejected"
  | "runtime.file-denied"
  | "runtime.file-race-rejected"
  | "runtime.platform-unsupported"
  | "runtime.timeout"
  | "runtime.size-limit"
  | "runtime.overloaded"
  | "runtime.internal"
  | "runtime.native-frame-too-small"
  | "runtime.native-frame-too-large"
  | "runtime.native-frame-length-mismatch"
  | "runtime.native-frame-invalid-protocol"
  | "runtime.native-frame-invalid-json"
  | "runtime.request-body-policy-stage-timeout"
  | "runtime.request-body-policy-invalid-part-index"
  | "runtime.request-body-policy-duplicate-part"
  | "runtime.request-body-policy-incomplete"
  | "runtime.request-body-policy-missing-part"
  | "runtime.request-body-policy-byte-count-mismatch"
  | "runtime.request-body-duplicate-rule-id"
  | "runtime.request-body-invalid-source-order"
  | "runtime.request-body-invalid-priority"
  | "runtime.request-body-empty-origins"
  | "runtime.request-body-invalid-resource-type"
  | "runtime.request-body-replace-missing-body"
  | "runtime.request-body-replace-too-large"
  | "runtime.request-body-lone-surrogate"
  | "runtime.request-body-regex-missing-pattern"
  | "runtime.request-body-regex-pattern-too-large"
  | "runtime.request-body-regex-invalid"
  | "runtime.request-body-regex-deadline-exceeded"
  | "runtime.request-body-regex-missing-replacement"
  | "runtime.request-body-regex-replacement-too-large"
  | "runtime.request-body-invalid-mode"
  | "runtime.request-body-policy-invalid"
  | "runtime.request-body-extension-id-invalid"
  | "runtime.request-body-too-many-operations"
  | "runtime.request-body-limits-mismatch"
  | "runtime.request-body-invalid-scheme"
  | "runtime.request-body-dns-failed"
  | "runtime.request-body-dns-invalid"
  | "runtime.request-body-dns-mixed-public-private"
  | "runtime.request-body-target-credentials"
  | "runtime.request-body-target-denied"
  | "runtime.request-body-target-invalid"
  | "runtime.request-body-unsupported-method"
  | "runtime.request-body-missing-content-length"
  | "runtime.request-body-invalid-content-length"
  | "runtime.request-body-length-mismatch"
  | "runtime.request-body-transfer-encoding-forbidden"
  | "runtime.request-body-content-encoding-forbidden"
  | "runtime.request-body-unsupported-content-encoding"
  | "runtime.request-body-unsupported-mime-type"
  | "runtime.request-body-invalid-charset"
  | "runtime.request-body-forbidden-header"
  | "runtime.request-body-duplicate-content-length"
  | "runtime.request-body-invalid-utf8"
  | "runtime.request-body-marker-missing"
  | "runtime.request-body-marker-duplicate"
  | "runtime.request-body-marker-invalid"
  | "runtime.request-body-marker-mismatch"
  | "runtime.request-body-marker-expired"
  | "runtime.request-body-upstream-failed"
  | "runtime.request-body-timeout"
  | "runtime.tls-ca-not-loaded"
  | "runtime.tls-leaf-generation-failed"
  | "runtime.mock-unknown";

export interface RuntimeError {
  readonly code: RuntimeErrorCode;
}

export type RuntimeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RuntimeError };

export const PROTOCOL = "v1" as const;

/** Maximum serialized envelope size in bytes (spec REQ-009). */
export const ENVELOPE_MAX_BYTES = 64 * 1024;

/** Maximum distinct PAC origins per generated script (spec REQ-027). */
export const MAX_PAC_ORIGINS = 256;

/** Maximum concurrent body transforms (spec REQ-013). */
export const MAX_CONCURRENT_TRANSFORMS = 32;

/** Revalidation interval in milliseconds (spec REQ-024). */
export const REVALIDATION_INTERVAL_MS = 5_000;

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

export interface RevalidationRequest {
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

export type EnvelopeMessageType =
  | "runtime.start"
  | "runtime.stop"
  | "runtime.status"
  | "authority.grant"
  | "authority.revoke"
  | "transform.request"
  | "transform.result"
  | "pair.request"
  | "pair.response"
  | "authorize.request"
  | "authorize.response"
  | "mock.connect"
  | "mock.request"
  | "mock.response";

export interface PairRequest {
  readonly capability: string;
  readonly presetDigest: string;
}

export interface PairResponse {
  readonly sessionCapability: string;
  readonly expiresInMs: number;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface AuthorizeRequest {
  readonly sessionCapability: string;
  readonly presetDigest: string;
  readonly descriptor: unknown;
}

export interface AuthorizeResponse {
  readonly authorized: boolean;
  readonly groupId?: string;
  readonly ruleId?: string;
  readonly operationId?: string;
  readonly kind?: RuntimeOperationKind;
  readonly target?: string;
  readonly method?: HttpMethod;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface MockConnectRequest {
  readonly presetDigest: string;
}

export interface MockConnectResponse {
  readonly protocol: "v1";
  readonly presetDigest: PresetDigest;
  readonly mocks: readonly {
    readonly ruleId: string;
    readonly token: string;
  }[];
  /** Loopback faucet port the browser redirects mock requests to (spec REQ-003). */
  readonly port?: number;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface MockRequest {
  readonly token: string;
  readonly method?: string;
}

export interface MockResponse {
  readonly status: number;
  readonly headers?: readonly (readonly [string, string])[];
  readonly mockBody: string;
  readonly [key: string]: unknown;
}

export interface MockConnectInfo extends MockConnectResponse {}

export interface Envelope {
  readonly protocol: typeof PROTOCOL;
  readonly type: EnvelopeMessageType;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface EnvelopeInput {
  readonly type: EnvelopeMessageType;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly metadata: Record<string, unknown>;
}

export type { HttpMethod, ResourceType, RogatioOperation, RogatioProject };
