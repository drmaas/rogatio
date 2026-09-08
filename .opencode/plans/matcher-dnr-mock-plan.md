# Plan — Matcher DNR Actions + Mock Removal / Unified Runtime

Plan mode: read-only. Confirmed with user.

Scope:
- Matcher rules (redirect/query/header): DNR action projection in extension adapter (no runtime needed).
- Mock (`grp-sample/rule-mock`): remove separate category; mock/rewrite/replacement via request/response body rules under unified native runtime.
- `needs proxy`: remove from status model; only unified native runtime status (`stopped/started/failed`).
- Update extension adapter, service worker, browser-core status, fixtures, docs.

Tasks:
1. Extension DNR adapter: action projection for matcher ops.
2. Service-worker: remove `needs proxy` / mock-phase; consolidate status.
3. Sample fixtures: replace/remove mock rules with body rules.
4. Tests: fix assertions referencing `needs proxy` / mock connection.
5. Docs: sync architecture, specs, site pages.
6. Verify `pnpm validate`.

Acceptance:
- Matcher rules active/install without runtime.
- Mock removed; body rules cover mock/rewrite/replacement.
- `needs proxy` removed everywhere.
- No regression on existing active rules.
