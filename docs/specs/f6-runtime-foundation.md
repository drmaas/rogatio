# F6 - Runtime Foundation

**Status:** Proposed specification, Stage 3; pending Stage 4 human approval
**Feature:** F6
**Depends on:** F2, F3
**Package:** Private Node ESM `@rogatio/runtime`

## Problem Statement And Goals

Rogatio needs a local runtime boundary for later mock and response-oriented
features. A loopback listener by itself is not an authorization boundary: any
local process can connect to it, and an unrestricted implementation could
become an SSRF service, a credential-forwarding proxy, or a file server.

F6 establishes the smallest reusable security foundation for those later
features:

- Bind an HTTP control server only to IPv4 loopback, `127.0.0.1`.
- Pair a server instance with a fresh random capability and the digest of its
  exact immutable preset.
- Authorize one exact runtime grant by group, rule, operation, primitive,
  target, and method.
- Provide bounded outbound HTTP(S) and confined-file primitives that cannot be
  reached before authorization.
- Reject SSRF, DNS-rebinding, redirect, credential, method, timeout, and size
  bypasses.
- Return deterministic, stable, redacted failures and retain no runtime or
  traffic state.
- Preserve the existing F2 schema and F3 compiler boundaries.

## Scope And Non-Goals

### In scope

- A private `@rogatio/runtime` workspace package with explicit Node ESM
  exports.
- A closed, versioned runtime preset derived from detached F3 matcher
  operations plus explicit F6 grants.
- Canonical preset bytes and a versioned SHA-256 preset digest.
- In-memory capability pairing, session lifetime, exact authorization, and
  server shutdown.
- A thin HTTP/1.1 control adapter bound only to `127.0.0.1`.
- A public-address-only outbound connector with one pinned connection and no
  redirect following.
- A root-confined, descriptor-based file reader with platform capability
  detection and fail-closed behavior.
- Stable error categories, bounded protocol envelopes, and explicit resource
  limits.
- Unit, adversarial, integration, and package-boundary verification obligations
  for the later implementation stage.

### Explicit non-goals

- F13 mock rule schema, matcher selection, mock status, response headers,
  inline body, file snapshot, delay, browser integration, or Check-and-connect
  UX.
- F14 native-messaging host/process management, TLS interception, device-local
  CA, PAC or proxy configuration, request-body routing, response-body rewriting
  routing, trust lifecycle, or macOS activation.
- A general forward proxy, arbitrary URL fetch endpoint, arbitrary file route,
  directory listing, or path-based file server.
- Browser APIs, extension APIs, Declarative Net Request, permissions,
  `browser-core`, editor, CLI commands, persistence, telemetry, or hosted
  services.
- Request-body forwarding, request-body transformation, multipart decoding, or
  any body-dependent authorization. The F6 control envelope is bounded JSON;
  it is not an upstream request body.

F6 does not evaluate the F3 URL regular expression, effective-origin matcher,
  priority, or rule precedence. A trusted controller selects a rule and
  constructs the exact grant; F6 verifies that the grant is present in the
  immutable preset and that the caller supplied the same complete tuple.

## Actors And Environments

### Actors

- **Trusted controller:** constructs the preset, starts the server, receives
  the bootstrap material in-process, and gives pairing data to an intended
  local client. It controls the configured file root.
- **Local client:** pairs once and submits exact authorization descriptors over
  the loopback control protocol. It is not trusted merely because it can
  connect to loopback.
- **Runtime policy core:** owns validation, canonicalization, digesting,
  capability lifecycle, and exact deny-by-default decisions.
- **Runtime server adapter:** owns HTTP parsing, route admission, bounded
  streams, cancellation, and stable wire responses.
- **Outbound resolver/connector:** resolves and connects only after an
  authorized outbound grant.
- **Configured filesystem root:** is trusted startup configuration, never
  supplied by a wire request.
- **Upstream server:** is untrusted network input. Its redirects, headers,
  size, timing, and connection behavior are not authorization.

### Threat model

An unauthorized same-host process that can reach `127.0.0.1` and send malformed
or probing requests is in scope. A process that can read the runtime process's
memory, obtain the bootstrap or session capability through host compromise, or
change the configured root and approved files is outside the capability model;
the runtime still avoids exposing those values in logs and errors. A remote
network attacker is not expected to reach the listener because it binds only
to IPv4 loopback.

The runtime must not treat loopback binding, a browser origin, a rule name, a
URL hostname, or a successful DNS lookup as sufficient authorization.

### Supported baseline

- Node.js `>=24`, with Node 24 as the repository baseline.
- TypeScript 7, ESM, and NodeNext module resolution.
- Linux, macOS, and Windows for the package, protocol, and policy core.
- Confined-file support only on platforms where the implementation proves the
  required no-follow and descriptor identity guarantees. Other platforms must
  return `runtime.platform-unsupported` for file operations.

The design uses Node `node:http` streams and server limits, `node:crypto` for
randomness, hashing, and timing-safe comparison, `node:dns/promises` with
`all: true`, `node:net`/HTTP connection options for a pinned address, WHATWG
`URL`, `AbortSignal`, and `node:fs` descriptor operations. It does not rely on
an HTTP framework, proxy agent, or third-party canonical serializer.

