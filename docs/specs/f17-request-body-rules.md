# F17 - Request-Body Replacement and Modification Rules

**Status:** Approved specification (Stage 4 reapproved 2026-08-25; ordinary MV3 authority)
**Feature:** F17
**Depends on:** F14 native runtime, F16 request-body trust lifecycle, F7 extension shell, F5 editor
**Packages:** `@rogatio/schema`, `@rogatio/compiler`, `@rogatio/browser-core`, `@rogatio/editor`, `@rogatio/extension`, `@rogatio/runtime`, `@rogatio/cli`
**Protocol:** `f17-v1` policy/session channel over Chrome native messaging
**Reference base:** `f76838d` on `feature/f17`

## Problem and goals

Rogatio can currently alter request URLs, query parameters, headers, mocks, and
selected response bodies. It cannot replace or modify a browser request body before
the upstream server receives it.

F17 adds bounded request-body rules for explicitly authorized browser XHR requests.
Users can replace the complete body or apply one bounded global ECMAScript regular
expression replacement. The live path is extension-owned and capability-gated. Project
verification, editing, and dry-run behavior remain offline.

Goals:

- Add strict, versioned request-body rule data without invalidating existing projects.
- Support complete UTF-8 body replacement.
- Support one global ECMAScript `gu` replacement with standard `$` expansion.
- Intercept only eligible `POST`, `PUT`, and `PATCH` `xmlhttprequest` requests.
- Preserve `Cookie` and `Authorization` unchanged when all other checks pass.
- Reject unsupported framing, encoding, signatures, binary data, mTLS, targets, and
  capabilities before upstream body transmission.
- Select one deterministic winner across all applicable request-phase actions.
- Keep observed body bytes in native runtime memory only.
- Provide stable redacted diagnostics and explicit teardown.

## Scope

### In scope

- Version-1 schema and browser-safe validation for `request-body` rules.
- Strict replace and regex action payloads.
- Optional exact local-target origin allowlist.
- Compiler `RequestBodyOperation` with source order.
- Shared global request-phase arbitration.
- Bounded UTF-8 request transformation.
- Digest-bound in-memory native policy and staged native frames.
- Extension-owned live session, PAC, metadata observation, and ordinary-MV3 static-marker correlation.
- Narrow HTTP/1.1 loopback proxy and TLS interception provider seam.
- F14 shared-provider and authority repairs required by F17.
- F16 X.509 trust, exact extension identity, manifest, and rollback repairs required
  by F17.
- Request-body editor controls and offline CLI support.
- Unit, integration, packaged-install, and capable-platform live-path verification.

### Explicit non-goals

- Incognito or private-browsing interception.
- `GET`, `HEAD`, `DELETE`, `OPTIONS`, `CONNECT`, `TRACE`, or custom methods.
- Non-XHR request types, navigation, script, media, WebSocket, WebTransport, streaming
  `fetch`, or duplex bodies.
- HTTP/2, HTTP/3, chunked transfer, trailers, multipart, compression, or binary bodies.
- Automatic request-signature recomputation or interpretation of application-specific
  `Authorization` signatures.
- Client-certificate forwarding or mTLS support.
- Generic unrestricted proxying or widening of F6 transport.
- Automatic CA trust installation, runtime start, PAC takeover, or proxy takeover.
- Policy hot reload within one active native session.
- Persistence of live sessions, policy staging, traffic, bodies, headers, or credentials.
- New unreviewed proxy, TLS, regex, or native-messaging dependencies.
- Changes to F13 mock semantics or F15 response-body semantics beyond shared seam
  repairs.

## Actors and supported environments

| Actor | Responsibility |
| --- | --- |
| CLI operator | Verifies, edits, dry-runs, installs trust, and inspects safe status. |
| Editor | Edits project and request-body configuration without runtime access. |
| Chrome extension | Owns permissions, committed project state, live policy, native session, PAC, and markers. |
| Native runtime | Validates policy, selects authority, transforms bodies, and forwards or blocks traffic. |
| Platform CA adapter | Detects capability and manages device-local X.509 trust through reviewed tooling. |
| Upstream server | Receives only an authorized, successfully transformed request. |
| Browser request | Untrusted input for metadata, framing, headers, target, and body validation. |

Offline support is required on Node.js `>=24`, TypeScript 7, ESM/NodeNext, Linux,
macOS, and Windows. Chrome MV3 is the browser target. macOS is the reference live
platform. Linux and Windows may activate live interception only when equivalent injected
capability and CA adapters prove every required boundary. Missing capability produces
stable `unsupported` status and never enables unsafe fallback.

## Terminology and invariants

### Rule shape

The rule action property is `requestBody`, matching the existing `responseBody`
convention:

```json
{
  "type": "request-body",
  "method": "POST",
  "resourceTypes": ["xmlhttprequest"],
  "requestBody": {
    "mode": "replace",
    "body": "{\"debug\":false}"
  }
}
```

Regex mode is:

```json
{
  "mode": "regex",
  "pattern": "\\\"debug\\\":\\s*true",
  "replacement": "\\\"debug\\\":false"
}
```

`replace` has exactly `mode` and `body`. `regex` has exactly `mode`, `pattern`, and
`replacement`. Unknown keys, alternate discriminants, arrays, inherited values,
accessors, proxies, cycles, symbols, sparse arrays, and malformed strings are rejected.
The user supplies no flags. Runtime regex flags are always `gu`.

