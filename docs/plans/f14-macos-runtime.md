# F14 Implementation Plan — Native-Messaging Runtime Control

Status: approved (user "approved, proceed" at SDD Stage 4).
Tier: Free. Single-model session (hy3-free); role passes are distinct self-reviews.
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f14-macos-runtime`
Branch: `feature/f14-macos-runtime` (base `main` `b8c8ab6`).

## Scope (matches approved spec `docs/specs/f14-macos-runtime.md`)
Testable runtime control plane + revalidation core + `f14-v1` envelope + deterministic PAC
generation + capability-gated interception seam. Live TLS proxy / device-local CA trust
install are DEFERRED (unverifiable in headless Linux CI; land with F15/F17 on capable
platforms). Activation is **capability-based**, never OS-name-hard-gated: `unsupported`
is returned only when capability/collision checks fail, independent of OS.

## Package additions — `@rogatio/runtime`
1. `src/f14-types.ts` — shared F14 types/limits: `F14_PROTOCOL="f14-v1"`,
   `F14_ENVELOPE_MAX_BYTES=64KiB`, `F14_MAX_PAC_ORIGINS=256`,
   `F14_MAX_CONCURRENT_TRANSFORMS=32`, `F14_REVALIDATION_INTERVAL_MS=5000`,
   `NativeRuntimeState`, `AuthorityDenyReason`, `F14RevalidationRequest`,
   `AuthorityDecision` (allowed/denied), envelope message types.
   Covers REQ-001..REQ-005, REQ-011..REQ-013, REQ-024.
2. `src/f14-envelope.ts` — `serializeEnvelope` / `parseEnvelope` for `f14-v1`.
   **Body-exclusion guarantee**: recursive scan of own data rejects any key named
   `body` / `requestBody` / `responseBody` anywhere in metadata; serialized bytes
   capped at `F14_ENVELOPE_MAX_BYTES`. Pure + deterministic.
   Covers REQ-006..REQ-010, AC body-exclusion + envelope-size (AC-006..AC-008).
3. `src/f14-revalidate.ts` — `revalidateAuthority(project, operations, request)`.
   Defensive via `snapshotOwnData`/`hasOwn`; finds matched compiled operation, then
   **re-derives** from canonical project (rule must exist in `project.groups`), checks
   urlRegex (schema `compileUrlRegex`), target origin, initiator origin, method,
   resourceType against `matcher`. Does NOT read any browser grant boolean.
   Covers REQ-014..REQ-023, AC-009..AC-011.
4. `src/f14-pac.ts` — `generatePacScript(origins, endpoint, opts?)`. Validates/dedupes/
   **sorts** origins (deterministic), drops invalid, throws past 256, returns a fixed
   `FindProxyForURL` body. No randomness/iteration-order dependence.
   Covers REQ-025..REQ-027, AC-012..AC-013.
5. `src/f14-lifecycle.ts` — `createNativeRuntimeController(options)`. Guarded state
   machine (`idle|starting|running|stopping|stopped|unsupported`), explicit Start/Stop
   (no auto-start), idempotent `stop`, re-detect on re-`start` after `unsupported`.
   Capability detection injected (default → unsupported "no-capability-provider").
   Covers REQ-001..REQ-005, REQ-028..REQ-031, AC-001..AC-005.
6. `src/f14-interception.ts` — capability-gated interception seam:
   `registerInterceptionProvider`, `startInterception`, `stopInterception`. Default
   returns `unsupported` (no provider); F15/F17 register a real provider on capable
   platforms. Covers REQ-028..REQ-031 gating.
7. `src/index.ts` — re-export the six new modules.

## CLI — `@rogatio/cli`
8. Add `@rogatio/runtime` to `packages/cli/package.json` dependencies.
9. Rewrite `packages/cli/src/commands/runtime.ts` from stub to a real command with
   subcommands `start | stop | status` plus `--help`. Wires `createNativeRuntimeController`
   (default capability detection → `unsupported` in this environment, surfaced cleanly).
10. Update `showRuntimeHelp` + top-level help line in `packages/cli/src/index.ts`.

## Tests (Stage 6, written before production code that they cover)
- `packages/runtime/test/f14-revalidate.test.ts` — allowed happy path (uses real
  `compileProject` from `@rogatio/compiler`); denies for url-mismatch, target-unauthorized,
  initiator-unauthorized, method-mismatch, resource-type-unauthorized, operation-unknown,
  project-inconsistent, and hostile inputs (proxy/cycle/symbol) → `project-invalid`.
  Proves grant boolean is ignored (no parameter accepts it).
- `packages/runtime/test/f14-envelope.test.ts` — round-trip parse/serialize; rejects
  `body`/`requestBody`/`responseBody` keys at any depth; rejects >64KiB; deterministic
  output for equal input.
- `packages/runtime/test/f14-pac.test.ts` — determinism (same input → identical script),
  invalid origins dropped, sorted, >256 throws, endpoint formatting.
- `packages/runtime/test/f14-lifecycle.test.ts` — explicit start reaches running with an
  injected capable detector; incapable detector → unsupported; idempotent stop; no
  auto-start; re-start after unsupported re-detects.
- `packages/cli/test/runtime-command.test.ts` — `--help` → 0; `status` prints state;
  `start` with default capabilities → 0 + unsupported message; `stop` → 0; unknown
  subcommand → 2.

## Verification (Stage 8)
`pnpm install` (once, to link `@rogatio/runtime` into cli), then root
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm validate`.
All new tests must pass; no regression in existing suites.

## AC traceability
- Explicit control / no auto-start / idempotent stop → lifecycle tests + REQ-001..005.
- Body never crosses envelope → envelope tests (structural) + REQ-006..010.
- Independent revalidation (no grant trust) → revalidate tests + REQ-014..023.
- Deterministic PAC → pac tests + REQ-025..027.
- Capability-based activation (unsupported, not OS-gated) → lifecycle + interception tests + REQ-028..031.

## Out of scope (deferred, per approval)
Live TLS interception, device-local CA trust install, macOS PAC/extension collision probe
implementation. Seams (`detectCapabilities`, `registerInterceptionProvider`) exist so F15/F17
fill them without core changes.
