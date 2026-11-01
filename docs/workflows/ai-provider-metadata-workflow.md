# Workflow log — ai-provider-metadata (issue #241)

> Status: frozen 2026-09-27
> Audience: agent. Running record of stage status, review rounds, and verification evidence.
> Feature: surface AI provider URL and model in the management page AI card.

## Context

- Issue: drmaas/rogatio#241 "Surface AI provider and model in the management page AI card"
- SDLC flow selected: `sdd` (rejected `doit` — not a well-understood change; rejected `rpi` —
  the problem space is characterized, the gap is three concrete decisions, and rpi's ADR
  location conflicts with this repo's `docs/decisions/` convention).

## Stage status

| Stage | Status | Notes |
| --- | --- | --- |
| 0 Worktree | done | `git worktree add -b feature/ai-provider-metadata ../rogatio-ai-provider-metadata main`, base `e8b1410`, `pnpm install` ok |
| 1 Brainstorm | done | primary + adversarial passes; 4 decisions resolved with user (below) |
| 2 Architecture | done | design captured in `spec.md` §Design; `docs/architecture.md` edits deferred to Stage 10 so living docs never describe unshipped behavior (repo rule) |
| 3 Specification | done | `docs/decisions/ai-provider-metadata/spec.md` |
| 4 Human gate | done | spec approved by user 2026-09-27 (D1–D4 all confirmed; cosmetic UI detail delegated) |
| 5 Plan | done | `plan.md` (T1–T7) |
| 6–7 Tests, impl | done | tests-first per plan T1–T4; red state recorded (21/21 new runtime tests failing before impl), green after |
| 8 Verify | done | `pnpm validate` → "Validation completed successfully" (format, lint, typecheck, build, unit+integration vitest 331+324 green incl. 22+13 new, schema checks, browser 77 passed / 8 pre-existing skips) |
| 9 Review | done | round 1 in-context over the full diff (fresh-context limitation below); findings fixed |
| 10 Docs | blocked | architecture.md, docs-site, supersession footer on frozen `docs/specs/ai-integration.md` |
| 11 Freeze + release | blocked | spec/plan/workflow → `docs/specs|plans|workflows/ai-provider-metadata*` |

## Harness deviations (recorded, not silently skipped)

- No subagent dispatch tool in this harness: Stage 1 primary and adversarial passes ran
  in-context as two distinct passes. Stage 9 will run as a fresh-context review limited to the
  artifact list (spec, plan, diff, verification output); if a true fresh context cannot be
  established, the limitation is escalated to the user rather than claimed as passed.
- Single fixed model for all roles (harness constraint). Role separation is by pass, not by
  model family. Fallbacks therefore recorded here rather than substituted.

## Stage 1 decisions (user-approved 2026-09-27)

| ID | Question | Decision |
| --- | --- | --- |
| D1 | Where provider metadata enters the architecture | New dedicated `ai.status` envelope (request/response), graceful "not reported" fallback on old hosts |
| D2 | Launch-time staleness | Host re-reads `provider.json` on each status request and rebuilds the AI client when the config changed (config effective without host restart) |
| D3 | Network-touching probe | Status check becomes metadata-only; wording shifts Ready → Configured (approved trade-off: a broken provider shows Configured until an actual call fails) |
| D4 | Project-file `ai` field | Not added. Code truth: v2 schema root has no `ai` property (`additionalProperties: false`); the old `docs/specs/ai-integration.md` mention is aspiration. Host config is the single source of truth |

## Adversarial findings carried into the spec

- A1 old-host fallback must be tested against a host-faithful stub (rejects unknown envelope
  types like `envelope.ts`), not a null-returning mock → AC-005.
- A2 `supported` semantics change probe-success → configured; approved in D3 → REQ-008.
- A3 `AIProviderConfig` contains `apiKey`; host must construct a pick-type at the boundary and
  an adversarial test asserts the key never appears in an envelope → AC-002.
- A4 display/client divergence avoided by D2 (both refresh together) → REQ-003.
- A5 frozen `docs/specs/ai-integration.md` pinned the 3-type registry; supersession footer at
  Stage 10 → plan task.
- A6 `test/browser/sidebar-cards.test.ts:266` pins "no `[data-ai-provider]`"; flips in this
  feature → AC-007.

## Implementation notes / plan amendments (post-approval, recorded here)

- **N1** `ai.status` sits behind the same `state === "running" && capability` guard as
  `ai.complete` (discovered at red time: every non-bootstrap envelope requires a paired
  session). Same session preconditions as every AI envelope; the SW never sends the check
  before `started` (AC-010). Original test "works without a preset" was wrong and replaced
  with a guard-parity test plus the real start+pair dance.
- **N2** Config refresh is an injected port `aiConfigReader` (`NativeRuntimeControllerOptions`,
  forwarded by `host.ts`, wired to `readProviderConfig` in `cli/commands/runtime.ts`). With no
  reader the launch config stays in force — preserves existing tests that inject
  `aiProviderConfig` and avoids tests touching the developer's real config file.
- **N3** `requestAIStatus` bounds the reply wait at 2s (bridge timeout is 10s; an older host
  drops the unknown frame and never answers). Late bridge rejections are swallowed by the
  `.then(_, () => null)` handler — no unhandled rejection.
- **N4** Old-host fallback fidelity: the real old host returns **no frame** for an unknown
  envelope type (`host.ts` `processFrame` → `parseEnvelope` throws → null), which manifests at
  the `send` API as the bridge timeout rejection. Unit tests emulate that exact rejection
  (`hostDropsStatus`); the browser journeys cover the page-level "not reported" degradation
  (`sidebar-cards.test.ts`), since browser journeys mock at the messaging layer where no host
  process exists. This is the T5 split.
- **N5** `type AIStatusReport` and `type AIStatusMetadata` are discriminated unions
  (`configured: true` carries both fields) so partial metadata cannot be typed.

## Stage 9 — review round 1 (in-context; fresh-context limitation recorded above)

Scope reviewed: full diff (15 modified, 3 new) against `spec.md` REQ/AC and plan T1–T7.

Findings:

- **R1 (coverage, fixed)** AC-005's "other native-session traffic still works after the failed
  check" had no direct assertion. Added: extension-level test (session + generate-project
  still succeed after a dropped `ai.status`) and host-level test (`processFrame` returns null
  for an unknown-type frame and answers the next envelope). Both green.