### Effective origins and source order

Effective origins are the normalized union of a group's origins and a rule's origins.
Offline and fully observed selector contexts may evaluate the exact initiator origin.
The supported ordinary MV3 live path cannot guarantee that value: DNR exposes only a
host-domain initiator projection for a static marker, and the native proxy has no
reliable request-ID correlation. Live body authorization therefore requires a valid
session marker whose URL, method, resource-type, and host-domain conditions were
installed from the canonical operation. It must not claim exact initiator scheme,
port, or browser-context proof.

Source order is zero-based traversal order: group array order, then rule array order.
The compiler preserves it. Priority is not used to reorder serialized operations.

### Global winner

For request phase, candidate operations include redirect, query, request-header, mock,
and request-body operations. The winner is the highest numeric priority; ties use the
lowest source-order index. Exactly one request-phase action applies. No actions compose.
Response-only operations, including response-body, are selected in response phase and
do not compete with request-body operations.

The extension and native runtime must implement the same priority and source-order
selector. DNR incidental ordering is not authority. In ordinary MV3 live mode, the
native selector operates on the target/method/resource context plus the validated static
marker projection; it does not fabricate an exact initiator. If the browser/platform
boundary cannot prove that a higher-priority request action suppresses a lower
request-body action, F17 live activation is `unsupported` and installs no request-body
routing.

## Functional requirements

### Schema and project format

- **REQ-001:** Project schema version remains `1`.
- **REQ-002:** Rule type enumeration includes `request-body`.
- **REQ-003:** A `request-body` rule requires exactly one `requestBody` action object.
- **REQ-004:** Replace action is exactly `{ "mode": "replace", "body": string }`.
- **REQ-005:** Regex action is exactly `{ "mode": "regex", "pattern": string, "replacement": string }`.
- **REQ-006:** Action validation rejects unknown properties, missing properties, wrong
  value types, arrays, inherited values, accessors, proxies, cycles, symbols, sparse
  arrays, and malformed UTF-16.
- **REQ-007:** Replace body and regex replacement are valid Unicode strings and obey
  UTF-8/policy bounds. Lone surrogates are rejected rather than silently replaced.
- **REQ-008:** Regex pattern is non-empty, bounded, and valid when constructed as one
  ECMAScript `RegExp` with flags `gu`.
- **REQ-009:** Request-body method is exactly `POST`, `PUT`, or `PATCH`.
- **REQ-010:** Request-body `resourceTypes` is exactly `["xmlhttprequest"]`.
- **REQ-011:** Method and resource-type violations are schema errors, not runtime-only
  warnings.
- **REQ-012:** Project may contain `requestBodyPolicy.localOrigins`.
- **REQ-013:** `requestBodyPolicy` and `localOrigins` reject unknown properties and
  malformed values.
- **REQ-014:** Each local origin is one exact normalized HTTP(S) origin with no
  credentials, path, query, fragment, wildcard, backslash, invalid port, trailing-dot
  hostname, or control character.
- **REQ-015:** Local origins do not imply another scheme, port, hostname, subdomain,
  or path. Missing or empty configuration permits public targets only.
- **REQ-016:** Browser-safe validation mirrors action, method, resource, string, and
  local-origin rules without Node imports or runtime-compiled AJV.
- **REQ-017:** Existing projects without F17 fields remain valid and behaviorally
  unchanged.

### Compiler and arbitration

- **REQ-018:** Valid request-body rules compile to detached `RequestBodyOperation` values.
- **REQ-019:** Each operation preserves group ID, rule ID, normalized matcher, priority,
  strict action, and source order.
- **REQ-020:** Compiler output is fresh, serializable, deterministic, and not backed by
  mutable project objects.
- **REQ-021:** Invalid projects compile to no operations with stable diagnostics.
- **REQ-022:** Existing matcher, redirect, query, header, mock, and response-body
  operation kinds remain supported.
- **REQ-023:** Selector filters enabled groups, grants, effective origins, URL, method,
  resource type, initiator when an exact selector context is available, target, and
  phase before priority comparison. Live ordinary-MV3 selection uses the validated
  marker projection instead of treating missing exact initiator data as authority.
- **REQ-024:** Selector chooses highest priority, then earliest source order, and never
  composes request-phase actions.
- **REQ-025:** Extension, native runtime, CLI dry-run, and tests produce the same winner
  for the same immutable operation set and equivalent context. Live ordinary-MV3
  context is the canonical target/method/resource data plus static marker projection;
  it is not an exact initiator-origin context.
- **REQ-026:** A higher-priority non-body request action prevents a lower-priority
  request-body action from transforming the request.

### Native policy and protocol

- **REQ-027:** Extension builds an immutable `RequestBodyPolicyV1` from committed
  project state, enabled groups, granted origins, exact local origins, and explicit
  extension ID.
- **REQ-028:** Policy contains every request-phase operation needed for global
  arbitration, including competing non-body operations, action data, matcher data,
  source order, project identity/revision, grants, and limits.
- **REQ-029:** Policy contains no captured request/response bodies, credentials,
  sensitive header values, traffic dumps, or unrelated file contents.
- **REQ-030:** Native runtime independently validates policy shape, operation kinds,
  IDs, source order, effective origins, grants, local origins, methods, resource types,
  action bounds, and limits before activation.