## Functional And Security Requirements

### Package And Boundaries

- **REQ-001:** The workspace shall contain a private ESM package named
  `@rogatio/runtime`.
- **REQ-002:** The package's product dependencies shall be limited to
  `@rogatio/schema` and `@rogatio/compiler`; Node functionality shall use
  built-in `node:` modules. No proxy, file-serving, HTTP framework, native
  messaging, or TLS dependency shall be added for F6.
- **REQ-003:** The emitted package shall run as a Node ESM artifact on Node
  `>=24` and shall preserve the repository's strict TypeScript, NodeNext,
  esbuild, and Vitest conventions.
- **REQ-004:** F2 remains authoritative for HTTP method names and common data
  policy, and F3 remains authoritative for the matcher operation shape. F6
  shall not alter either package or add action fields to their inputs.
- **REQ-005:** Runtime APIs accepting `unknown` structured values shall reject
  inherited properties, accessors, proxies, sparse arrays, cycles, symbols,
  unsupported values, unknown fields, and malformed data without invoking
  untrusted getters or iterators.

### Runtime Preset And Digest

- **REQ-006:** The runtime preset shall accept only version `1` and shall be a
  closed data contract. It shall contain F3 matcher operations, F6 grants, and
  the fixed F6 resource-limit profile.
- **REQ-007:** Normalization shall return detached, immutable records and
  arrays. It shall not mutate or retain caller-owned mutable input.
- **REQ-008:** Each grant shall identify exactly one `groupId`, `ruleId`, and
  opaque `operationId`, one `kind` (`outbound-http` or `confined-file`), one
  target, and one exact F2 HTTP method. Grant IDs shall be unique, and each
  grant's group/rule pair shall match exactly one supplied F3 matcher
  operation. If that matcher has a method, the grant method shall be the same;
  an omitted matcher method may only be narrowed to the grant's one concrete
  method. An `outbound-http` grant shall use only `GET` or `HEAD`.
- **REQ-009:** An outbound target shall be canonicalized under the F6 URL
  policy and its origin shall be one of the corresponding F3 matcher's
  effective origins. A confined-file target shall be a normalized relative
  logical path. Neither target kind accepts a wildcard, prefix, pattern, or
  array of alternatives.
- **REQ-010:** Canonical preset bytes shall be whitespace-free UTF-8 JSON with
  the fixed top-level order `version`, `limits`, `matchers`, `grants`;
  lexicographic key order within any other object; fixed F3 matcher key order;
  grants sorted by `(groupId, ruleId, operationId, kind, target, method)`;
  arrays without holes; JSON string escaping; and no floating point, undefined,
  non-finite number, date, map, set, function, symbol, or accessor value.
  Unicode code points shall not be silently normalized.
- **REQ-011:** The digest shall be the lowercase hexadecimal SHA-256 of the
  canonical bytes, represented as `sha256:<64 lowercase hexadecimal digits>`.
  The preset version and canonicalization profile are covered by the digest.
- **REQ-012:** The digest shall cover every matcher, grant, target, method,
  operation kind, and fixed limit. It shall exclude capability values, session
  values, timestamps, transport state, and the configured local filesystem
  root.
- **REQ-013:** Equivalent normalized presets shall produce byte-identical
  canonical bytes and equal digests across repeated calls and supported
  platforms. Any change to authorized matcher, grant, target, method, kind, or
  included limit shall change the digest.

### Capability And Session Lifecycle

- **REQ-014:** Server startup shall generate at least 32 cryptographically
  secure random bytes for a bootstrap capability and shall return it only to
  the trusted controller in the in-process bootstrap result. The encoded value
  shall be fixed-format base64url without padding.
- **REQ-015:** The server shall bind the bootstrap capability to its immutable
  preset digest and server instance. It shall never place the bootstrap value
  in a URL, query string, referrer, log, or error response.
- **REQ-016:** `POST /v1/pair` shall require both the bootstrap capability and
  exact preset digest in dedicated headers. A valid pairing consumes the
  bootstrap capability atomically and can succeed only once.
- **REQ-017:** A successful pairing shall return a fresh random session
  capability over the pairing response. The session capability shall be
  bound to the server instance and preset digest, stored only in memory, and
  expire after 10 minutes or server shutdown, whichever comes first.
- **REQ-018:** Every authorization request shall include the session
  capability and exact preset digest. Capability and digest checks shall use
  fixed-format, equal-length, timing-safe comparison. Unequal-length values
  shall be rejected before comparison.
- **REQ-019:** Pairing failures shall not reveal whether a capability was
  missing, malformed, expired, consumed, or associated with another preset.
  Authorization failures shall not reveal whether a rule, target, DNS answer,
  or file exists.
- **REQ-020:** Stopping the server shall close the listener, invalidate all
  bootstrap and session capabilities, abort active operations, close file
  descriptors, and release timers. No session or capability state shall be
  persisted.
- **REQ-021:** The preset shall be immutable for the server lifetime. There
  shall be no watcher or in-place policy reload in F6; changing a preset shall
  stop the old server and start a new one.

### Exact Authorization

