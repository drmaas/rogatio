# F12 Workflow Log — Offline Dry-Run / Test

**Tier:** Free. **Session model:** `opencode/hy3-free` (single-model fallback — only one
model available; all SDD phase passes executed by the session model with distinct role
framing per AGENTS.md single-model rule). Intended free assignment was brainstorm/
architecture/spec → Nemotron 3 Ultra Free (primary) / Hy3 Free (fallback); plan/docs →
Hy3 Free; tests/impl → Laguna S 2.1 / Inkling Small; verification → Nemotron 3.5
Lightning; review → Nemotron 3 Ultra. Those assignments are recorded as intended but
could not be dispatched in a single-model session.

## Stage 0 — Worktree
- Worktree: `feature/f12-offline-dry-run` (opencode-worktree plugin).
- Base commit: `acf4c2c` (main).
- Deps F2/F3/F5/F8 confirmed landed. F9/F10/F11 (redirect/query/header actions) NOT in repo.

## Stage 1 — Brainstorm (synthesized, ephemeral)
- User problem: no way to confirm which rules match a concrete request before save/install.
- Approaches considered: (a) reuse compiler matcher ops + new pure engine; (b) fold action
  previews now (rejected as scope expansion — see §6).
- Key risk surfaced: redirect/query *preview* depends on F9/F10 action schemas absent here.
- Adversarial self-pass: attacked for (1) network calls to tested URLs — prohibited, engine
  does only `URL` parse + `RegExp`; (2) resource-type/method not derivable from URL alone —
  resolved by optional per-case method/resourceType; (3) editor browser bundle importing Node
  F2/F3 — resolved via host adapter + `/api/dry-run`; (4) hostile/cyclic case input — REQ-006.

## Stage 2 — Architecture (synthesized)
- New package `@rogatio/dry-run` (Node ESM, pure; deps `@rogatio/compiler`, `@rogatio/schema`).
- Engine `dryRunProject(operations, cases, options)`.
- CLI: new `test` subcommand + `edit` server `POST /api/dry-run`.
- Editor: host `dryRun` adapter + "Test rules" route/panel; editor bundle stays browser-safe.

## Stage 3 — Specification
- File: `docs/specs/f12-offline-dry-run.md`.
- Contains REQ-001..REQ-012, AC-001..AC-013, data contracts, §6 scope decision, OQ-1/OQ-2.

## Stage 4 — Human review gate
- PENDING approval. Open decision: **Option A (recommended) vs Option B** for action previews.

## Stage 5 — Plan
- Not started (blocked on gate).

## Stage 6 — Tests first
- Not started.

## Stage 7 — Implementation
- Not started.

## Stage 8 — Verification
- Not started.

## Stage 9 — Independent review
- Not started.

## Stage 10 — Documentation
- Not started.

## Stage 11 — Release
- Not started.
