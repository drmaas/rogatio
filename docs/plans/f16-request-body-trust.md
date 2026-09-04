# F16 Implementation Plan

**Feature:** F16 — Request-Body Trust Lifecycle
**Spec:** `docs/specs/f16-request-body-trust.md`
**Architecture:** `docs/architecture.md` (F16 section)
**Depends on:** F14 (REP-001)

## Tasks

### T1 — Trust types and limit profile (`packages/runtime/src/f16-trust.ts`)
- Add `TrustPlatform`, `TrustStatus`, `TrustResult`, `TrustState`, `NativeMessagingManifest`,
  `TrustCapabilities`, `F16ErrorCode`, `TrustError`, `RequestBodyTrustControllerOptions`.
- Export immutable `F16_TRUST_LIMITS`: `manifestMaxBytes = 4096`, `maxAllowedOrigins = 64`,
  `caKeyBits = 2048`.
- Covers REQ-021, REQ-004 (types).

### T2 — Pure manifest generation (`f16-trust.ts`)
- `generateNativeMessagingManifest(hostPath, name, allowedOrigins, installRoot)`:
  - reject non-absolute / outside-`installRoot` `hostPath` → `trust.invalid-host-path` (REQ-006).
  - reject each non-`chrome-extension://<32 lowercase>/` origin → `trust.invalid-origin` (REQ-007).
  - sort + de-duplicate `allowed_origins`; fixed shape; deterministic (REQ-005, REQ-008).
- Covers REQ-005/006/007/008, AC-001/002.

### T3 — Capability gate (`f16-trust.ts`)
- `detectTrustCapabilities({ platform, manifestDir })`: pure, injectable; default returns
  `{ manifest:false, caTrust:false, reasons:["no-capability-provider"] }` (mirrors F14 default).
- Capability-based, not OS-name-based (REQ-016, REQ-017). Covers AC-003.

### T4 — Trust controller (`f16-trust.ts`)
- `createRequestBodyTrustController(options)` with `install/uninstall/trust/untrust/status`.
  - `install`: capability-gated; generate manifest; reject oversize (>limit) `trust.write-failed`;
    atomic write; idempotent (no rewrite when byte-identical) (REQ-009/010, AC-004/005).
  - `uninstall`: remove manifest; no-op when absent; atomic (REQ-011, AC-005).
  - `trust`: capability-gated; generate/confine device-local CA (node:crypto, ≥2048 bits) to
    install root; call injectable `caTrustInstaller` (default no-op); idempotent (REQ-012, AC-006).
  - `untrust`: remove confined CA + call injectable `caTrustRemover`; no-op when absent (REQ-013, AC-006).
  - `status`: reads manifest presence/well-formedness + CA material presence; no side effects;
    never leaks paths/CA/tooling text (REQ-014, REQ-019, AC-007).
  - all mutating ops capability-gated; unsupported → stable result, no throw (REQ-015).
- Covers REQ-009..015, REQ-018/019/020, AC-004..007.

### T5 — Runtime package export (`packages/runtime/src/index.ts`)
- Export `f16-trust.js` symbols. No change to F14 exports.

### T6 — CLI surface (`packages/cli/src/commands/runtime.ts`, `index.ts` help)
- Extend `runtimeCommand` routing: `install|trust|untrust|uninstall` → trust controller;
  `status` prints both F14 runtime state and F16 trust standing; `start|stop` unchanged.
- Update `showRuntimeHelp` and top-level `showHelp` to list the five new subcommands.
- `install`/`trust` print success or `trust unsupported: <reasons>`, exit 0 on unsupported;
  malformed args exit 2 (AC-008). Covers REQ-004, AC-008.

> Superseded by: feat/collapse-runtime-install-and-trust

### T7 — Tests (`packages/runtime/test/f16-trust.test.ts`, `packages/cli/test/...`)
- Unit: manifest shape/determinism/confinement/origin validation (AC-001/002).
- Capability pure/injectable (AC-003).
- Controller idempotency + unsupported paths + status no-leak (AC-004/005/006/007).
- Scope inspection: no body bytes, no F15/F17, no persistence (AC-010).
- CLI: `status` reports trust standing; `install`/`trust` report unsupported cleanly (AC-008/009).

### T8 — Verification & review
- Run `pnpm -C packages/runtime format:check && lint && typecheck && test` and CLI equivalents;
  full canonical validation. Fresh-context self-review (Stage 9).

## Acceptance-criterion coverage map
| AC | Task |
| --- | --- |
| AC-001 | T2 |
| AC-002 | T2 |
| AC-003 | T3 |
| AC-004 | T4 |
| AC-005 | T4 |
| AC-006 | T4 |
| AC-007 | T4 |
| AC-008 | T6 |
| AC-009 | T5/T6 + verify |
| AC-010 | T7 |

## Rollback
- All changes confined to `f16-trust.ts`, runtime `index.ts`, CLI `runtime.ts` + help strings.
- No schema/compiler change; reversible by removing the module export and CLI routing.

> Superseded by: feat/collapse-runtime-install-and-trust
