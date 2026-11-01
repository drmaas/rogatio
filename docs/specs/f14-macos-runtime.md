# F14 - Native-Messaging Runtime

**Status:** Proposed specification, Stage 3; pending Stage 4 human approval
**Feature:** F14
**Depends on:** F2, F3 (early start allowed; no F4-F13 dependency)
**Packages:** Private Node ESM `@rogatio/runtime`, `@rogatio/cli`
**Protocol:** `f14-v1` (native-messaging control channel)

> **Platform boundary (revised):** Activation is **capability-based**, not
> OS-hard-gated. The runtime activates wherever it can provision a trusted
> device-local CA and use Chrome PAC routing *without colliding with an
> existing controlling proxy, PAC, extension, or enterprise policy*. macOS is
> the reference supported platform; Linux/Windows may also activate when those
> capabilities are present. This revises the macOS-only wording in
> `rogatio-overview.md`.

## Problem Statement And Goals

Rogatio response-body and request-body rules need a separately installed native
runtime that the Chrome extension reaches through native messaging. The runtime
must own request-body/response-body transformation routing and the capability-gated
network interception (scoped Chrome PAC/proxy routing, an ephemeral TLS proxy,
and a device-local CA). Because the browser grant is not itself a security
boundary, the runtime must independently revalidate project, rule, URL, method,
initiator, target, permission, and grant authority against the canonical
`.rogatio.json` before acting. Observed bodies must never be persisted, logged,
exported, or transferred across the native-messaging boundary.

F14 establishes the runtime control surface, lifecycle, native-messaging control
protocol, independent authority revalidation, and the macOS-gated network
interception boundary. It does not implement the F15/F16/F17 rule behaviors,
only the runtime they depend on.

## Scope And Non-Goals

### In scope

- A `rogatio runtime` CLI control command with explicit `start`, `stop`,
  `status`, and `--help` subcommands.
- A `NativeRuntimeController` in `@rogatio/runtime` with a guarded lifecycle
  (`stopped` → `starting` → `started` → `stopping` → `stopped`) and idempotent
  `stop()`.
- An `f14-v1` native-messaging control-channel envelope (JSON over a host
  pipe): `start`, `stop`, `status`, `authorize`, and bounded
  `transform-request` / `transform-response` intents carrying metadata only.
- Independent authority revalidation (`revalidateAuthority`) that re-derives
  from the validated F2 project and compiled F3 operations whether an incoming
  transformation request still has authority, denying before any body work.
- A hard boundary proving observed bodies are never persisted, logged,
  exported, or placed in the native-messaging envelope; the channel carries
  only bounded metadata (group/rule/url/method/status), never request or
  response body bytes.
- Scoped Chrome PAC script generation (deterministic pure function) for routing
  only the granted origins to the runtime's ephemeral proxy.
- Capability-based activation gate: live network interception (TLS proxy,
  device-local CA trust installation) activates only where the runtime can
  provision a trusted device-local CA and use Chrome PAC routing without
  colliding with an existing controlling proxy, PAC, extension, or enterprise
  policy. The control surface and revalidation remain fully functional and
  unit-tested on every supported OS; `start` reports activation as `unsupported`
  only when the capability checks fail.
- Stable error categories, deterministic envelopes, and explicit resource limits.
- Unit, integration, and package-boundary verification obligations.

### Explicit non-goals

- F15 response-body rule behavior, F16 request-body trust lifecycle, F17
  request-body rule behavior. F14 provides the runtime; those rule slices remain
  separately specified.
- The Chrome extension-side native-messaging client. F7 owns extension shell;
  F14 defines the native side and its protocol so F7/F15/F17 can integrate.
- Live device-local CA trust installation and a fully exercised TLS-intercepting
  proxy require a platform where the runtime can provision a trusted CA into the
  OS/browser trust store and where Chrome PAC routing does not collide with an
  existing controlling proxy/PAC/enterprise policy. When those capabilities are
  absent or denied, F14 reports `unsupported` and performs no interception; the
  live interception is scaffolding for F15/F17, not a verified behavior in every
  environment.
- Mock (F13) actions, redirect/query/header (F9-F11) actions, persistence,
  telemetry, hosted endpoints, or traffic history.
- A general forward proxy or file server. The runtime intercepts only the
  explicitly granted origins through the scoped PAC; it is never a catch-all
  proxy.