- **REQ-022:** The authorization decision shall be an AND of: exact loopback
  transport admission, active session, valid session capability, matching
  preset digest, exact group ID, exact rule ID, exact operation ID, exact
  primitive kind, canonical target equality, and exact method equality.
- **REQ-023:** The runtime shall not select a grant by rule label, source array
  index, priority, regular-expression result, origin prefix, wildcard, fallback,
  or most-specific match. There is no rule merge or precedence algebra in F6.
- **REQ-024:** Method omission and method presence shall not be interchangeable.
  F6 grants contain one concrete method. A method mismatch shall deny before
  DNS, filesystem, or upstream work.
- **REQ-025:** Authorization shall complete before DNS resolution, socket
  connection, filesystem open, body exposure, or primitive-specific resource
  allocation. A denied request shall not provide a reachability or file
  existence oracle.
- **REQ-026:** An authorized operation result shall be an internal opaque
  authorization value accepted by the named F6 primitive. A primitive shall
  not accept an arbitrary URL or filesystem path as a substitute for that
  value.

### Local HTTP Protocol

- **REQ-027:** The server shall bind exclusively to `127.0.0.1` and shall not
  accept a caller-selected host. Binding to `0.0.0.0`, `::`, `::1`, an IPv4
  mapped loopback, or any non-loopback address shall fail.
- **REQ-028:** The default listen port shall be `0` so the operating system
  selects an ephemeral port. The bootstrap result shall return the assigned
  port and fixed host. F6 shall not enable port reuse.
- **REQ-029:** The adapter shall accept only HTTP/1.1 origin-form requests on
  one request per connection. It shall reject HTTP/1.0, absolute-form proxy
  targets, `*`, `CONNECT`, `Upgrade`, pipelining, and unsupported transfer
  behavior.
- **REQ-030:** The only F6 routes shall be `POST /v1/pair` and `POST
  /v1/authorize`. Unknown paths, generic path forwarding, generic file paths,
  and action response routes shall not exist in F6.
- **REQ-031:** Pairing shall have an empty body. Authorization shall require
  `Content-Type: application/json`, a bounded `Content-Length`, and canonical
  request JSON. `Transfer-Encoding`, `Expect`, duplicate security headers,
  duplicate JSON keys, and unknown JSON fields shall be rejected.
- **REQ-032:** The adapter shall enforce request-line, header count, aggregate
  header, and control-body limits before unbounded allocation. It shall reject
  an incoming request from any socket whose remote address is not exactly
  `127.0.0.1`.
- **REQ-033:** Client disconnect, server stop, timeout, malformed input, and
  size failure shall abort associated streams and release sockets, descriptors,
  counters, and timers. The adapter shall not leave an unbounded queue.
- **REQ-034:** F6 shall not emit permissive CORS headers or use a browser
  origin as authorization. Cross-origin browser integration, if needed, is a
  later consumer decision.

### Resource Limits

- **REQ-035:** F6 shall export one immutable resource-limit profile and shall
  enforce these proposed F6-v1 defaults:

  | Resource | Default |
  | --- | ---: |
  | Maximum preset bytes | 262,144 |
  | Request-line bytes | 8,192 |
  | Header count | 64 |
  | Aggregate request-header bytes | 32,768 |
  | Control JSON body bytes | 65,536 |
  | Aggregate upstream response-header bytes | 32,768 |
  | Maximum upstream response bytes | 4,194,304 |
  | Maximum confined-file bytes | 4,194,304 |
  | Maximum concurrent sessions | 16 |
  | Maximum concurrent operations | 32 |
  | Maximum operations per session | 4 |
  | Maximum DNS addresses | 32 |
  | Bootstrap capability lifetime | 60,000 ms |
  | Session lifetime | 600,000 ms |
  | Connect timeout | 2,000 ms |
  | Response-header timeout | 5,000 ms |
  | Body idle timeout | 10,000 ms |
  | Total operation timeout | 30,000 ms |
  | Maximum redirects | 0 |

- **REQ-036:** Limits shall be checked from declared lengths before buffering
  and enforced again while streaming. Content length shall not be trusted as a
  substitute for byte counting. F6 shall not accept an upstream request body;
  the only inbound body is the bounded control envelope.
- **REQ-037:** Limits shall not be raised by a wire request. A limit violation
  shall abort the operation and produce `runtime.size-limit`,
  `runtime.timeout`, or `runtime.overloaded` as appropriate.

### URL, Method, And Credential Policy

- **REQ-038:** An outbound target shall be an absolute HTTP or HTTPS URL parsed
  with WHATWG `URL`. The canonical target shall have lowercase scheme and
  hostname, canonical IPv4/IPv6 spelling, no default port, and stable pathname
  and query serialization.
- **REQ-039:** F6 shall reject userinfo, fragments, controls, backslashes,
  wildcard hosts, trailing-dot hostnames, zone identifiers, malformed percent
  encoding, empty hosts, invalid ports, raw non-ASCII authority text, and
  unsupported schemes. The canonical hostname shall be lower-case ASCII DNS
  labels or a numeric IP literal. F6-v1 shall restrict outbound ports to 80
  and 443.
