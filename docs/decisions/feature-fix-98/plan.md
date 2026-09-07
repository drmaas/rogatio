# Fix #98: Dashboard status/activation

Tier: FREE (openrouter only). Worktree: feature/fix-98-dashboard.

Problem: Dashboard shows stale `needs proxy` (from removed proxy runtime) and confusing error states; service-worker tracks separate `MockRuntimePhase`/`NativeRuntimePhase` instead of unified native phase per consolidated spec.

Fix scope (per issue #98):
- Service-worker `operationStatuses`: consolidate to single `NativeRuntimePhase`; `needs proxy` reflects `native !== started` only (not separate mock disconnect); remove `unsupported` gate logic tied to adapter absence.
- Keep `needs proxy` status label in model (it maps to native host state, not proxy); remove separate mock-phase tracking.
- Update banner/status messages to be actionable.

Plan:
1. Update `packages/extension/src/service-worker.ts` (operationStatuses, phase tracking, banner text).
2. Update related docs/status references.
3. Verify with `pnpm validate`.