F14 revalidates a request by re-deriving authority from the canonical project.
It does not trust the browser's grant, rule label, priority, regex result,
origin prefix, or most-specific match as sufficient authority.

## Actors And Environments

### Actors

- **CLI operator:** runs `rogatio runtime start|stop|status`. Activation is
  capability-based; control parsing, revalidation, PAC generation, and status work
  cross-platform.
- **Chrome extension (native-messaging client):** connects to the host pipe and
  sends bounded control/authorization intents. Untrusted merely because it can
  reach the pipe.
- **Native runtime host process:** the macOS binary/Node process spawned by the
  native-messaging host; owns the lifecycle, revalidation, and (on macOS) the
  interception.
- **Runtime policy core:** owns revalidation, lifecycle, envelope
  authorization, body-exclusion guarantee, limits, and deny-by-default.
- **Network interception module (macOS-gated):** owns scoped PAC routing,
  ephemeral TLS proxy, and device-local CA; not reached on unsupported platforms.
- **Upstream server / observed body:** untrusted; body bytes stay in-process.

### Threat model

A process that can open the native-messaging pipe, or a request forged by a
compromised extension, is in scope. The runtime must independently revalidate
every transformation request against the canonical project and must not act on a
request whose rule, origin, method, initiator, target, or grant no longer has
authority. Observed bodies must not escape the process via logs, files, the
native-messaging envelope, or upstream. A remote attacker is not expected to
reach the loopback/local pipe directly; authorization is still required.

The runtime must not treat a browser grant, a rule name, a URL hostname, a
successful regex match, or an initiator string as sufficient authority.

### Supported baseline

- Node.js `>=24`, TypeScript 7, ESM, NodeNext.
- Linux, macOS, Windows for the control surface, revalidation, PAC generation,
  envelope, and lifecycle.
- Activation of live network interception is capability-based: it proceeds where
  the runtime can provision a trusted device-local CA and use Chrome PAC routing
  without colliding with an existing controlling proxy/PAC/extension/enterprise
  policy. macOS is the reference supported platform; Linux/Windows may also
  activate when those capabilities are present. When they are absent or denied,
  `start` reports `unsupported` and performs no interception.
- Implemented with Node `node:` built-ins plus `@rogatio/schema` and
  `@rogatio/compiler`. No proxy framework, TLS library, or native-messaging
  dependency is added for F14 control/revalidation.

## Functional And Security Requirements

### Package And Boundaries

- **REQ-001:** `@rogatio/runtime` shall add F14 control, lifecycle,
  revalidation, envelope, and interception-gate modules without altering F2/F3
  or adding F13/F15/F16/F17 behavior.
- **REQ-002:** Product dependencies remain `@rogatio/schema` and
  `@rogatio/compiler`; Node functionality uses built-in `node:` modules. No new
  runtime proxy, TLS, native-messaging, or framework dependency is added.
- **REQ-003:** APIs accepting `unknown` structured values shall reject inherited
  properties, accessors, proxies, sparse arrays, cycles, symbols, unknown
  fields, and malformed data without invoking untrusted getters or iterators.
- **REQ-004:** The CLI `rogatio runtime` command shall implement `start`,
  `stop`, `status`, and `--help`; the prior stub shall be replaced.

### Runtime Lifecycle And Control

- **REQ-005:** The controller shall expose explicit `start`, `stop`, and
  `status`. `start` is the only path that may begin network interception.
- **REQ-006:** Lifecycle states shall be guarded: `stopped → starting →
  started → stopping → stopped`. Illegal transitions (e.g. `starting`→`stopped`
  without `stopping`) shall be rejected or coerced deterministically.
- **REQ-007:** `stop()` shall be idempotent: repeated or pre-start `stop()`
  returns success without error and releases no double resources.
- **REQ-008:** `start()` shall run capability detection. When provisioning a
  trusted device-local CA or Chrome PAC routing is impossible or collides with an
  existing controlling proxy/PAC/extension/enterprise policy, it shall transition
  to a terminal `unsupported` activation state, perform no interception, and
  return a stable `runtime.unsupported` result; it shall not throw an uncontrolled
  error. The check is capability-based, not OS-name-based, so a non-macOS platform
  with the required capabilities may still activate.