- **R2 (test bug, fixed)** the host-level test double-encoded the frame JSON; fixed the
  encoder helper.
- **R3 (verified non-issue)** soft refresh path (`patchWorkspaceEnablementChrome`) replaces the
  whole sidebar, so AI card state can never go stale when `aiSupported` is unchanged.
- **R4 (verified non-issue)** seed `aiProviderConfig` is not shape-validated when no reader is
  wired (test-only path); production wires `aiConfigReader` and the first refresh validates.
  Recorded as N2 semantics.
- **R5 (verified non-issue)** `canonicalAIConfig` includes the key in an in-memory comparison
  string only; no serialization path passes through it (AC-002 tests cover the wire).

Result: no unresolved findings. Round 2 not needed.

## Verification evidence

- `pnpm test` (packages/runtime): 32 files, 332 tests passed (23 new in `test/ai-status.test.ts`).
- `pnpm test` (packages/extension): 38 files, 325 tests passed (14 new in
  `test/ai-provider-status.test.ts`).
- `pnpm validate`: **success** (2026-09-27, final run after review fixes). Sequence: format ✓,
  lint ✓, typecheck ✓, build ✓ (18 artifacts), vitest unit+integration ✓ (127 files),
  emitted-schema checks ✓, browser ✓ (77 passed, 8 skipped — pre-existing live/spike suites:
  ai-live, pac-regexp-spike, request-body-live), "Validation completed successfully".
- `pnpm browser:install`: chrome + chromedriver 154.0.8037.57 (worktree setup).