- **REQ-040:** Outbound methods shall be exactly the method in the grant. The
  outbound connector shall permit only `GET` and `HEAD`; it shall reject
  `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `CONNECT`, `TRACE`, and custom
  verbs before network access. A confined-file grant never forwards its method
  upstream and still compares it exactly.
- **REQ-041:** F6 shall send no browser cookies, `Authorization`, proxy
  credentials, client certificates, ambient authentication, or caller-supplied
  credential headers. It shall not read credential stores or proxy environment
  variables.
- **REQ-042:** The outbound request header set shall be runtime-controlled.
  `Host` and HTTPS SNI shall be derived from the canonical authorized target;
  `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, proxy headers,
  cookie headers, and authorization headers shall not be caller-controlled.

### SSRF And DNS-Rebinding Controls

- **REQ-043:** DNS resolution shall obtain all A and AAAA answers before any
  connection. The runtime shall reject resolution failure, an empty answer,
  more than 32 answers, or an answer that cannot be classified.
- **REQ-044:** Every answer shall be classified before connection. F6-v1 shall
  reject loopback, unspecified, private, link-local, multicast, carrier-grade
  NAT, documentation, benchmarking, reserved, and otherwise non-public
  addresses. IPv4-mapped IPv6 values shall be classified as their mapped IPv4
  address.
- **REQ-045:** A mixed answer set containing any unsafe address shall reject the
  complete operation; the runtime shall not discard unsafe answers and use a
  remaining public answer.
- **REQ-046:** The connector shall choose one allowed numeric address by a
  documented deterministic ordering, connect directly to that address, and
  preserve the authorized hostname separately for HTTP Host and HTTPS SNI.
- **REQ-047:** The connector shall not perform a second hostname lookup, use
  automatic address racing or happy-eyeballs, retry another address, reuse an
  upstream connection, or consult an HTTP/system proxy. A connector that
  cannot preserve the pinned address shall deny the operation.
- **REQ-048:** DNS answers and selected addresses shall remain in memory only
  for the operation. No DNS cache shall be written to disk or shared between
  unrelated capabilities.

### Redirect, Timeout, And Size Controls

- **REQ-049:** F6 shall never follow an upstream redirect. Statuses 300 through
  399, including a response with `Location`, shall produce
  `runtime.redirect-rejected` and shall not trigger another DNS lookup or
  connection. The `Location` value shall not be exposed.
- **REQ-050:** The outbound connector shall use separate connect, response
  header, body idle, and total operation deadlines. All deadlines shall abort
  the socket and body stream through an `AbortSignal`.
- **REQ-051:** Response headers and body bytes shall be bounded while received.
  No automatic decompression shall occur; an unsupported content encoding shall
  be rejected rather than create an unbounded decompression path.
- **REQ-052:** A response or file that exceeds its byte bound shall be aborted
  without returning partial content as a successful result.

### Confined File Access

- **REQ-053:** A confined-file grant shall contain only a relative logical path
  under a trusted startup-configured root. The wire request shall contain an
  opaque grant identity and exact path equality, not an arbitrary filesystem
  path.
- **REQ-054:** F6 shall reject empty paths, absolute paths, `.` or `..`
  components, encoded traversal, NULs, controls, backslashes or alternate
  separators, drive-qualified paths, UNC/device paths, wildcards, and paths
  that escape the canonical root.
- **REQ-055:** The reader shall anchor the configured root, use no-follow and
  descriptor-relative operations where supported, reject symlink traversal and
  final symlinks, verify a regular file from the opened descriptor, and read
  only from that descriptor. `realpath` alone shall never be treated as
  sufficient confinement.
- **REQ-056:** The reader shall check file size before reading and count bytes
  while reading. It shall reject hard-link or descriptor-identity conditions
  that violate the selected platform policy and shall not reopen a path after
  authorization.
- **REQ-057:** If Node 24 APIs cannot prove the required no-follow,
  descriptor-identity, and root-containment guarantees on a platform, the
  operation shall fail with `runtime.platform-unsupported`; it shall not fall
  back to a race-prone path-only read.
- **REQ-058:** Directories, devices, sockets, symlinks, missing files,
  permission failures, replacement races, and oversized files shall produce
  stable redacted errors. No absolute path or operating-system error wording
  shall be returned.

### Privacy, Diagnostics, And Scope

- **REQ-059:** F6 shall not persist presets, capabilities, sessions, URLs,
  headers, bodies, DNS answers, socket addresses, file paths, file contents,
  credentials, or upstream responses.
- **REQ-060:** F6 shall not log traffic by default. Any caller-supplied
  diagnostic sink must receive only already-redacted lifecycle or counter
  events and must not receive the capability, session value, target, path,
  headers, bodies, addresses, or third-party errors.
- **REQ-061:** Public failures shall use only the stable F6 error-code set and
  deterministic fields. Third-party, Node, resolver, filesystem, and upstream
  error wording shall not be part of the API or wire contract.
- **REQ-062:** F6 shall never return a mock status/header/body/delay action, a
  native-messaging message, a TLS/PAC result, or a request-body transformation.
  It returns an authorization decision or an explicitly bounded primitive
  result only.