- **REQ-009:** `status` shall report the current lifecycle/activation state and
  whether interception is active; it shall not echo capabilities, pipe paths,
  URLs, bodies, or third-party error text.
- **REQ-010:** Stopping shall invalidate in-memory session/authorization state,
  close the host pipe, abort active transforms, and release timers. No runtime
  or traffic state shall be persisted.

### Native-Messaging Control Envelope

- **REQ-011:** The control channel shall speak a versioned `f14-v1` JSON
  envelope with a fixed shape: `{ "protocol": "f14-v1", "intent": <name>,
  "requestId": <string>, "payload": <bounded object> }`.
- **REQ-012:** Allowed intents for F14 are exactly `start`, `stop`, `status`,
  `authorize`, `transform-request-meta`, and `transform-response-meta`. Unknown
  intents are rejected with a stable error.
- **REQ-013:** `authorize` carries only the revalidation context metadata
  (groupId, ruleId, url, method, initiator, resourceType, target); it shall
  carry no request or response body bytes.
- **REQ-014:** Serialization of any envelope shall never include body bytes,
  credentials, headers' sensitive values, file contents, or observed traffic. A
  structural test shall prove body content is absent from every serialized
  envelope.
- **REQ-015:** Envelope size shall be bounded (≤ F14 control-body limit); oversize
  or malformed envelopes are rejected before side effects.

### Independent Authority Revalidation

- **REQ-016:** `revalidateAuthority(context)` shall independently re-derive
  authority from the validated F2 project and compiled F3 operations for the
  incoming request, returning an explicit allow/deny decision with a stable
  reason code. It shall not trust a browser-supplied grant boolean.
- **REQ-017:** Revalidation shall AND the following: the rule exists
  (groupId+ruleId present in the project); the rule kind is a supported body
  type when present; the request URL matches the rule's compiled `urlRegex`;
  the request origin is within the rule's effective origins; the request
  `method` matches the rule's method when the rule specifies one; the
  `resourceType` is in the rule's resource types; and the `target` origin is
  within the rule's effective origins. Any failure denies.
- **REQ-018:** Revalidation shall complete before any body transformation,
  proxy connection, or native-messaging transform intent is honored. A denied
  request shall not trigger interception or expose a body oracle.
- **REQ-019:** The revalidation decision shall be deterministic and independent
  of third-party wording, iteration order, or ambient state. Equivalent inputs
  yield identical decisions.
- **REQ-020:** Initiator scope shall be checked: the request `initiator` origin
  must be within the rule's granted origins; an initiator outside granted scope
  denies.

### Body Confidentiality Boundary

- **REQ-021:** Observed request/response bodies shall never be written to disk,
  logs, the native-messaging envelope, upstream, or any retained buffer beyond
  the in-process transform operation.
- **REQ-022:** Transform intents (`transform-request-meta`,
  `transform-response-meta`) shall carry only bounded metadata and the transform
  *instruction*; the actual body bytes are processed in-process by the runtime
  and are not placed on the wire.
- **REQ-023:** A diagnostic sink, if present, shall receive only redacted
  lifecycle/counter events, never bodies, URLs' sensitive parts, capabilities,
  or third-party errors.

### Scoped PAC And Network Interception (capability-gated)

- **REQ-024:** PAC script generation shall be a deterministic pure function of
  the granted origin set and the proxy endpoint, returning a fixed-format PAC
  that routes only those origins to the runtime proxy and sends all other
  traffic direct. No other origin shall be proxied.
- **REQ-025:** Live interception (ephemeral TLS proxy, device-local CA) shall
  be reached only after a successful capability-based activation. When the
  required capabilities are absent, the interception module returns
  `runtime.unsupported` and performs no socket or certificate work, regardless of
  the OS name.
- **REQ-026:** The interception module shall be structured so F15/F17 can supply
  transform handlers without changing the revalidation or envelope contracts.

### Resource Limits

- **REQ-027:** F14 shall export one immutable control-limit profile:

  | Resource | Default |
  | --- | ---: |
  | Control envelope bytes | 65,536 |
  | Envelope count per session | 1,024 |
  | Max concurrent transforms | 32 |
  | Revalidation timeout | 5,000 ms |
  | Max granted origins in PAC | 256 |

- **REQ-028:** Limits shall be checked before allocation and again while
  streaming; a violation aborts the operation with a stable code.

