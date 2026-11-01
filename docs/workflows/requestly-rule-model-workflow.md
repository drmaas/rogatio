# Requestly rule model — workflow

> Audience: agent

## Scope

Implement GitHub issue #219: remove group/rule `origins`, adopt a source condition (`key` `url`|`host`, operator `regex` only), one broad install-time host grant, and PAC routing gated by enabled body-rule source conditions. No `filters` nesting, no `pageDomain`, no `equals`/`contains`/`wildcard`.

## Stage status

- Stage 0 — isolated worktree: complete
- Stage 1 — brainstorm (primary + adversarial): complete
  - Primary: Grok (`grok-4.7-high-fast`)
  - Adversarial: Composer in-orchestrator (GPT/Gemini quota exhausted)
- Stage 2 — architecture: complete (decisions captured in spec appendix; living `docs/architecture.md` deferred to Stage 10)
- Stage 3 — specification: complete at `docs/decisions/requestly-rule-model/spec.md`
- Stage 4 — specification approval: **approved 2026-09-25** by user
  - Q1–Q6 recommendations adopted as written
  - Q7: draft REQ-032 (same-origin after source match), not Grok’s “target must also match source”
- Stage 5 — implementation plan: **complete 2026-09-25**
  - Plan: `docs/decisions/requestly-rule-model/plan.md` (audience: hybrid)
  - 24 tasks (T01–T24). First spike: **T01** Chrome PAC probe (`test/browser/pac-regexp-spike.test.ts`). Blocks only T13.
  - Blockers to start implementation: none. Sequencing gate: T13 waits until T01 results are written in this log.
  - Locked in the plan (spec body not edited): dry-run axes are `source`, `method`, `resourceType` (origin axis removed; no fourth axis added). Q7 stays same-origin only.
- Stage 6 — tests first: **complete** (waves through T22)
- Stage 7 — implementation: **complete** (T13–T22; mechanical fixture/journey sweep in Stage 8)
- Stage 8 — verification: **complete** (`pnpm validate` exit **0**, 2026-09-26)
- Stage 9 — independent review: **complete** (Composer review; highs fixed: AC-010 docs, `runtime.pac-unroutable`, AC-008 URL-regex body + body url-mismatch tests)
- Stage 10 — documentation: **complete** (T23 living-doc sweep; historical F-slice appendices may still say “version-1” in past-tense feature narratives)
- Stage 11 — freeze/release: **complete** (commit + PR authorized 2026-09-26; durable docs frozen)
## Worktree

- Base: `489cebc` (`main`)
- Branch: `feature/requestly-rule-model`
- Worktree: `/home/drmaas/Projects/github/drmaas/temp/rogatio-requestly-rule-model`
- Issue: https://github.com/drmaas/rogatio/issues/219

## Model lock (per role)

| Role | Chosen model | Fit / complexity / constraints |
| --- | --- | --- |
| `reasoning` / hard design | `grok-4.7-high-fast` | **Only** for most complex seams (PAC/authz/compiler cross-cuts). User 2026-09-25: no fast-variant cost-saving; Grok sparingly |
| `plan` / `coding` / `verify` / `review` / `docs` / `adversarial` | `composer-2.5-fast` | Default for everything else (only Composer id in Cursor pool) |

Do **not** spawn Grok for fixture churn, schema mirrors, or mechanical renames. Main-thread Composer preferred over background agents after stuck-subagent failure.

Fallback history: Opus/GPT/Gemini quota exhausted earlier same day.

## Graphify

- Worktree now has `graphify-out/graph.json` (code-only: 2762 nodes, 5604 edges). Docs skipped — no LLM API key.
- Ran `graphify . --code-only` then `graphify cluster-only .` on 2026-09-25 after Stage 4 approval.
- Prefer `graphify query` / `path` / `explain` and `GRAPH_REPORT.md` in later stages.

## Stage 5 log

- Role `plan`, model `grok-4.7-high-fast` (locked 2026-09-25).
- Worktree confirmed: `git rev-parse --show-toplevel` → `/home/drmaas/Projects/github/drmaas/temp/rogatio-requestly-rule-model`, branch `feature/requestly-rule-model`.
- At plan start, `graphify-out/graph.json` was absent. A code-only graph was built later the same day (see Graphify). One `graphify query` for grant/PAC seams confirmed the plan's files and added `packages/runtime/src/host.ts` plus `test/browser/extension-context.ts` `seedGrantedOrigins`.
- Spec left append-only. No tests. No production code.

## Agent health

- 2026-09-25 ~22:04: coding subagent `445ba971` reported "running" ~18m with **zero** on-disk code changes (`PROJECT_VERSION` still 1). Orchestrator took over T01–T04 in the main thread. Cancel stuck UI subagents if still listed.