- **REQ-063:** F6 shall not expose a catch-all execution route. Every future
  response route must be separately specified and must retain exact grant
  authorization and these limits.

## Public API And Data Contracts

The following is the stable conceptual contract for F6-v1. Exact source module
names may be selected during implementation planning without changing the
requirements or wire behavior.

```ts
import type { HttpMethod } from "@rogatio/schema";
import type { MatcherOperation } from "@rogatio/compiler";

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

export function normalizeRuntimePreset(
  value: unknown,
): RuntimeResult<NormalizedRuntimePreset>;

export function createRuntimeServer(options: {
  readonly preset: NormalizedRuntimePreset;
  readonly fileRoot?: string;
}): Promise<RuntimeResult<RuntimeServer>>;
```

The authorization core also exposes a conceptual exact-decision operation to
the server adapter. Its result is an opaque internal value, not a caller-made
URL or path. The outbound connector and confined reader accept only that value
and an `AbortSignal`; they do not accept arbitrary caller headers, proxy
options, paths, or targets. Their exact stream/result shapes are intentionally
not an HTTP action schema and may be finalized during implementation planning.

## Canonical Preset Format

The canonical internal JSON shape is:

```json
{
  "version": 1,
  "limits": {
    "maxPresetBytes": 262144,
    "maxRequestLineBytes": 8192,
    "maxHeaderCount": 64,
    "maxRequestHeaderBytes": 32768,
    "maxControlBodyBytes": 65536,
    "maxResponseHeaderBytes": 32768,
    "maxResponseBodyBytes": 4194304,
    "maxFileBytes": 4194304,
    "maxConcurrentSessions": 16,
    "maxConcurrentOperations": 32,
    "maxOperationsPerSession": 4,
    "maxDnsAddresses": 32,
    "bootstrapLifetimeMs": 60000,
    "sessionLifetimeMs": 600000,
    "connectTimeoutMs": 2000,
    "responseHeaderTimeoutMs": 5000,
    "bodyIdleTimeoutMs": 10000,
    "operationTimeoutMs": 30000,
    "maxRedirects": 0
  },
  "matchers": [],
  "grants": [
    {
      "groupId": "group-main",
      "ruleId": "rule-fetch",
      "operationId": "operation-fetch",
      "kind": "outbound-http",
      "target": "https://example.com/data",
      "method": "GET"
    }
  ]
}
```

The example omits the F3 matcher only for brevity; a valid preset contains the
matching detached operation. `confined-file` grants use a slash-separated
relative logical path in `target` rather than a URL. The filesystem root is
trusted server configuration and is excluded from digest bytes, but is fixed
for the server lifetime and cannot be supplied over HTTP.

Normalization validates every field, rejects unknown fields and hostile object
shapes, canonicalizes each target, verifies the F3 matcher/grant identity
relationship, sorts grants, freezes the detached result, serializes the fixed
profile, and computes the digest. No F6 preset is a replacement for the F2
`.rogatio.json` document.

## Wire Protocol

The adapter uses JSON only for the two explicitly named control routes.

### Pairing

```http
POST /v1/pair HTTP/1.1
Host: 127.0.0.1:<port>
Content-Length: 0
X-Rogatio-Capability: <base64url-bootstrap-capability>
X-Rogatio-Preset-Digest: sha256:<64 lowercase hex digits>
Connection: close
```

Successful pairing returns `200` with `Cache-Control: no-store`:

```json
{
  "ok": true,
  "protocol": "f6-v1",
  "sessionCapability": "<base64url-session-capability>",
  "expiresInMs": 600000
}
```

The session capability is intentionally returned only to the pairing client;
it is never included in a later error. Pairing cannot be repeated with the
bootstrap capability.

### Authorization decision

```http
POST /v1/authorize HTTP/1.1
Host: 127.0.0.1:<port>
Content-Type: application/json
Content-Length: <bounded length>
X-Rogatio-Session-Capability: <base64url-session-capability>
X-Rogatio-Preset-Digest: sha256:<64 lowercase hex digits>
Connection: close

{"groupId":"group-main","ruleId":"rule-fetch","operationId":"operation-fetch","kind":"outbound-http","target":"https://example.com/data","method":"GET"}
```

The body must be the canonical F6-v1 JSON representation of the exact
descriptor. A successful decision returns only:

```json
{"ok":true,"authorized":true}
```

F6 has no HTTP execution route in this stage. The server-side decision is the
authorization seam consumed by explicitly named in-process primitives and by a
later, separately specified F13 or F14 integration. This prevents F6 from
creating a generic `execute`, proxy, or file-serving endpoint.

### Error serialization and HTTP status

Failures use this fixed shape and contain no message, target, path, header,
body, address, or third-party error text:

```json
{"ok":false,"error":{"code":"runtime.authorization-denied"}}
```

The proposed status mapping is:

| Condition | Status | Code |
| --- | ---: | --- |
| Malformed route, method, headers, transfer, or JSON | 400 | `runtime.request-malformed` |
| Oversized request line or headers | 431 | `runtime.headers-too-large` |
| Oversized control body | 413 | `runtime.body-too-large` |
| Pairing or session authentication failure | 401 | `runtime.pairing-denied` or `runtime.authorization-denied` |
| Exact grant or primitive policy denial | 403 | `runtime.authorization-denied` |
| Unknown route | 404 | `runtime.request-malformed` |
| Timeout | 408 | `runtime.timeout` |
| Concurrency admission failure | 429 | `runtime.overloaded` |
| Internal failure | 500 | `runtime.internal` |