- **REQ-031:** Native runtime accepts authority only from the complete active policy; a
  per-request rule ID, selected operation, grant, or browser claim is never sufficient.
- **REQ-032:** Canonical policy bytes are compact UTF-8 JSON with fixed key ordering and
  deterministic ordering of set-like values.
- **REQ-033:** Policy digest is `sha256:<64 lowercase hexadecimal characters>` and
  covers extension ID, project identity/revision or committed-project digest, enabled
  groups, grants, local origins, operations, action data, matchers, source order, and
  F17 limits.
- **REQ-034:** Session nonce, timestamps, capabilities, and native frame segmentation
  do not affect policy digest.
- **REQ-035:** Native policy is memory-only, one active immutable policy per session,
  and discarded on disconnect, stop, replacement, or failure.
- **REQ-036:** Policy larger than one frame uses `policy-begin`, `policy-part`, and
  `policy-commit` staging with bounded order, count, byte total, timeout, and digest.
- **REQ-037:** Native messaging uses Chrome framing: four-byte little-endian payload
  length followed by UTF-8 JSON payload.
- **REQ-038:** Every native frame is at most 64 KiB. Canonical policy is at most 256 KiB.
- **REQ-039:** Policy parts carry only base64url canonical policy bytes. Incomplete,
  duplicate, reordered, oversized, malformed, or digest-mismatched policy never activates.
- **REQ-040:** F17 native responses contain only stable protocol state, digest, status,
  and error code. They contain no observed body, credential, sensitive header, URL,
  certificate, path, or platform-tool output.

### Extension identity and live session

- **REQ-041:** F17 requires one explicit extension ID matching exactly 32 lowercase
  characters from `a` through `p`.
- **REQ-042:** Build configuration, native manifest, session policy, and runtime use the
  same extension ID. Manifest origin is exactly `chrome-extension://<id>/`.
- **REQ-043:** ID is never inferred from a sender, generated at runtime, wildcarded,
  guessed, or omitted. Missing or mismatched ID fails before activation.
- **REQ-044:** Live start is extension-owned and requires explicit user activation after
  policy, permission, trust, identity, collision, and capability checks.
- **REQ-045:** Import, save, project switch, group activation, permission grant, and
  extension startup do not auto-start interception.
- **REQ-046:** Extension service-worker restart does not restore a live session from
  persisted state. Disconnect invalidates session and removes owned routing.
- **REQ-047:** Extension serializes start, stop, policy replacement, permission changes,
  PAC changes, and marker installation through one coordinator.
- **REQ-048:** Policy change, enablement change, grant revocation, capability loss, or
  fatal provider failure removes old routing before any new policy can activate.
- **REQ-049:** CLI does not own or silently replace an extension live session. CLI
  `runtime start` without extension policy cannot begin request-body interception.
- **REQ-050:** Start rollback stops acceptance, removes owned markers, restores PAC only
  if still owned by Rogatio, stops the native session, and clears transient
  marker/session state.
- **REQ-051:** Stop invalidates policy, capabilities, active request state, sockets,
  timers, and transform workers, removes owned markers/PAC, and is idempotent.

### Request eligibility, framing, and body

- **REQ-052:** Only `POST`, `PUT`, and `PATCH` `xmlhttprequest` requests are eligible.
- **REQ-053:** Transformed traffic uses HTTP/1.1 and ALPN `http/1.1` only.
- **REQ-054:** Request has exactly one valid non-negative decimal `Content-Length` at
  most 4 MiB. Received byte count must equal it exactly.
- **REQ-055:** Runtime independently counts bytes and rejects early EOF, excess bytes,
  ambiguous duplicate lengths, and request-smuggling patterns.
- **REQ-056:** Runtime rejects `Transfer-Encoding`, chunked framing, trailers, `Trailer`,
  `Expect`, `Upgrade`, pipelining, HTTP/2, HTTP/3, multipart, compression, and binary
  body handling.
- **REQ-057:** Runtime buffers only bounded body bytes in memory and enforces limits
  before allocation and while receiving.
- **REQ-058:** Accepted MIME types are `application/json`, valid `application/*+json`,
  `application/x-www-form-urlencoded`, and `text/*`, case-insensitively.
- **REQ-059:** MIME charset is absent or UTF-8 only, case-insensitively. `Content-Encoding`
  is absent or `identity` only.
- **REQ-060:** Invalid UTF-8 is rejected before upstream connection. Empty body is valid
  when all framing and MIME requirements are otherwise valid.
- **REQ-061:** Replace mode validates the incoming body before discarding it and using
  configured replacement bytes.

### Target, TLS, headers, and credentials

- **REQ-062:** Target scheme is HTTP or HTTPS. Target has no credentials, fragment,
  controls, backslashes, wildcard, trailing-dot hostname, invalid port, or ambiguous
  encoding.
- **REQ-063:** Target origin is an exact member of the selected operation's effective
  origins and exact policy grants.
- **REQ-064:** Public targets are allowed by default. Loopback, unspecified, private,
  link-local, multicast, carrier-grade, documentation, benchmarking, reserved, and
  other non-public addresses require exact membership in `localOrigins`.
- **REQ-065:** DNS obtains all A and AAAA answers, rejects mixed public/non-public
  answers, and pins one validated numeric address for the connection.