## T01 spike results

Command:

```
pnpm exec vitest run --config vitest.browser.config.ts test/browser/pac-regexp-spike.test.ts
```

Exit code: **1** (2026-09-25)

| Probe | Result | Notes |
| --- | --- | --- |
| 1 RegExp exists | **unproven** | `chrome.proxy` undefined on extension page. `--proxy-pac-url` + loopback bypass still **0** proxy hits. |
| 2 case-sensitive | **unproven** | same |
| 3 lastIndex / fresh RegExp | **unproven** | same |
| 4 `new URL` | **unproven** | same |

**T13 gate:** RegExp-in-PAC **not approved**. Use fail-closed branch until spike passes. Literal-host PAC may still ship.

## Implementation progress

- **T02–T04 complete:** schema v2 + `migrateV1Project` (null-prototype snapshot fix in `isPlainObject`). Schema tests green.
- **T05 complete:** `browser-schema.ts` v2 mirror, `migrateV1Project` re-export, fixtures updated.
- **T06 complete:** `NormalizedMatcher.source`, `source-match.ts`, selector without grants.
- **T07 complete:** dry-run axes `source` / `method` / `resourceType`; `sourceMatches` from compiler.
- **T08–T12 complete (runtime package):** revalidate, authorization/preset/canonical/policy, literal-host PAC (`pacRoutes`, `no-pac-routes`), `host.ts` wiring, intercept-proxy initiator + `sourceMatches`. T13 RegExp PAC skipped (T01 unproven).
- **T15 complete (browser-core):** `ENVELOPE_VERSION` 2, drop `grantedOrigins` / `needs permission`, envelope v1→v2 migration with notices.
- **T13 complete:** fail-closed PAC (no `RegExp` in generated script); literal-host routes only; URL-regex body rules → `runtime.pac-unroutable`.
- **T14 complete:** `native-session` / `background` send `pacRoutes` (not origins); policy drops `grantedOrigins`; intercept-proxy uses `sourceMatches`.
- **T16 complete:** manifest `host_permissions: ["*://*/*"]`; `optional_host_permissions` removed; `scripts/validate.ts` asserts install grant.
- **T17 complete:** shared `source-projection.ts`; DNR + session markers use `regexFilter` from source; literal host gets pinned regex + `requestDomains`.
- **T18–T19 complete:** grant adapters/UI removed; `needs permission` dropped from status/precedence/copy; match-log no per-origin grant.
- **T20 complete:** editor source controls (`key`/`operator`/`value`); origins editors removed; dry-run shows `source` axis; migration notice banner + dismiss port.
- **T21 complete:** `ai-prompt` / `ai-assist` proposal shape uses `source`; CLI `readDocument` migrates v1 in memory + stderr notices; empty projects v2; `rogatio test` prints `source` dimension.
- **T22 complete:** `samples/basic/.rogatio.json` v2; `sample-basic-helpers.ts` rewrites `source.value`; `extension-context` drops `seedGrantedOrigins`.
- **Stage 9 review (2026-09-26):** Composer independent review. Accepted risks kept (broad grant, T01 fail-closed PAC, initiator presence). Fixed highs: AC-010 living-doc sweep (README/AGENTS/overview/architecture/docs-site/samples); renamed `extension.pac-unroutable` → `runtime.pac-unroutable`; AC-008 URL-regex body status test + body `url-mismatch` revalidate test. Non-match proxy pass-through already covered. Reviewer “no commits” note is Stage 11 (uncommitted by design until release auth).
- **Stage 8 re-verify after Stage 9 fixes:** `pnpm validate` exit **0** (2026-09-26). Browser smoke `EADDRINUSE` on `:4173` still logged; gate green.
- **Stage 10:** Living docs synced for v2 source model / broad host grant / 3-dim dry-run. Freeze paths ready for Stage 11.
- Focused vitest (2026-09-25, after `pnpm build`):
  - Extension: `manifest`, `source-projection`, `native-session-pac`, `dnr`, `session-body-markers`, `projection`, `service-worker`, `popup-model`, `attention` — **83/83 pass**
  - Editor + AI + CLI load: `editor.test`, `editor/ai-assist.test`, `runtime/ai-assist.test`, `runtime/ai-prompt.test`, `extension/ai-assist.test`, `cli/project-storage.test` — **113/113 pass**
- Model policy (user 2026-09-25): Composer default; Grok only for hardest seams; no fast-variant cost-saving as strategy.

## Before T24 (`pnpm validate`)

1. ~~Update remaining v1 fixtures~~ done in Stage 7/8.
2. ~~Browser Selenium journeys~~ done in Stage 8.
3. ~~Editor tests~~ done.
4. ~~Full `pnpm validate`~~ exit 0 (twice: post-impl + post-Stage-9 fixes).