Responses use a fixed JSON content type, `Cache-Control: no-store`, bounded
content length, and `Connection: close`; server-identifying and permissive
headers are omitted. Equivalent failures serialize identically regardless of
Node, OS, DNS, filesystem, or upstream error wording.

## Control Flow And Failure Semantics

### Startup

1. The trusted controller supplies an unknown value for normalization and a
   trusted absolute file root only when file grants exist.
2. F6 validates and snapshots the preset, canonicalizes all targets, verifies
   F3 matcher/grant identity, computes canonical bytes and digest, and freezes
   the policy.
3. F6 generates the bootstrap capability and starts Node HTTP with host fixed
   to `127.0.0.1` and port `0`.
4. The bootstrap result returns host, assigned port, digest, and capability to
   the trusted controller. None is persisted or logged.

If validation or binding fails, startup returns a stable error and no listener
or partially published policy remains.

### Pairing

1. The adapter admits only a bounded HTTP/1.1 `POST /v1/pair` from exact
   `127.0.0.1`.
2. It validates the fixed-format capability and digest headers without doing
   DNS, filesystem, or upstream work.
3. It compares both values in constant time against the server instance and
   atomically consumes the bootstrap capability.
4. It creates a bounded in-memory session with a fresh session capability and
   returns the session value once.

Any failure returns the generic pairing error, closes the request, and reveals
no reason that distinguishes missing, wrong, expired, or consumed credentials.

### Authorization

1. The adapter admits only `POST /v1/authorize`, enforces the control JSON
   limits, and parses only own data from the canonical body.
2. It validates the session capability and preset digest.
3. It canonicalizes the supplied target under the operation kind and compares
   the complete `(groupId, ruleId, operationId, kind, target, method)` tuple to
   one immutable grant.
4. It atomically admits the bounded session operation count.
5. It returns a decision only. No DNS lookup, socket, file open, or body access
   occurs for a denied request.

The exact internal authorization value is the only input accepted by a named
outbound or file primitive. Primitive failures are mapped to stable codes and
never returned as raw dependency errors.

### Shutdown and replacement

`stop()` is idempotent. It stops admission, closes the listener, aborts active
signals, closes descriptors, invalidates capabilities, and clears in-memory
state. Preset replacement is stop-and-recreate only. A failed new startup does
not alter the already-stopped server, and no partially normalized preset is
published.

## Outbound Primitive Rules

The outbound connector is not a proxy. It receives an opaque authorized grant,
has no caller-supplied URL or headers, and performs at most one direct,
non-reused connection.

- Parse and canonicalize only an absolute HTTP(S) target that exactly matches
  the grant.
- Allow only ports 80 and 443 in F6-v1.
- Resolve all A and AAAA answers with `all: true` before connecting.
- Classify every answer, including IPv4-mapped IPv6, and deny any mixed or
  unsafe set.
- Choose one public numeric address deterministically and pass that fixed
  address to the connector; disable automatic address selection, re-resolution,
  proxy environment handling, retries, and pooled agents.
- Set Host and HTTPS SNI from the canonical hostname, not the numeric socket
  address.
- Send only runtime-controlled GET or HEAD requests with no body and no
  browser or proxy credentials.
- Bound response headers and bytes while streaming, request no compression,
  reject unsupported content encoding, and abort on disconnect or deadline.
- Treat all 3xx responses as data that causes `runtime.redirect-rejected`; do
  not parse or follow Location.

## Confined File Primitive Rules

The confined reader is not a file server. It receives an opaque authorized file
grant and returns bounded bytes only to its intended in-process consumer.

- Validate a slash-separated relative logical path before platform conversion.
- Reject traversal, empty/dot components, alternate separators, absolute or
  device syntax, NUL/control values, wildcards, and encoded ambiguity.
- Open relative to a startup-anchored root using no-follow descriptor operations
  for every component where the platform supports them.
- Verify the opened descriptor is a regular file and satisfies the platform's
  identity/link policy. Read from the same descriptor; never reopen the path.
- Enforce the 4 MiB bound before and during the read and abort on replacement,
  descriptor, or size failure.
- Return `runtime.platform-unsupported` when the Node/OS combination cannot
  prove these guarantees. A `realpath` check without descriptor protection is
  not an accepted fallback.

## Security, Privacy, And Operations

- Capability and session values are high-entropy, fixed-format, memory-only,
  and never placed in URLs or diagnostics. Digest and capability comparisons
  are timing-safe.
- The loopback address is transport scope only; all authorization still
  requires the paired capability, digest, and exact grant.
- F6 has no credentials, cookies, proxy settings, TLS interception, browser
  permission, or ambient authentication behavior.
- F6 performs no persistent caching, traffic history, telemetry, audit log, or
  body retention. The only transient data is bounded in-memory operation data.
- All public diagnostic fields are stable and deterministic. No third-party
  exception wording is serialized.
