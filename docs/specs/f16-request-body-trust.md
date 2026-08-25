# F16 - Request-Body Trust Lifecycle

**Status:** Proposed specification, Stage 3; pending Stage 4 human approval
**Feature:** F16
**Depends on:** F14 (REP-001)
**Packages:** Private Node ESM `@rogatio/runtime`, `@rogatio/cli`
**Protocol:** `f16-v1` (trust-lifecycle control surface; reuses `f14-v1` envelope shape where applicable)

## Problem Statement And Goals

Request-body interception (F17) needs two device-level trust artifacts before any
network interception can occur: (1) a Chrome native-messaging host registration so the
extension can reach the runtime, and (2) a device-local CA trusted by the OS/browser so
the runtime's ephemeral TLS proxy is trusted. These are persistent, device-scoped facts
that must be managed explicitly and independently of the per-session runtime lifecycle
that F14 owns via `start`/`stop`/`status`.

F16 establishes the trust lifecycle: `rogatio runtime install | status | trust |
untrust | uninstall`. It installs and removes the native-messaging host manifest,
provisions and removes the device-local CA trust, reports the current standing, and is
capability-gated exactly like F14. It does not implement F15/F17 rule behavior, only the
trust surface those slices pre-condition.

## Scope And Non-Goals

### In scope

- A `createRequestBodyTrustController` in `@rogatio/runtime` with explicit
  `install()`, `uninstall()`, `trust()`, `untrust()`, `status()` and idempotency.
- A `rogatio runtime install | status | trust | untrust | uninstall` CLI surface on the
  existing `runtime` command, replacing the prior `start`/`stop`/`status`-only help.
- A pure `generateNativeMessagingManifest(hostPath, name, allowedOrigins)` producing a
  fixed-shape, deterministic manifest with no secrets.
- A capability gate `detectTrustCapabilities()` reporting whether host-manifest install
  and CA-trust install are possible; capability-based, not OS-name-based.
- Stable error categories, deterministic output, and explicit resource limits.
- Unit, integration, and package-boundary verification obligations.

### Explicit non-goals

- F15 response-body rule behavior, F17 request-body rule behavior, F14 runtime
  start/stop/status. F16 manages device trust only; the running runtime and the rule
  transforms remain in F14/F17.
- Persisting trust state in `.rogatio.json` or any project file. Trust is device-local.
- Reading, writing, logging, or transmitting request/response bodies. F16 never contacts
  upstream and never touches body bytes.
- Auto-install or auto-trust on `runtime start`; trust is an explicit user action.
- A general forward proxy, file server, or any F6/F13 behavior.

## Actors And Environments

### Actors

- **CLI operator:** runs `rogatio runtime install | status | trust | untrust |
  uninstall`. Control parsing, manifest generation, capability detection, and status
  work cross-platform; `install`/`trust` perform filesystem/trust-store writes only where
  the capabilities exist.
- **Trust controller (`@rogatio/runtime`):** owns manifest emission, capability gate,
  CA trust install/removal, idempotency, and the stable error set.
- **Chrome extension (future client):** benefits from an installed manifest so native
  messaging can reach the host; F16 does not implement the extension side (owned by F7).
- **OS trust store:** untrusted boundary; CA trust is installed through OS tooling, not
  by Rogatio writing directly into the store's private internals.
- **Device-local CA:** generated and confined to an install root; private key never
  leaves the install root and never enters the native-messaging envelope.

### Threat model

A process that can run `rogatio runtime` can install a manifest and trust a CA on the
device. That is by design an explicit, local, user-initiated action; F16 does not widen
it beyond device-local scope. The manifest must not encode secrets or executable
content; the host `path` must be absolute and confined to an expected install root before
the manifest is written. The CA is device-local and self-signed; it must never be
exported, logged, or placed on the wire. `status` must not leak the manifest path, host
path, CA material, or third-party tooling text to an untrusted reader.

### Supported baseline