- **REQ-066:** Runtime preserves authorized hostname for HTTP authority and HTTPS SNI;
  it does not re-resolve, race, retry another address, follow redirects, consult
  ambient proxy settings, or downgrade protocol.
- **REQ-067:** Local-origin exceptions do not bypass exact authority, framing, TLS,
  address, or body validation.
- **REQ-068:** Provider binds only to `127.0.0.1`, accepts HTTP absolute-form port 80 or
  HTTPS `CONNECT` port 443, and rejects arbitrary CONNECT targets.
- **REQ-069:** Runtime preserves `Cookie`, `Authorization`, `Origin`, `Referer`, and
  valid ordinary browser/application metadata when otherwise eligible.
- **REQ-070:** Runtime reconstructs `Host`/authority and recalculates `Content-Length`
  from transformed UTF-8 bytes.
- **REQ-071:** Runtime removes or rejects hop-by-hop, proxy, transfer, trailer, and
  conflicting framing headers. It does not forward stale `Content-Encoding`.
- **REQ-072:** Runtime rejects case-insensitive `Content-MD5`, `Digest`,
  `Content-Digest`, `Signature`, and `Signature-Input` headers.
- **REQ-073:** `Authorization` is preserved unchanged even if it may contain an unknown
  application-specific body signature. Runtime never recomputes or repairs it.
- **REQ-074:** Client-certificate or mTLS negotiation is unsupported and blocks before
  upstream body transmission. Browser certificates, keys, and selection state never
  enter runtime policy or messages.

### Transformation

- **REQ-075:** Replace mode discards validated input and encodes configured `body` as
  UTF-8. Output is at most 4 MiB.
- **REQ-076:** Regex mode decodes complete input as strict UTF-8, constructs one
  ECMAScript regex with `gu`, and performs one standard `String.replace` operation.
- **REQ-077:** Regex replacement is global and supports standard ECMAScript expansion:
  `$$`, `$&`, ``$` ``, `$'`, numbered captures, and named captures where supported by
  the engine.
- **REQ-078:** Replacement text is never evaluated as JavaScript. Zero-length global
  matches use standard ECMAScript progress semantics.
- **REQ-079:** Regex pattern, input, output, worker resources, and operation count are
  bounded. Regex has a hard 250 ms deadline plus complete operation timeout.
- **REQ-080:** Regex executes in an independently terminable boundary. Timeout, worker
  failure, memory/resource exhaustion, output overflow, or engine exception blocks.
- **REQ-081:** No partial transformed output is sent. No DNS lookup, upstream socket,
  request write, retry, or original-body fallback occurs after transform failure.
- **REQ-082:** Successful output is UTF-8, identity encoded, and has recomputed framing.

### PAC and shared provider repairs

- **REQ-083:** PAC is deterministic and routes only exact configured HTTP(S) origins
  with enabled live operations. Non-configured traffic is `DIRECT`.
- **REQ-084:** PAC-origin traffic with no winning request-body authorization is forwarded
  unchanged. This includes same-origin requests that are not selected for transformation.
- **REQ-085:** A PAC-routed request without a body marker has no body authorization and
  is forwarded unchanged, even when a policy operation could have matched. A request
  carrying a malformed, duplicated, or mismatched reserved marker is blocked and is
  not reclassified as ordinary pass-through. A valid body marker that later fails
  framing, authority, or transformation is blocked without original-body fallback.
- **REQ-086:** Marker names use a runtime-owned reserved prefix, are ephemeral, are
  removed before upstream, and cannot be configured by user header rules.
- **REQ-087:** Existing controlling proxy, PAC, extension, or enterprise policy collision
  prevents activation. If collision safety cannot be proven, status is `unsupported`.
- **REQ-088:** PAC installation happens only after policy, trust, capability, identity,
  and arbitration checks. Failure leaves existing routing unchanged.
- **REQ-089:** F14 exposes shared per-session provider ownership, policy digest, extension
  ID, exact PAC origins, target policy, and actual provider state for F15/F17.
- **REQ-090:** F14 authority revalidation checks operation consistency, URL, target,
  origin, method, resource type, enabled state, permission scope, policy digest,
  validated marker binding, and selected global winner. Exact initiator checks apply
  only where an exact context is available; ordinary-MV3 live authority uses the
  marker's host-domain projection and must not claim more precision.
- **REQ-091:** F16 supplies X.509 CA certificate and key, actual trust standing, exact
  native-messaging origin, host confinement, atomic material, and rollback. SPKI alone
  is not sufficient.
- **REQ-092:** CA capability adapters use reviewed fixed executable paths and argument
  arrays, never shell interpolation. No unreviewed dependency is added.
- **REQ-093:** CA keys/certificates and leaf material remain device-local or memory-only;
  they never enter project files, policy frames, diagnostics, or logs.

### Extension, editor, and CLI behavior

- **REQ-094:** Extension requests only required native-messaging, proxy, DNR, and
  metadata-observation permissions. It does not request `webRequestBlocking`, and
  request-body actions are not represented as DNR body actions.
- **REQ-095:** Metadata observation may explicitly copy safe URL, target, method,
  resource type, initiator, request ID, and policy-digest fields when exposed, but
  these fields are best-effort diagnostics and never request-body authority. The
  listener never reads or spreads `details.requestBody`, headers, cookies, or
  authorization values.