- The fixed limit profile bounds input, headers, concurrency, DNS answers,
  response/file bytes, and every operation phase. Abort paths release all
  resources.
- The implementation must use explicit Node built-ins and review any new
  dependency or install-script permission before adding it.

## Compatibility, Migration, And Rollback

- F6 does not modify the version-1 `.rogatio.json` schema and introduces no
  migration for existing files.
- The runtime preset and wire protocol are independently versioned as
  `f6-v1`. A future canonicalization, grant, or protocol change requires a new
  version or digest-breaking contract; it must not silently reinterpret an old
  digest.
- F2 and F3 remain source-of-truth packages. F6 consumes their data but does
  not add action fields or change their validation semantics.
- A process restart invalidates all capabilities and sessions. There is no
  restart recovery or state migration.
- Rollback is removal of the private runtime package and its build/validation
  references. Because no runtime state is persisted, rollback leaves no
  session, credential, traffic, or file-access artifact.
- The package and protocol core are cross-platform Node 24 code. Confined-file
  behavior is feature-gated by a documented platform proof rather than
  advertised as equivalent on every operating system.

## Verification Obligations

The implementation stage must map tests and manual checks to the criteria
below. This section defines future proof obligations; it does not add tests in
the current Stage 3 worktree.

### Preset and authorization

- **AC-001:** A valid version-1 preset containing a matching F3 matcher and an
  outbound or confined-file grant normalizes to detached immutable data and a
  `sha256:` digest.
- **AC-002:** Repeated normalization and normalization of equivalent object
  insertion orders produce identical canonical bytes and digests; changing any
  grant, matcher, target, kind, method, or included limit changes the digest.
- **AC-003:** Capabilities, sessions, timestamps, and the configured file root
  do not occur in canonical preset bytes.
- **AC-004:** Cycles, sparse arrays, inherited properties, accessors, proxies,
  symbols, unknown fields, unsupported numeric values, malformed targets, and
  over-limit presets fail without invoking accessors, doing I/O, or mutating
  input.
- **AC-005:** A grant with a missing or duplicate matcher identity, duplicate
  operation ID, wildcard target, or unknown operation kind fails closed.
- **AC-006:** A valid exact descriptor authorizes only the one matching grant;
  changing any tuple member, digest, session capability, or primitive kind
  denies it without a DNS lookup, socket, filesystem open, or body exposure.
- **AC-007:** The bootstrap capability pairs successfully once, returns a
  session capability, and cannot pair a second time; expired, malformed,
  wrong-server, or wrong-digest values return generic stable denial.
- **AC-008:** Session expiry and `stop()` invalidate all later authorization;
  no capability or session state survives in memory after cleanup.

### HTTP adapter and limits

- **AC-009:** A started server reports host exactly `127.0.0.1`, uses an
  assigned ephemeral port, and refuses any non-loopback bind configuration.
- **AC-010:** Correct pairing and authorization requests receive the exact
  documented success envelopes; all responses close the connection and do not
  include permissive CORS, server-identifying, or cacheable headers.
- **AC-011:** Unknown paths, generic proxy/file paths, wrong route methods,
  HTTP/1.0, absolute-form targets, `*`, `CONNECT`, `Upgrade`, pipelining,
  `Transfer-Encoding`, `Expect`, duplicate security headers, noncanonical JSON,
  duplicate JSON keys, and unknown fields are rejected before side effects.
- **AC-012:** Request-line, header-count, aggregate-header, and control-body
  boundaries are enforced before unbounded allocation and produce the stable
  size/protocol codes.
- **AC-013:** Exceeding concurrency limits is rejected without an unbounded
  queue; client disconnect, stop, timeout, and malformed-input paths release
  every operation slot, timer, stream, socket, and descriptor.
- **AC-014:** Equivalent malformed or denied requests produce deterministic
  error JSON independent of Node, OS, resolver, filesystem, and upstream error
  wording, with no sensitive value echoed.

### Outbound network

- **AC-015:** An explicitly authorized public HTTP or HTTPS GET/HEAD target can
  use one direct connection to a selected numeric address while preserving the
  authorized Host/SNI name.
- **AC-016:** Userinfo, fragments, controls, backslashes, wildcard hosts,
  invalid ports, non-HTTP(S) schemes, ambiguous encodings, disallowed ports,
  unsupported methods, caller credentials, and caller proxy headers are
  rejected before network access.
- **AC-017:** Loopback, unspecified, private, link-local, multicast,
  carrier-grade, documentation, benchmarking, reserved, IPv4-mapped-private,
  and otherwise non-public results are denied. A mixed public/unsafe answer set
  is denied as a whole.
- **AC-018:** DNS failure, empty or excessive answers, re-resolution, automatic
  address racing, proxy environment configuration, connection retry, and
  inability to preserve the pinned numeric address fail closed.
- **AC-019:** A redirect status or Location response is rejected without parsing
  or following its target, without another DNS lookup, and without exposing the
  Location value.
- **AC-020:** Connect, response-header, body-idle, total-operation, response
  header, and response-byte bounds abort work and do not return partial data as
  a successful result. Unsupported content encoding is rejected.

