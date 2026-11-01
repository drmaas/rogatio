# F10 — Workflow Log

## Tier and role assignment (Free tier)

| Stage | Phase | Model |
| --- | --- | --- |
| 0 | Worktree | (session) `opencode/hy3-free` |
| 1 | Brainstorm | `opencode/nemotron-3-ultra-free` |
| 1a | Adversarial | `opencode/hy3-free` (cross-model; free catalog) |
| 2 | Architecture | `opencode/nemotron-3-ultra-free` |
| 3 | Specification | `opencode/nemotron-3-ultra-free` |
| 4 | Human review gate | user |
| 5 | Plan | `opencode/mimo-v2.5-free` |
| 6 | Tests | `opencode/muse-spark-1.2-contributor-free` |
| 7 | Implementation | `opencode/x-preview-f-free` |
| 8 | Verification | `opencode/hy3-free` |
| 9 | Review | `opencode/big-pickle` |
| 10 | Docs | `opencode/hy3-free` |
| 11 | Release | user authorization |

Models verified available from the free catalog. Single session model is `hy3-free`; used only for the brainstorm adversarial pass, verification, and docs (all distinct role passes).

## Stage 0 — Worktree

- Base commit `acf4c2c` on `main` (clean).
- Worktree: `/home/drmaas/.local/share/opencode/worktree/8ab719d1d66b959f03fa7887060b82ec0f0fdb35/feature/f10-query-params`
- Branch: `feature/f10-query-params`
- Intended change: first rule-action slice — query parameter rules (schema/compiler/extension/editor).

## Stage 1 — Brainstorm (synthesis, ephemeral notes only)

Primary (ultra) + adversarial (hy3) synthesis. Decisions:
- F10 introduces the `action` discriminator into the v1 schema; `QueryAction` is the first variant.
- Compiler emits a rule operation carrying `matcher` + `action`. Renaming `MatcherOperation`→`RuleOperation` (`kind:"rule"`) chosen as the durable foundation.
- DNR translation: `redirect.transform.query.addOrReplaceParams` with `replaceOnly:false` (add-or-replace).
- Bounds: `maxQueryParamsPerRule`, `maxQueryNameLength`, `maxQueryValueLength`, unique param names.
- Editor: `RuleTypeFieldExtension` "query" + rule-type selector; validation at editor + Node + browser-schema.
- Risks flagged by adversarial pass: must keep Node schema and MV3 `browser-schema` validated identically; F7 actionless projects become invalid (documented migration); service-worker `unsupported` mapping must special-case query; projection test fixtures must flip to installable:true.

## Stage 2 — Architecture

See `docs/architecture.md` F10 section. Components: schema `action` union + limits; compiler `RuleOperation`; extension `projection.ts` DNR builder + `service-worker.ts` status; editor `RuleTypeFieldExtension` + selector; browser-schema mirror.

## Stage 3 — Specification

`docs/specs/f10-query-params.md` written. REQ-001..012, AC-001..012.

## Stage 4 — Human review gate

APPROVED by user. Proceed to plan.

## Stage 5 — Plan

Plan written to `docs/plans/f10-query-params.md`. Ordered tasks mapped to AC IDs. Stage 6 (tests) follows.

## Stage 5 — Plan

TODO after approval.

## Stage 6 — Tests

TODO.

## Stage 7 — Implementation

TODO.

## Stage 8 — Verification

TODO.

## Stage 9 — Review

TODO.

## Stage 10 — Docs

TODO.

## Stage 11 — Release

TODO (needs user authorization).