### Privacy, Diagnostics, And Scope

- **REQ-029:** F14 shall not persist projects, grants, capabilities, URLs,
  headers, bodies, PAC content, or interception state. Lifecycle is in-memory.
- **REQ-030:** Public failures shall use only the stable F14 error-code set and
  deterministic fields; third-party/Node wording shall not be in the contract.
- **REQ-031:** F14 shall never return a mock action, a redirect/query/header
  action, or any response-body/request-body transform result through the control
  envelope; it returns an authorization/lifecycle decision and bounded metadata
  only.

## Public API And Data Contracts

```ts
export type RuntimeActivation = "stopped" | "starting" | "started" | "stopping" | "unsupported";

export interface RuntimeStatus {
  readonly activation: RuntimeActivation;
  readonly interceptionActive: boolean;
  readonly platform: "darwin" | "linux" | "win32" | string;
}

export interface AuthorityContext {
  readonly project: unknown;          // validated F2 RogatioProject
  readonly operation: unknown;        // compiled F3 MatcherOperation for group/rule
  readonly request: {
    readonly url: string;
    readonly method: string;
    readonly initiator: string;       // origin
    readonly resourceType: string;
    readonly target: string;          // resolved upstream URL
  };
}

export type AuthorityDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AuthorityDenyReason };

export type AuthorityDenyReason =
  | "rule-not-found"
  | "url-mismatch"
  | "origin-denied"
  | "method-denied"
  | "resource-type-denied"
  | "initiator-denied"
  | "target-denied"
  | "invalid-context";

export function revalidateAuthority(context: unknown): AuthorityDecision;

export interface NativeRuntimeController {
  start(): Promise<RuntimeResult<RuntimeStatus>>;
  stop(): Promise<RuntimeResult<RuntimeStatus>>;
  status(): RuntimeStatus;
}

export function createNativeRuntimeController(options: {
  readonly platform?: NodeJS.Platform;
  readonly clock?: () => number;
}): NativeRuntimeController;

export function generatePacScript(origins: readonly string[], proxyEndpoint: string): string;

export type F14ErrorCode =
  | "runtime.invalid-context"
  | "runtime.authorization-denied"
  | "runtime.unsupported"
  | "runtime.platform-unsupported"
  | "runtime.envelope-too-large"
  | "runtime.invalid-envelope"
  | "runtime.overloaded"
  | "runtime.timeout"
  | "runtime.internal";
```

## Control Envelope

```json
{ "protocol": "f14-v1", "intent": "authorize", "requestId": "r1",
  "payload": { "groupId":"g","ruleId":"r","url":"https://x.test/a","method":"POST",
               "initiator":"https://x.test","resourceType":"xmlhttprequest",
               "target":"https://x.test/a" } }
```

A successful `authorize` returns only `{"ok":true,"authorized":true}`. A denied
`authorize` returns `{"ok":false,"error":{"code":"runtime.authorization-denied"}}`
with no reason echoed to the untrusted client. The deny reason is available only
to the in-process policy core for diagnostics.

## Canonical PAC Generation

`generatePacScript(origins, proxyEndpoint)` returns a fixed template:

```javascript
function FindProxyForURL(url, host) {
  const granted = ["x.test","y.test"];
  for (const o of granted) { if (host === o || host.endsWith("." + o)) return "PROXY <endpoint>"; }
  return "DIRECT";
}
```

Origins are emitted deterministically (sorted, lower-cased, de-duplicated). No
other host is proxied.

## Verification Obligations

### Lifecycle and control

- **AC-001:** `rogatio runtime --help` prints usage; `status` before start
  reports `stopped`; `start` then `status` reflects the activation; `stop`
  returns to `stopped`.
- **AC-002:** `stop()` is idempotent across pre-start and repeated calls.
- **AC-003:** When capability provisioning fails (no trusted CA provisioning,
  Chrome PAC unavailable, or a conflicting controlling proxy/PAC/enterprise
  policy detected), `start` reports `unsupported` activation, performs no
  interception, and returns a stable `runtime.unsupported` result without an
  uncontrolled throw — independent of the OS name. On a platform where the
  capabilities succeed, activation proceeds.
- **AC-004:** Illegal lifecycle transitions are coerced or rejected
  deterministically; no resource is double-freed.