### Confined filesystem

- **AC-021:** On a platform with the documented descriptor/no-follow proof, an
  approved regular file beneath the configured root can be read within the
  4 MiB bound from one opened descriptor.
- **AC-022:** Empty, absolute, traversal, encoded traversal, alternate
  separator, drive, UNC/device, NUL/control, wildcard, and root-escaping paths
  fail without opening an unauthorized path.
- **AC-023:** Symlinked components, final symlinks, directories, devices,
  sockets, hard-link/identity violations, missing files, and permission errors
  fail with stable redacted codes and no absolute path or OS wording.
- **AC-024:** Replacing or growing a file after authorization cannot cause an
  outside-root read; the reader uses the already verified descriptor and aborts
  on an identity or size violation.
- **AC-025:** A platform lacking proven no-follow and descriptor identity
  guarantees reports `runtime.platform-unsupported` rather than using a
  `realpath`-only fallback.

### Privacy, package, and scope

- **AC-026:** A complete server lifecycle leaves no persisted preset,
  capability, session, URL, header, body, DNS, socket, path, credential, or
  response data and emits no traffic log by default.
- **AC-027:** The package manifest has only the two declared workspace product
  dependencies, the build emits a Node ESM artifact, and root format, lint,
  strict typecheck, build, package tests, and canonical validation remain
  authoritative.
- **AC-028:** Scope inspection proves F6 contains no F13 mock action/status/
  header/body/delay behavior and no F14 native-messaging, TLS/PAC, process,
  request-body, or response-body transformation behavior.

## Alternatives And Decisions

- **Policy core plus thin adapter, selected:** Pure normalization,
  authorization, URL/address policy, and file policy are testable without
  sockets. The adapter owns only transport and bounded stream mechanics.
- **Monolithic server, rejected:** It couples untrusted HTTP parsing to policy
  and makes it too easy for later consumers to depend on server internals.
- **General localhost forward proxy, rejected:** It would make loopback a
  false security boundary and create unrestricted SSRF, credential, and
  redirect surfaces.
- **Catch-all execute or file endpoint, rejected:** F6 returns an authorization
  decision and explicit primitive results only; action response routes belong to
  later specifications.
- **One-use bootstrap plus reusable short-lived session, selected:** Pairing
  material cannot be replayed, while repeated read-only authorization requests
  do not require a browser-visible capability minting round trip. A future
  side-effecting operation must define its own replay policy.
- **Per-operation capability for all F6 requests, deferred:** It adds another
  transport round trip and is not needed for the read-only foundation. It must
  be reconsidered before any side-effecting operation is added.
- **Stop-and-recreate policy lifecycle, selected:** It gives each digest one
  immutable server identity and avoids partial hot reloads or watcher races.
- **Follow-and-reauthorize redirects, rejected:** F6 has no need for a second
  DNS and authorization decision; rejecting all redirects is narrower and
  avoids a second TOCTOU surface.
- **Default `fetch`/proxy client, rejected:** The connector needs explicit
  numeric-address pinning, no proxy environment, no address racing, no retries,
  and no automatic decompression.
- **`realpath`-only file confinement, rejected:** It does not prove no-follow
  traversal or eliminate replacement races. Unsupported platforms deny access.
- **Full RFC 8785 dependency, deferred:** The F6 preset is a closed internal
  profile with fixed fields and no arbitrary JSON. A versioned local profile
  avoids a dependency solely for serialization; adopting JCS later would be a
  digest-version decision.

## Assumptions And Open Questions

The following are proposed for Stage 4 approval and must not be silently
changed during implementation:

1. The bootstrap capability is one-use, the returned session capability is
   reusable for read-only authorization, and both expire with the stated
   lifetimes.
2. F6-v1 restricts outbound ports to 80 and 443, rejects raw non-ASCII
   authority text and trailing-dot hostnames, and accepts lower-case ASCII
   hostnames or numeric IP literals after WHATWG normalization. A later
   version may decide whether to widen Unicode hostname support.
3. The public-address denylist will be implemented from an explicit, reviewed
   IPv4/IPv6 special-use table. The exact table version and treatment of newly
   assigned ranges need confirmation.
4. The exact Linux, macOS, and Windows confined-file support matrix needs
   confirmation. F6 must not add a native helper or claim race-resistant
   support where Node 24 cannot prove it.
5. The fixed F6-v1 resource limits above are proposed defaults. A human should
   confirm the memory, concurrency, timeout, and 4 MiB response/file tradeoff.
6. F6 exposes only pairing and authorization HTTP routes. F13 or F14 must
   separately approve any route that turns an authorized decision into a
   response or transformation.
7. F6 emits no CORS headers. The later extension integration must decide how a
   Chrome extension performs the user-triggered pairing without weakening the
   loopback and capability boundary.
8. The closed canonical JSON profile, rather than RFC 8785, is the F6-v1
   digest contract. Any change requires a new digest/version decision.

## Stage 4 Gate

This specification is proposed only. No implementation plan, tests, production
code, commit, push, pull request, merge, or worktree cleanup is authorized by
this document. Implementation may begin only after explicit human approval of
this specification and the F6 architecture decisions in `docs/architecture.md`.