- Node.js `>=24`, TypeScript 7, ESM, NodeNext.
- Linux, macOS, Windows for control parsing, manifest generation, capability detection,
  and `status`. `install`/`trust` write to device-local locations only where the
  platform/config capabilities exist; otherwise they report `trust.unsupported`.
- Implemented with Node `node:` built-ins plus `@rogatio/runtime`/`@rogatio/cli`. No new
  dependency is added for F16 trust control.

## Functional And Security Requirements

### Package And Boundaries

- **REQ-001:** `@rogatio/runtime` shall add F16 trust, manifest-generation, capability,
  and controller modules without altering F14 start/stop/status or adding F15/F17
  behavior.
- **REQ-002:** Product dependencies remain `@rogatio/schema` and `@rogatio/compiler`
  where needed for types; F16 adds no new runtime, proxy, TLS, native-messaging, or
  framework dependency.
- **REQ-003:** APIs accepting `unknown` structured values (manifest inputs, capability
  inputs) shall reject inherited properties, accessors, proxies, sparse arrays, cycles,
  symbols, unknown fields, and malformed data without invoking untrusted getters or
  iterators.
- **REQ-004:** The CLI `rogatio runtime` command shall implement `install`, `status`,
  `trust`, `untrust`, and `uninstall` in addition to the existing `start`, `stop`,
  `status`, and `--help`.

### Native-Messaging Host Manifest

- **REQ-005:** `generateNativeMessagingManifest(hostPath, name, allowedOrigins)` shall
  return a fixed-shape object `{ name, description, path, type: "stdio",
  allowed_origins }` where `name` is the host name, `path` is the absolute host path, and
  `allowed_origins` is the provided list.
- **REQ-006:** The manifest `path` must be an absolute, confined path within an expected
  install root; a `hostPath` outside the allowed root, or not absolute, is rejected with
  a stable `trust.invalid-manifest` error before any write.
- **REQ-007:** `allowed_origins` values must be valid `chrome-extension://` origins; an
  invalid entry is rejected with `trust.invalid-manifest` before any write.
- **REQ-008:** Manifest generation is deterministic: identical `(hostPath, name,
  allowedOrigins)` produce byte-identical JSON regardless of input array order, with
  `allowed_origins` sorted and de-duplicated. Unknown fields are rejected.

### Trust Controller Lifecycle

- **REQ-009:** `install()` shall write the manifest to the platform's Chrome
  native-messaging manifest directory. When the directory is unresolvable/not writable or
  the host path does not exist, it returns a stable `trust.unsupported` result and writes
  nothing.
- **REQ-010:** `install()` is idempotent: when the manifest already exists and is
  byte-identical to the generated one, it returns success without rewriting; when it
  differs, it overwrites atomically.
- **REQ-011:** `uninstall()` shall remove the manifest file. When no manifest exists it
  returns success (no-op) and removes nothing; removal is atomic and leaves no partial
  file.
- **REQ-012:** `trust()` shall provision the device-local CA into the OS trust store and
  mark it trusted. When CA trust is impossible (capability absent) it returns
  `trust.unsupported` and performs no trust-store work. `trust()` is idempotent when
  already trusted.
- **REQ-013:** `untrust()` shall remove the device-local CA trust from the OS trust store
  and remove the confined CA material when present. When not trusted it returns success
  (no-op). `untrust()` never errors on a missing CA.
- **REQ-014:** `status()` shall return `{ installed: boolean, trusted: boolean, platform,
  capabilityReasons }` with no side effects; `installed` reflects manifest presence and
  well-formedness, `trusted` reflects CA trust standing.
- **REQ-015:** All mutating operations are capability-gated; a missing capability yields
  `trust.unsupported` with reasons, never an uncontrolled throw nor a partial trust
  state.

### Capability Gate

- **REQ-016:** `detectTrustCapabilities()` shall independently report `{ manifest:
  boolean, caTrust: boolean, reasons }` from the current platform/config — capability-
  based, not OS-name-based. A non-macOS platform with the required tooling may still
  report `manifest: true`/`caTrust: true`; a macOS platform missing the tooling reports
  them `false`.