- **REQ-096:** Extension derives permissions from effective origins and configured local
  origins, keeps groups disabled after create/import/update/save, and separates grants
  from activation.
- **REQ-097:** Extension reports `disabled`, `needs permission`, `needs proxy`,
  `unsupported`, `error`, and `active` from actual body-session readiness. `active`
  means policy/provider/PAC installation succeeded, not that every request succeeds.
- **REQ-098:** Editor registers `request-body`, renders replace body or regex
  pattern/replacement controls, fixes method/resource constraints, initializes valid
  defaults, clears stale action fields, and preserves detached drafts.
- **REQ-099:** Editor validation exposes stable field paths, does not execute transforms,
  and remains keyboard accessible, screen-reader accessible, forced-colors compatible,
  and usable at 200% zoom.
- **REQ-100:** Extension/editor/browser bundles contain no Node globals, filesystem,
  native TLS, runtime schema compiler, or observed body bytes.
- **REQ-101:** `rogatio verify` validates all F17 project and policy constraints without
  network, native messaging, CA, proxy, TLS, or target access.
- **REQ-102:** `rogatio edit` and `rogatio test` remain offline. Dry-run can show matcher
  result and bounded action preview but never reads a live body or persists test input.
- **REQ-103:** `rogatio runtime install --extension-id <id>` requires the exact explicit
  ID. `runtime trust` remains explicit and capability-gated.

> Superseded by: feat/collapse-runtime-install-and-trust
- **REQ-104:** `runtime start` never auto-installs trust and cannot start live body
  interception without extension policy. `runtime status` exposes only safe state.
- **REQ-105:** Unsupported platforms and provider failures produce deterministic
  non-throwing status and do not partially change routing.

### Security, privacy, and diagnostics

- **REQ-106:** Observed request and response bodies remain in native runtime memory only
  for active validation, transform, and forwarding.
- **REQ-107:** Observed bodies, credentials, sensitive headers, certificate material,
  raw URLs, paths, IP addresses, DNS answers, stacks, and third-party error text never
  enter logs, native messages, diagnostics, status, exports, or project storage.
- **REQ-108:** Public runtime errors use stable F17 codes independent of Node, regex,
  TLS, DNS, or platform-tool wording and reveal no protected existence information.
- **REQ-109:** Native policy is deny-by-default. Browser grants and selected IDs never
  replace native validation.
- **REQ-110:** Policy, request staging, static markers, live capabilities, and traffic
  are memory-only. No telemetry, hosted endpoint, synchronization, or traffic history
  is introduced.
- **REQ-111:** Runtime enforces no more than 32 active request-body operations and
  concurrent transforms, aborting excess work with stable overload status.
- **REQ-112:** Ordinary MV3 live support uses one ephemeral, session-bound static DNR
  marker per request-body operation. It does not use request-ID keyed dynamic rules,
  per-request native grants, or a pending authorization map.
- **REQ-113:** A static marker's initiator condition is derived from DNR's hostname
  projection. F17 shall not represent that condition as exact initiator scheme, port,
  or private-browsing proof.
- **REQ-114:** Absence of a marker on PAC-routed traffic is an ordinary-MV3 correlation
  miss and forwards the request unchanged. A reserved marker that is malformed,
  duplicated, or inconsistent with the active session blocks the request.

## Public data contracts

### Schema types

```ts
export type RequestBodyMode = "replace" | "regex";

export interface RequestBodyReplaceAction {
  readonly mode: "replace";
  readonly body: string;
}

export interface RequestBodyRegexAction {
  readonly mode: "regex";
  readonly pattern: string;
  readonly replacement: string;
}

export type RequestBodyAction =
  | RequestBodyReplaceAction
  | RequestBodyRegexAction;

export interface RequestBodyPolicyConfig {
  readonly localOrigins: string[];
}
```

The rule fields are:

```ts
export interface RequestBodyRuleFields {
  readonly type: "request-body";
  readonly method: "POST" | "PUT" | "PATCH";
  readonly resourceTypes: ["xmlhttprequest"];
  readonly requestBody: RequestBodyAction;
}
```

### Compiler operation

```ts
export interface RequestBodyOperation {
  readonly kind: "request-body";
  readonly groupId: string;
  readonly ruleId: string;
  readonly sourceOrder: number;
  readonly matcher: NormalizedMatcher;
  readonly requestBody: RequestBodyAction;
}
```

### Winner API

```ts
export interface RuleMatchContext {
  readonly url: string;
  readonly target: string;
  readonly method: string;
  readonly initiator: string;
  readonly resourceType: string;
  readonly phase: "request" | "response";
}

export type WinnerResult =
  | {
      readonly kind: "winner";
      readonly operation: RogatioOperation;
      readonly sourceOrder: number;
    }
  | { readonly kind: "none" };
```

The selector receives immutable operations, enabled group IDs, granted origins, and
request context. This contract is used for exact offline and fully observed contexts.
The live ordinary-MV3 proxy path supplies equivalent target/method/resource data and a
validated marker projection; it does not synthesize an exact `initiator` value when
Chrome cannot provide one.

### Native policy

```ts
export interface RequestBodyPolicyV1 {
  readonly protocol: "f17-v1";
  readonly version: 1;
  readonly extensionId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly committedProjectDigest: string;
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
  readonly localTargetOrigins: readonly string[];
  readonly operations: readonly RogatioOperation[];
}
```

