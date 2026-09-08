# PLAN.md — Matcher DNR + Mock/Proxy Removal

**Feature:** unified-mock-dnr
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/unified-mock-dnr`
**Strategy:** Code first (feature is behavior fix / consolidation, well-scoped).
**Plan read:** `.opencode/plans/matcher-dnr-mock-plan.md`

## Implementation phases

1. **Extension adapter / projection** — Add DNR action mapping for matcher operations (`redirect`, `query`, `header`) in `packages/extension/src/projection.ts` and `packages/extension/src/installer.ts`. Ensure `header` rules install via DNR adapter (not just `installHeaderRules` branch). Verify `dnrManagedOps` includes all matcher kinds that have actions.
2. **Service-worker status consolidation** — Remove `needs proxy` from `operationStatuses` (line 159, 175, 193). Remove mock-phase tracking (`mockConnected`, `mockTokens`, `MockRuntimeConnection`, `connectNativeMock` references). Consolidate to unified native runtime (`stopped`/`started`/`failed`). Update badge computation and state response.
3. **Mock category removal** — Remove mock operation kind handling in `service-worker.ts` (`kind === "mock"`). Update fixtures/samples to replace mock rules with request-body/response-body rules. Remove mock-related docs/specs references if superseded.
4. **Tests and fixtures** — Update test assertions (`packages/extension/test/` and `packages/browser-core/test/`) that expect `needs proxy` or mock-phase states. Ensure matcher rules report `active` when installed.
5. **Documentation sync** — Update `docs/architecture.md`, docs-site guides (`packages/docs-site/src/content/docs/guides/`), plans (`f13-mock-rules.md` supersession note), and any README references to `needs proxy` or mock connection.
6. **Verify and review** — Run `pnpm validate` and confirm AC met.