- **REQ-017:** Capability detection is a pure, injectable function in tests; it performs
  no writes and emits no traffic.

### Confidentiality And Privacy

- **REQ-018:** F16 shall never read, write, log, or transmit request/response body bytes,
  credentials, sensitive header values, or project traffic. The CA private key stays
  confined to the install root and is never placed in the native-messaging envelope or
  any emitted diagnostic.
- **REQ-019:** Public diagnostics and `status` output shall contain only the stable F16
  error-code set and deterministic fields (`installed`, `trusted`, `platform`,
  `capabilityReasons`); manifest path, host path, CA material, and third-party tooling
  text shall not appear.
- **REQ-020:** F16 shall not persist trust state to `.rogatio.json`, the runtime, or any
  file outside the manifest path and the confined CA material; it leaves no traffic log
  and no project/history artifact.

### Resource Limits

- **REQ-021:** F16 shall export one immutable trust-limit profile: manifest max bytes
  (≤ 4,096), allowed-origins max (≤ 64), CA key bits (≥ 2048). Limits are checked before
  any write; a violation aborts with a stable code.

## Public API And Data Contracts

```ts
export type TrustPlatform = "darwin" | "linux" | "win32" | string;

export interface TrustStatus {
  readonly installed: boolean;
  readonly trusted: boolean;
  readonly platform: TrustPlatform;
  readonly capabilityReasons: readonly string[];
}

export interface TrustResult {
  readonly ok: boolean;
  readonly state: "installed" | "uninstalled" | "trusted" | "untrusted" | "unsupported" | "noop";
  readonly reasons?: readonly string[];
}

export interface NativeMessagingManifest {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly type: "stdio";
  readonly allowed_origins: readonly string[];
}

export interface TrustCapabilities {
  readonly manifest: boolean;
  readonly caTrust: boolean;
  readonly reasons: readonly string[];
}

export interface RequestBodyTrustControllerOptions {
  readonly platform?: NodeJS.Platform;
  readonly hostPath?: string;
  readonly hostName?: string;
  readonly allowedOrigins?: readonly string[];
  readonly installRoot?: string;
  readonly manifestDir?: string;
  readonly detectCapabilities?: () => TrustCapabilities | Promise<TrustCapabilities>;
  readonly clock?: () => number;
}

export function createRequestBodyTrustController(
  options?: RequestBodyTrustControllerOptions,
): {
  install(): Promise<TrustResult>;
  uninstall(): Promise<TrustResult>;
  trust(): Promise<TrustResult>;
  untrust(): Promise<TrustResult>;
  status(): Promise<TrustStatus> | TrustStatus;
};

export function generateNativeMessagingManifest(
  hostPath: string,
  name: string,
  allowedOrigins: readonly string[],
  installRoot: string,
): NativeMessagingManifest;

export function detectTrustCapabilities(
  options?: { platform?: NodeJS.Platform; manifestDir?: string },
): TrustCapabilities;

export type F16ErrorCode =
  | "trust.unsupported"
  | "trust.invalid-manifest"
  | "trust.invalid-host-path"
  | "trust.invalid-origin"
  | "trust.write-failed"
  | "trust.capability-error"
  | "trust.internal";
```

## Native-Messaging Manifest

`generateNativeMessagingManifest(hostPath, name, allowedOrigins, installRoot)` returns:

```json
{
  "name": "com.rogatio.runtime",
  "description": "Rogatio request-body native runtime host",
  "path": "/Applications/Rogatio/runtime-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/"]
}
```

`allowed_origins` is emitted sorted, lower-cased, and de-duplicated. The `path` must be
absolute and resolve within `installRoot`; otherwise `generateNativeMessagingManifest`
throws `trust.invalid-host-path`.

## CLI Surface

```
rogatio runtime install      Install the native-messaging host manifest (capability-gated)
rogatio runtime status       Show trust standing (installed / trusted)
rogatio runtime trust        Trust the device-local CA in the OS trust store (capability-gated)
rogatio runtime untrust      Remove the device-local CA trust
rogatio runtime uninstall    Remove the native-messaging host manifest
```