The policy carries a minimal authority snapshot, not the complete project file. The
extension validates the committed project through schema/compiler before building it;
the runtime validates the snapshot and digest-bound session independently. This is
integrity and session binding, not protection from a compromised extension. User choice
explicitly rejects CLI signing for F17.

### Transform API

```ts
export interface RequestBodyTransformInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly contentEncoding?: string;
  readonly contentLength: number;
}

export interface RequestBodyTransformOutput {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly contentLength: number;
  readonly contentEncoding: "identity";
}
```

The transform result is a discriminated success/error value. Error values contain a
stable code only and never body or credential data.

## Stable runtime error codes

The implementation may expose only this F17 code vocabulary in public diagnostics:

```text
runtime.request-body-policy-invalid
runtime.request-body-policy-too-large
runtime.request-body-policy-mismatch
runtime.request-body-extension-denied
runtime.request-body-frame-invalid
runtime.request-body-frame-too-large
runtime.request-body-session-ended
runtime.request-body-metadata-missing
runtime.request-body-marker-invalid
runtime.request-body-no-winner
runtime.request-body-unsupported-method
runtime.request-body-unsupported-resource
runtime.request-body-http-version
runtime.request-body-framing
runtime.request-body-body-too-large
runtime.request-body-content-type
runtime.request-body-encoding
runtime.request-body-binary
runtime.request-body-invalid-utf8
runtime.request-body-signature
runtime.request-body-client-certificate
runtime.request-body-target-denied
runtime.request-body-address-denied
runtime.request-body-dns-failed
runtime.request-body-redirect
runtime.request-body-regex-invalid
runtime.request-body-regex-timeout
runtime.request-body-regex-failed
runtime.request-body-output-too-large
runtime.request-body-transform-blocked
runtime.request-body-collision
runtime.request-body-unsupported
runtime.request-body-upstream-failed
runtime.request-body-overloaded
runtime.request-body-timeout
runtime.request-body-internal
```

Public errors contain only stable code and safe state. Third-party wording is never
serialized.

## Limits

| Resource | F17 limit |
| --- | ---: |
| Observed request body | 4 MiB |
| Transformed output body | 4 MiB |
| Canonical live policy | 256 KiB |
| Serialized native frame | 64 KiB |
| Request-body operations in one policy | 32 |
| Concurrent request-body transforms | 32 |
| Regex pattern | 2,048 UTF-16 code units and policy byte bound |
| Regex replacement | 4,096 UTF-16 code units and policy byte bound |
| Local origins | 32 |
| Regex deadline | 250 ms |
| Complete operation | Existing F14 operation timeout |
| Redirects | 0 |
| Protocol | HTTP/1.1 |
| Content encoding | Absent or `identity` |

The 4 MiB limit applies independently to observed and transformed wire bodies. The
256 KiB limit applies to complete canonical policy, including configured replacement
strings. A valid project may be ineligible for live activation when its canonical
policy exceeds 256 KiB.

## Runtime flow

1. User creates a `request-body` rule in CLI or extension editor.
2. Schema validation enforces strict action, method, XHR, string, and local-origin
   constraints.
3. Compiler emits ordered detached operations.
4. `verify`, editor save, and dry-run complete without runtime or network access.
5. User imports/saves project, grants required origins, and explicitly activates group.
6. User explicitly installs runtime with extension ID and establishes trust if needed.
7. Extension checks committed project, permissions, identity, trust, capability, and
   proxy-control ownership.
8. Extension builds canonical policy and digest, then stages it over `f17-v1` frames.
9. Native runtime validates policy and reports installed digest/status.
10. Native provider starts non-accepting, then extension installs exact PAC and markers.
11. Extension activates provider; only then do body rules report `active`.
12. Metadata listener may copy safe request metadata and send best-effort
    `request.prepare`; this is not required for authorization.
13. DNR applies the matching static session marker. Native runtime verifies the marker,
    derives the body candidate, and applies global priority/source-order arbitration;
    it creates no request-ID pending authorization.
14. The proxy verifies marker, target, method, resource, framing, MIME, encoding,
    headers, and body length. It does not claim exact initiator scheme or port.
15. Proxy buffers and transforms body in bounded native memory.
16. Successful transformation recomputes framing, strips marker, pins target address,
    and forwards HTTP/1.1 upstream.
17. Missing metadata or marker does not authorize body transformation; under ordinary
    MV3, a routed request with no marker forwards unchanged. A malformed reserved
    marker, wire validation failure, timeout, or transform failure blocks before
    upstream. A selected body operation never falls back to its original body after a
    valid marker has authorized it.
18. PAC-origin traffic with no body winner forwards unchanged. Traffic outside exact PAC
    origins is direct.
19. Stop, disconnect, policy change, capability loss, or fatal provider failure removes
    routing and aborts active work.

## State and status semantics

Native lifecycle:

```text
stopped -> starting -> started -> stopping -> stopped
                    \-> failed
                    \-> unsupported
started ------------> failed
```

Policy lifecycle:

```text
empty -> validating -> installed -> replaced
```

Per-request lifecycle:

```text
prepared -> wire-validated -> buffered -> transformed
          -> upstream-sent -> response-forwarded
```

