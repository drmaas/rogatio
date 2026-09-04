# Workflow: Remove `rogatio runtime activate|deactivate|status`

## 2026-09-02 — plan approved

User approved the plan in `plan.md` with five explicit decisions:

1. `runtime status` is removed (not retained).
2. `runtime host` is retained.
3. Extension UI render test for the new diagnostic branches is deferred;
   only the status-level reason mapping test is added.
4. `rogatio-overview.md` (a frozen source-of-truth document per
   `AGENTS.md`) is edited in place. The user explicitly authorized this.
5. The commit is `fix!:` — the surface was always broken (it didn't
   actually start or stop anything), so the fix is the deletion. The
   `!` marker covers the breaking change for downstream scripts that may
   have called `rogatio runtime activate`.

## Strategy

TDD by default. CLI surface removal is purely a delete of
implementation and test cases in lockstep. Extension messaging
refinement adds a new reason value plus a status-level test. Docs are
manual edits.

## Phases

### Phase 1 — CLI surface

- Edit `packages/cli/src/commands/runtime.ts`
- Edit `packages/cli/src/index.ts`
- Edit `packages/cli/test/runtime-command.test.ts`
- Edit `packages/cli/test/runtime-command-gating.test.ts`
- Run `pnpm --filter @rogatio/cli test` and `pnpm --filter @rogatio/cli
  typecheck`

### Phase 2 — Native framing dead code

- Edit `packages/runtime/src/native-framing.ts`
- Search to confirm no other references

### Phase 3 — Extension messaging

- Edit `packages/extension/src/diagnostics.ts`
- Edit `packages/extension/src/extension-page-entry.ts`
- Edit `packages/extension/src/service-worker.ts`
- Edit `packages/extension/test/status.test.ts`
- Run `pnpm --filter @rogatio/extension test`

### Phase 4 — Docs scrub

- Edit `README.md`
- Edit `samples/basic/README.md`
- Edit `packages/cli/README.md`
- Edit `packages/docs-site/src/content/docs/guides/runtime.md`
- Edit `packages/docs-site/src/content/docs/reference/cli.md`
- Edit `packages/docs-site/src/content/docs/reference/platforms.md`
- Edit `packages/docs-site/src/content/docs/rules/mocks.md`
- Edit `rogatio-overview.md`

### Phase 5 — Final validation and release

- `pnpm validate` (full repo)
- Annotate the frozen `runtime-lifecycle-cli-rename` spec (if one
  exists) with a `> Superseded by:` footer
- Move the decision records from
  `docs/decisions/cli-activate-deactivate-removal/` to
  `docs/specs/cli-activate-deactivate-removal.md`,
  `docs/plans/cli-activate-deactivate-removal.md`, and
  `docs/workflows/cli-activate-deactivate-removal-workflow.md`
- Commit with `fix!:` body

## Reversal of the prior rename

Commit `5fbde2e` (`refactor(cli): rename runtime start/stop to
activate/deactivate (#49)`) and `f3b2232`
(`docs!: reconcile docs with breaking runtime activate/deactivate CLI
rename`) introduced the activate/deactivate surface in
`#49` and the docs reconciliation. The follow-up `#67`/`#68` pivot moved
specs/plans/workflows to append-only decision records. This change
reverses the CLI rename: the subcommands are gone, so neither name
(`start`/`stop` nor `activate`/`deactivate`) survives in the CLI. The
extension is the lifecycle owner.