`install`/`trust` print success or `trust unsupported: <reasons>` and exit `0` on
`unsupported` (explicit, no auto-fallback). `status` prints `installed: <bool>
trusted: <bool>`. `uninstall`/`untrust` are idempotent and print success. Malformed CLI
arguments exit `2`.

## Verification Obligations

### Manifest and capability

- **AC-001:** `generateNativeMessagingManifest` returns the fixed shape; identical inputs
  produce byte-identical JSON; `allowed_origins` sorted/de-duplicated; unknown fields
  rejected.
- **AC-002:** A `hostPath` outside `installRoot`, non-absolute, or with an invalid
  `allowed_origins` entry throws `trust.invalid-host-path` / `trust.invalid-origin`
  before any write.
- **AC-003:** `detectTrustCapabilities` is pure and injectable; reports `manifest`/`caTrust`
  booleans plus reasons; capability-based, not OS-name-based.

### Trust controller lifecycle

- **AC-004:** `install()` writes the manifest where capabilities allow; when the manifest
  directory is unwritable or the host path missing, returns `trust.unsupported` and writes
  nothing.
- **AC-005:** `install()` is idempotent (same content → no rewrite, success); `uninstall()`
  is a no-op success when no manifest exists and removes it atomically otherwise.
- **AC-006:** `trust()` provisions the CA and reports trusted where capabilities allow,
  else `trust.unsupported` with no trust-store work; `untrust()` is a no-op success when
  not trusted and removes the CA material otherwise.
- **AC-007:** `status()` reports `installed`/`trusted` from actual artifact standing with
  no side effects; never leaks paths, CA material, or tooling text.

### CLI and package

- **AC-008:** `rogatio runtime install | status | trust | untrust | uninstall` run; help
  lists them; `status` reflects standing; `install`/`trust` report `unsupported` cleanly
  on incapable platforms; malformed args exit `2`.
- **AC-009:** The runtime package and CLI build as Node ESM; root format, lint, strict
  typecheck, build, package tests, and canonical validation remain authoritative.
- **AC-010:** Scope inspection proves F16 contains no F15/F17 rule behavior, no F14
  start/stop/status change, no body byte handling, no persistence to the project, and no
  general proxy.

## Alternatives And Decisions

- **Explicit install/trust separate from F14 start/stop, selected:** device trust is
  persistent and user-intentional; conflating it with the per-session process lifecycle
  would force re-trust every start.
- **Capability-based gate mirroring F14 REQ-008, selected:** macOS is the reference
  platform, but any platform with the required tooling may install/trust; absence reports
  `trust.unsupported`.
- **Pure manifest generation, selected:** deterministic, testable off-platform, no
  secrets.
- **Confine CA to an install root, no envelope exposure, selected:** core
  confidentiality guarantee; matches F14's body-boundary discipline.
- **Auto-install/auto-trust on start, rejected:** explicit user actions only.
- **Persist trust in the project file, rejected:** trust is device-local, not project
  state.

## Assumptions And Open Questions

1. The native-messaging host name and `allowed_origins` derive from F7's extension
   identity; F16 accepts them as configuration and does not own the extension ID.
2. Device-local CA provisioning uses OS tooling (macOS keychain reference platform);
   cross-platform tooling paths are capability-detected, not hard-coded by OS name.
3. F16 ships the capability-gated module and manifest generation; the live TLS proxy that
   *consumes* the trusted CA is completed by F17 on capable platforms.
4. The trust-limit defaults (manifest ≤ 4,096 bytes, origins ≤ 64, CA ≥ 2048 bits) are
   proposed; confirm the tradeoff.

## Stage 4 Gate

This specification is proposed only. No implementation plan, tests, production code,
commit, push, pull request, merge, or worktree cleanup is authorized by this document.
Implementation may begin only after explicit human approval of this specification and the
F16 architecture decisions in `docs/architecture.md`.