Any pre-upstream failure becomes `blocked`. Runtime stop aborts all active states.

| Condition | Rule status |
| --- | --- |
| Group disabled | `disabled` |
| Required permission missing | `needs permission` |
| No active extension-owned native session | `needs proxy` |
| Missing trust, identity, capability, arbitration, TLS, or PAC support | `unsupported` |
| Valid session/provider installation failure | `error` |
| Validated policy, provider, PAC, and marker installation | `active` |

Per-request failure does not turn an otherwise installed rule into `active` or
`disabled`; it emits stable redacted diagnostics and blocks the affected operation.

## Compatibility and rollout

- Existing version-1 projects without F17 fields remain valid and unchanged.
- F17-aware consumers validate old projects without adding live behavior.
- Older consumers may reject `request-body` or `requestBodyPolicy`; they must not silently
  discard or enable those fields.
- No automatic downgrade conversion is performed.
- Older native hosts that do not understand `f17-v1` report stable unsupported behavior;
  F17 never activates against a partially understood host.
- F14 metadata behavior remains compatible for F15.
- Existing F16 trust artifacts with empty, wildcard, malformed, or mismatched origins
  are unusable for F17 until explicitly reinstalled with the correct extension ID.
- F15 retains GET-only public credential-free semantics. F6 and F13 behavior remains
  unchanged.
- Live rollout is capability-gated. macOS reference evidence is required before claiming
  real live support; Linux/Windows may remain offline/capability-negative.
- No migration writes policy, traffic, request bodies, response bodies, or credentials.

## Acceptance criteria

- **AC-001:** Valid replace and regex rules validate, reject unknown action keys, and
  compile to detached `RequestBodyOperation` values with source order.
- **AC-002:** Invalid mode, missing/extra fields, malformed strings, invalid regex,
  oversized values, wrong method, wrong resource type, and malformed local origins
  produce stable field diagnostics.
- **AC-003:** Browser-safe schema accepts the same valid and invalid F17 payloads as
  Node validation without Node/AJV runtime imports.
- **AC-004:** Multiple request-phase operations select highest priority, then earliest
  source order, identically in compiler helpers, extension, native runtime, and dry-run;
  no lower action composes. Ordinary-MV3 live selection uses its documented marker
  projection rather than an invented exact initiator.
- **AC-005:** Existing projects and F6/F13/F15 behavior remain valid and unchanged when
  no F17 fields are present.
- **AC-006:** Canonical equivalent policies have identical digest; changed project,
  grants, operations, extension ID, limits, or local origins do not activate as stale.
- **AC-007:** Native frame reader/writer enforces Chrome framing and 64 KiB frames;
  staged policy rejects bad order, duplicate parts, bad totals, timeout, and digest.
- **AC-008:** Native messages never contain observed bodies, response bodies, cookies,
  authorization values, sensitive headers, certificates, paths, or third-party errors.
- **AC-009:** Missing/mismatched extension ID or native manifest origin blocks activation;
  exact origin is used and wildcard/guess/empty identity is rejected.
- **AC-010:** Before explicit extension start, body rules report `needs proxy` and install
  no PAC or markers. Start without policy cannot enable live interception.
- **AC-011:** Extension start is serialized and atomic: policy, trust, capability,
  permission, collision, PAC, and marker failure leaves prior routing unchanged and no
  partially active provider.
- **AC-012:** Stop is idempotent, removes only owned PAC/markers, invalidates active
  request and marker state, closes provider state, and does not overwrite a changed
  external proxy setting.
- **AC-013:** Metadata integration copies only explicit safe fields for best-effort
  diagnostics, never uses them as body authority, and never accesses or spreads
  `details.requestBody`, headers, cookies, or authorization values.
- **AC-014:** Exact public origins route through the scoped provider; traffic outside
  them is direct. Routed-origin requests with no body winner forward unchanged.
- **AC-015:** Routed traffic without a body marker forwards unchanged under ordinary
  MV3. A present malformed, duplicate, or mismatched reserved marker blocks and cannot
  be reclassified as ordinary pass-through. A valid marker followed by wire or
  transformation failure blocks without original-body fallback.
- **AC-016:** Raw HTTP tests reject HTTP/2/3, transfer encoding, chunking, trailers,
  `Expect`, `Upgrade`, ambiguous lengths, oversized bodies, and unsupported MIME/encoding;
  upstream resolver and transport receive zero calls on failure.
- **AC-017:** Replace validates incoming bounded UTF-8 input, substitutes configured
  UTF-8 body, preserves approved media type, and recomputes Content-Length.
- **AC-018:** Regex performs bounded global `gu` replacement with standard expansion,
  handles zero-length matches, and never evaluates replacement as code.
- **AC-019:** Regex timeout, pathological input, worker failure, output overflow, invalid
  UTF-8, or engine failure blocks before DNS/socket/write with no original-body fallback.
- **AC-020:** Upstream receives preserved `Cookie` and `Authorization`, approved ordinary
  metadata, reconstructed authority, recalculated length, and no internal marker or
  hop-by-hop/signature headers.
- **AC-021:** Client-certificate/mTLS and standard body-signature headers block before
  upstream; unknown application-specific Authorization is preserved, not recomputed.
- **AC-022:** Public target DNS rejects mixed/private/reserved answers and pins one
  address. Exact configured local origins permit only exact scheme/host/port targets.