### Envelope and body boundary

- **AC-005:** A well-formed `f14-v1` `authorize` envelope with valid metadata
  authorizes; unknown intents, oversize, or malformed envelopes are rejected
  before side effects.
- **AC-006:** A structural test proves body bytes, credentials, headers' values,
  and file contents are never present in any serialized envelope, including
  `authorize` and the transform-meta intents.
- **AC-007:** Equivalent envelopes serialize identically regardless of input
  object key order; unknown fields are rejected.

### Independent revalidation

- **AC-008:** A request whose rule, URL regex, origin, method, resource type,
  initiator, and target all match the canonical project is allowed.
- **AC-009:** Changing any of rule existence, URL match, origin membership,
  method, resource type, initiator scope, or target origin denies with the
  correct stable reason; revalidation never trusts a supplied grant boolean.
- **AC-010:** Revalidation completes before any body work; a denied request does
  not trigger interception or a body oracle.
- **AC-011:** Malformed, proxy, cycle, sparse, inherited-property, accessor, or
  symbol-laden context fails with `runtime.invalid-context` without invoking
  untrusted accessors or doing I/O.

### PAC and interception gate

- **AC-012:** `generatePacScript` routes only the exact granted origins (and
  their subdomains) to the proxy; all other hosts return `DIRECT`; output is
  deterministic for the same inputs.
- **AC-013:** The interception module returns `runtime.unsupported` and performs
  no socket/certificate work whenever the required capabilities are absent,
  regardless of OS; it is reachable only after a successful capability-based
  activation.

### Privacy, package, and scope

- **AC-014:** A full lifecycle leaves no persisted project, grant, capability,
  URL, header, body, PAC, or interception artifact and emits no traffic log.
- **AC-015:** The runtime package and CLI build as Node ESM; root format, lint,
  strict typecheck, build, package tests, and canonical validation remain
  authoritative.
- **AC-016:** Scope inspection proves F14 contains no F15/F16/F17 rule behavior,
  no F13 mock action, no redirect/query/header action, no persistence, and no
  general proxy.

## Alternatives And Decisions

- **Guarded lifecycle + idempotent stop, selected:** mirrors browser-core's
  runtime-phase model; avoids partial-start leaks.
- **Revalidation re-derives from canonical project, selected:** the browser grant
  is not a security boundary; independent re-derivation prevents stale/forged
  grants from acting.
- **Envelope carries metadata only, selected:** bodies stay in-process; this is
  the core confidentiality guarantee and makes the native channel auditable.
- **PAC generated as a pure function, selected:** deterministic, testable, and
  safe to unit-test off macOS; live interception remains macOS-gated.
- **General forward proxy, rejected:** would make loopback/grant a false
  boundary and create unrestricted interception.
- **Trust browser grant as authority, rejected:** the runtime must independently
  revalidate.
- **Persist interception/capability state, rejected:** no traffic history, no
  retained authority.

## Assumptions And Open Questions

1. F14 activation is **capability-based**, not OS-hard-gated: it proceeds where a
   trusted device-local CA can be provisioned and Chrome PAC routing does not
   collide with an existing controlling proxy/PAC/extension/enterprise policy.
   macOS is the reference supported platform; Linux/Windows may also activate.
   This revises the macOS-only wording in `rogatio-overview.md`.
2. Body-rule kinds (response-body, request-body) are not yet in the F2 schema;
   F14 revalidation is generic over the rule's matcher/origins/method and will
   narrow to body kinds when F15/F17 add them. Confirm F14 should not add schema
   body-rule types itself.
3. Device-local CA trust installation and the live TLS proxy are macOS-native and
   cannot be executed/verified in Linux CI; F14 ships the gated module and PAC
   generation, with live interception deferred to F15/F17 execution on macOS.
4. The F14 control-body limit and concurrency defaults are proposed; confirm the
   tradeoff.
5. The native-messaging host registration (manifest + allowed-origins) is owned
   by F7/F15/F17 extension integration; F14 defines only the native protocol.

## Stage 4 Gate

This specification is proposed only. No implementation plan, tests, production
code, commit, push, pull request, merge, or worktree cleanup is authorized by
this document. Implementation may begin only after explicit human approval of
this specification and the F14 architecture decisions in `docs/architecture.md`.
