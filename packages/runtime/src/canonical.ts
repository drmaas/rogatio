import { createHash } from "node:crypto";
import type { MatcherOperation } from "@rogatio/compiler";
import type {
  PresetDigest,
  RuntimeGrant,
  RuntimeLimits,
  RuntimePresetV1,
} from "./types.js";

function stringValue(value: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("invalid string");
  return encoded;
}

function arrayValue(values: readonly string[]): string {
  return `[${values.map(stringValue).join(",")}]`;
}

function matcherValue(operation: MatcherOperation): string {
  const matcher = operation.matcher;
  const method =
    matcher.method === undefined
      ? ""
      : `,"method":${stringValue(matcher.method)}`;
  return `{"kind":"matcher","groupId":${stringValue(operation.groupId)},"ruleId":${stringValue(operation.ruleId)},"matcher":{"urlRegex":{"source":${stringValue(matcher.urlRegex.source)},"flags":""},"origins":${arrayValue(matcher.origins)},"resourceTypes":${arrayValue(matcher.resourceTypes)},"priority":${String(matcher.priority)}${method}}}`;
}

function limitsValue(limits: RuntimeLimits): string {
  const fields = [
    ["maxPresetBytes", limits.maxPresetBytes],
    ["maxRequestLineBytes", limits.maxRequestLineBytes],
    ["maxHeaderCount", limits.maxHeaderCount],
    ["maxRequestHeaderBytes", limits.maxRequestHeaderBytes],
    ["maxControlBodyBytes", limits.maxControlBodyBytes],
    ["maxResponseHeaderBytes", limits.maxResponseHeaderBytes],
    ["maxResponseBodyBytes", limits.maxResponseBodyBytes],
    ["maxFileBytes", limits.maxFileBytes],
    ["maxConcurrentSessions", limits.maxConcurrentSessions],
    ["maxConcurrentOperations", limits.maxConcurrentOperations],
    ["maxOperationsPerSession", limits.maxOperationsPerSession],
    ["maxDnsAddresses", limits.maxDnsAddresses],
    ["bootstrapLifetimeMs", limits.bootstrapLifetimeMs],
    ["sessionLifetimeMs", limits.sessionLifetimeMs],
    ["connectTimeoutMs", limits.connectTimeoutMs],
    ["responseHeaderTimeoutMs", limits.responseHeaderTimeoutMs],
    ["bodyIdleTimeoutMs", limits.bodyIdleTimeoutMs],
    ["operationTimeoutMs", limits.operationTimeoutMs],
    ["maxRedirects", limits.maxRedirects],
  ] as const;
  return `{${fields.map(([key, value]) => `${stringValue(key)}:${String(value)}`).join(",")}}`;
}

function grantValue(grant: RuntimeGrant): string {
  return `{"groupId":${stringValue(grant.groupId)},"ruleId":${stringValue(grant.ruleId)},"operationId":${stringValue(grant.operationId)},"kind":${stringValue(grant.kind)},"target":${stringValue(grant.target)},"method":${stringValue(grant.method)}}`;
}

export function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortGrants(grants: readonly RuntimeGrant[]): RuntimeGrant[] {
  return [...grants].sort(
    (left, right) =>
      compareStrings(left.groupId, right.groupId) ||
      compareStrings(left.ruleId, right.ruleId) ||
      compareStrings(left.operationId, right.operationId) ||
      compareStrings(left.kind, right.kind) ||
      compareStrings(left.target, right.target) ||
      compareStrings(left.method, right.method),
  );
}

export function canonicalPresetBytes(
  preset: RuntimePresetV1,
  grants = preset.grants,
): Uint8Array {
  const matchers = preset.matchers.map(matcherValue).join(",");
  const canonical = `{"version":1,"limits":${limitsValue(preset.limits)},"matchers":[${matchers}],"grants":[${sortGrants(grants).map(grantValue).join(",")}]}`;
  return new TextEncoder().encode(canonical);
}

export function digestBytes(bytes: Uint8Array): PresetDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalDescriptor(value: {
  readonly groupId: string;
  readonly ruleId: string;
  readonly operationId: string;
  readonly kind: string;
  readonly target: string;
  readonly method: string;
}): string {
  return `{"groupId":${stringValue(value.groupId)},"ruleId":${stringValue(value.ruleId)},"operationId":${stringValue(value.operationId)},"kind":${stringValue(value.kind)},"target":${stringValue(value.target)},"method":${stringValue(value.method)}}`;
}
