# RESEARCH.md — Matcher DNR + Mock/Proxy Removal

**Feature slug:** unified-mock-dnr
**Base branch:** main
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/unified-mock-dnr`
**Tier:** free
**Status:** Read-only exploration completed.

## Key evidence from codebase

- `docs/architecture.md` line 86: matcher operations have no action; extension reports them `unsupported`. Redirect/query/header rules are separate `kind` values (`redirect`, `query`, `header`).
- `packages/extension/src/service-worker.ts` line 113-226 (`operationStatuses`): matcher rules (`kind === "matcher"`) forced to `unsupported`; redirect/query pass through; mock/request-body/response-body use `needs proxy` when `nativePhase !== "started"`.
- `service-worker.ts` `dnrManagedOps` (line 264-289): only `redirect` and `query` included in DNR install; `header` handled separately via `installHeaderRules` (line 337-350). Matcher (`kind === "matcher"`) excluded entirely.
- `service-worker.ts` lines 591-773 (`start-native-runtime` / `stop-native-runtime`): mock phase tracked via `mockConnected` / `mockTokens` / `MockRuntimeConnection`. Separate mock connection (`connectNativeMock`) called during start (line 667-691). Mock DNR redirect rules installed only when `withMocks` true (line 693).
- Image evidence (lower left): `grp-sample/rule-redirect: error`, `grp-sample/rule-query: error`, `grp-sample/rule-header-set: error`, `grp-sample/rule-header-remove: error`. These are `core.rule-not-installed` — enabled + granted but missing from installed IDs. Mock (`grp-sample/rule-mock`) shows `needs proxy`; response/request-body active.
- `docs/plans/f23-unified-native-host-runtime.md`: mock-phase tracking to be removed; one native session owns mock/response/request-body.
- `docs/plans/f13-mock-rules.md`: mock rules (`type: "mock"`) use separate mock runtime (`check-mock-runtime`, `needs proxy`, tokens, redirect to `127.0.0.1:<port>/mock/<token>`).

## Gaps identified

1. Matcher rules (`redirect`, `query`, `header-set`, `header-remove`) must have DNR actions projected so they install without native runtime start. Currently `unsupported` / missing from installed set.
2. Mock category (`grp-sample/rule-mock`) is legacy separate slice; must be removed and folded into request/response body rules via unified native runtime.
3. `needs proxy` status label and mock-phase tracking (`MockRuntimePhase`, `check-mock-runtime`, `connectNativeMock`, mock tokens, `mockConnection`) must be removed.
4. Extension adapter/projection (`projection.ts`, `installer.ts`) likely missing header-redirect/query action mappings.

## Source files to touch

- `packages/extension/src/service-worker.ts` (status, mock phase, DNR ops)
- `packages/extension/src/projection.ts`
- `packages/extension/src/installer.ts`
- `packages/browser-core/src/status.ts`
- `packages/extension/src/mock-runtime.ts` (possibly remove)
- `packages/extension/src/native-session.ts` (consolidate)
- `docs/architecture.md`, docs-site, plans
- Sample fixtures (`grp-sample` rules)

## Verification evidence needed

- Matcher rules show `active`, install via DNR, work without runtime start.
- Mock rules removed; mock/rewrite/replacement handled by body rules under unified runtime.
- `needs proxy` removed everywhere.
- `pnpm validate` passes; all active rules working.
