import type { MatcherOperation } from "@rogatio/compiler";
import type { HttpMethod } from "@rogatio/schema";

export const RUNTIME_PROTOCOL = "f6-v1" as const;

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
}

export interface RuntimePresetV1 {
  readonly version: 1;
  readonly limits: RuntimeLimits;
  readonly matchers: readonly MatcherOperation[];
  readonly grants: readonly RuntimeGrant[];
  readonly mocks?: readonly RuntimeMockConfig[];
}

export interface MockConnectionInfo {
  readonly protocol: "f13-v1";
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

export interface RuntimeBootstrap {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly presetDigest: PresetDigest;
  readonly bootstrapCapability: string;
}

export interface RuntimeServer {
  readonly bootstrap: RuntimeBootstrap;
  stop(): Promise<void>;
}

export interface RuntimeServerOptions {
  readonly preset: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  readonly clock?: () => number;
  readonly port?: number;
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
  | "runtime.internal";

export interface RuntimeError {
  readonly code: RuntimeErrorCode;
}

export type RuntimeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RuntimeError };