- **AC-023:** Redirects, ambient proxy settings, arbitrary CONNECT targets, re-resolution,
  address retries, and HTTP/2/3 downgrade are absent.
- **AC-024:** F16 trust tests prove X.509 CA certificate/key handling, actual trust status,
  exact extension origin, confinement, atomicity, and rollback through injected adapters.
- **AC-025:** Editor renders mode-specific controls, fixed method/resource constraints,
  local-origin fields, stable validation, stale-field cleanup, detached drafts, and
  accessible browser-safe output.
- **AC-026:** CLI verify/edit/test/dry-run validate and preview F17 without network,
  native messaging, CA, proxy, TLS, target access, or body persistence.
- **AC-027:** Status distinguishes disabled, permission, proxy, unsupported, error, and
  active based on actual policy/provider state and never exposes protected values.
- **AC-028:** Unit and integration tests cover hostile object shapes, sparse/cyclic data,
  stale/replayed grants, policy races, proxy collisions, stop races, regex denial of
  service, and false-green browser/package validation.
- **AC-029:** Capable macOS E2E proves real Chrome native messaging, PAC, trusted TLS,
  static DNR host-domain markers, HTTPS POST/XHR transformation, global winner,
  credential preservation, valid-marker failure blocking, and stop teardown. It does
  not claim exact initiator scheme/port or request-ID blocking correlation. Linux/Windows
  provide equivalent adapter evidence or explicit capability-negative/offline evidence.
- **AC-030:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm test`, `pnpm test:browser`, and `pnpm validate` pass with no generated output,
  browser binaries, dependencies, secrets, credentials, traffic captures, or unrelated
  changes in the worktree.
- **AC-031:** The shipped ordinary-MV3 manifest and session path request no
  `webRequestBlocking`, install no request-ID dynamic marker rules, and use static
  session markers. Tests and diagnostics show missing-marker pass-through and
  malformed-reserved-marker blocking, with the exact-initiator limitation documented.

## Required test mapping

| Test level | Coverage |
| --- | --- |
| Schema | AC-001, AC-002, AC-003, AC-005 |
| Compiler/selector | AC-001, AC-004, AC-006 |
| Editor | AC-025 |
| Runtime transform | AC-017, AC-018, AC-019, AC-020, AC-021 |
| Native protocol/policy | AC-006, AC-007, AC-008, AC-009 |
| Proxy integration | AC-014 through AC-023 |
| F16 regression | AC-024 |
| Extension integration | AC-010 through AC-015, AC-027 |
| CLI integration | AC-026 |
| Browser E2E | AC-029 |
| Package validation | AC-005, AC-030 |

## Approval record

Stage 4 approval was explicitly provided by the user on 2026-08-25 for the initial
full-live contract. After plan review, the user selected **Use ordinary MV3 compromise**
instead of requiring policy-installed/enterprise `webRequestBlocking`. The revised
specification was explicitly reapproved on 2026-08-25. The following decisions remain
carried into the revised specification:

- Full live path is in scope, not offline-only.
- Action shape is strict replace/regex with unknown fields rejected.
- Wire scope is bounded UTF-8 JSON/form/text, identity encoding, Content-Length, and
  HTTP/1.1 only.
- Cookies and Authorization are preserved unchanged; client certificates and standard
  body signatures are rejected; credentials are never logged or native-messaged.
- Transform failures block before upstream without original-body fallback.
- One global winner applies by priority then source order; no composition.
- Platform CA tooling is injected, capability-gated, fixed-argument, and dependency
  reviewed; macOS is reference, Linux/Windows capability-dependent.
- Extension ID is explicit and exact; native origin has no wildcard.
- Same-origin routed traffic with no body authorization forwards unchanged.
- Public targets are default; exact configured local origins are the only exception.
- Extension owns live sessions; CLI retains offline/process diagnostics and cannot claim
  a shared session.
- Native trusts validated digest-bound extension policy; CLI signing is not added.
- Limits are 4 MiB body/output, 256 KiB policy, 64 KiB frame, 32 operations/transforms,
  2,048-code-unit pattern, 4,096-code-unit replacement, 32 local origins, and 250 ms
  regex deadline.
- Regex uses ECMAScript `gu`, standard `String.replace` expansion, and an isolated hard
  deadline boundary.

The revised browser-authority decision is:

- Ordinary MV3 is the supported browser boundary; `webRequestBlocking` is not required
  or requested.
- Each request-body operation receives one ephemeral static DNR marker for the active
  session. No request-ID dynamic rule or native pending authorization is used.
- DNR initiator matching is host-domain projection only. Exact initiator scheme, port,
  and browser-context proof are unavailable at the native proxy boundary.
- PAC-routed traffic without a marker forwards unchanged. A malformed, duplicate, or
  mismatched reserved marker blocks. Once a valid marker selects a body operation,
  wire and transform failures still block before upstream with no original-body fallback.
- If the extension/platform cannot prove global winner suppression without relying on
  incidental DNR ordering, live activation is `unsupported`.

This ordinary-MV3 compromise is a deliberate security tradeoff: it preserves broad
normal-extension availability and keeps body bytes out of browser/native metadata, but
weakens initiator precision and cannot fail closed on a missing marker. F17 must not
describe the marker as proof of an exact initiator origin.
