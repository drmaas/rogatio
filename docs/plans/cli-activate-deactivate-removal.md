# Plan: Remove `rogatio runtime activate|deactivate|status`

## Strategy

TDD by default (per `AGENTS.md`). For this change, the work splits into three
phases:

1. **CLI surface removal** — pure deletion. Tests already cover the
   `activate` / `deactivate` / `status` paths; we delete the test cases and
   the dispatch arms in lockstep, then re-run `pnpm validate`.
2. **Extension messaging refinement** — add the new
   `extension.request-body-needs-trust` reason and a status-level test
   alongside the existing host-missing test. UI render test is deferred per
   the user's choice.
3. **Docs scrub** — manual edits across README, samples, cli README, docs
   site, and overview.

## Phases

### Phase 1 — CLI surface

Files:

- `packages/cli/src/commands/runtime.ts`
  - delete `nativeRuntimeCommand` (lines 105-136)
  - delete `runtimeStatusCommand` (lines 225-239) — it was the only
    `runtime status` implementation
  - delete `loadControlPreset` (lines 241-251) — it is no longer referenced
  - drop `createNativeRuntimeController`, `normalizeRuntimePreset`,
    `RUNTIME_LIMITS` from the import on line 1-12 if they become unused
  - update `showRuntimeHelp` (lines 21-52): remove the "Native runtime
    commands" block; keep the request-body trust commands and the
    `host [path]` block
  - update the dispatch in `runtimeCommand` (lines 374-401): remove
    `first === "status"` and `first === "activate" || first === "deactivate"`
    branches; update the "no longer starts an HTTP mock server" error
    message to list the remaining valid subcommands
- `packages/cli/src/index.ts`
  - update `showHelp` (line 116): drop `activate|deactivate|status`
  - update `showRuntimeHelp` (lines 162-201): drop the "Native runtime
    commands" block; keep `host [path]` and the request-body trust block
- `packages/cli/test/runtime-command.test.ts`
  - delete the `activate` and `deactivate` cases (lines 22-44); keep the
    help / unknown / `host` / `install` / `trust` cases
- `packages/cli/test/runtime-command-gating.test.ts`
  - delete the "activate without extension policy" test (lines 56-61) — the
    trust gating test in the runtime module still covers the underlying
    mechanism

Tests first: confirm the current tests pass on `main`, then make the
deletions, then re-run. The deletes will turn the existing activate /
deactivate / status cases into "unknown subcommand" exits, which is
exactly the new behavior. We do not author new tests for the unknown
subcommand path beyond the existing unknown-subcommand case at the bottom
of `runtime-command.test.ts`.

### Phase 2 — Native framing dead code

- `packages/runtime/src/native-framing.ts:14` — delete the
  `RuntimeActivate` enum member. Verify no other file references it
  (search should return only this file).

### Phase 3 — Extension messaging

Files:

- `packages/extension/src/diagnostics.ts`
  - add a new diagnostic mapping for
    `extension.request-body-needs-trust` alongside
    `extension.native-host-missing` (lines 53-54)
- `packages/extension/src/extension-page-entry.ts`
  - in the start-failure branch (lines 810-830), distinguish
    `extension.request-body-needs-trust` from
    `extension.native-host-missing` and render the appropriate command
    (`rogatio runtime trust` vs `rogatio runtime install --extension-id ...`)
- `packages/extension/src/service-worker.ts`
  - in the start-failure mapping (lines 577-585), add the new
    `extension.request-body-needs-trust` reason and a way to distinguish it
    from host-missing. The actual classification lives in
    `startNativeSession`; this PR adds the new `reason` value and lets the
    UI render the right command
- `packages/extension/test/status.test.ts`
  - add a status-level test that, for a project with request-body rules
    but no trust, surfaces the new reason. (UI render test is deferred.)

The new diagnostic and the new reason are pure additions. The classification
itself (how the host decides "this is request-body-needs-trust, not
host-missing") lives in the runtime; for this change we only need the UI to
distinguish the two reasons.

### Phase 4 — Docs scrub

Files:

- `README.md:128` — drop the `runtime <activate|deactivate|status>` row;
  keep `install|trust|untrust|uninstall` and `host`

> Superseded by: feat/collapse-runtime-uninstall-and-untrust
- `README.md:156-181` (Mock rules section) — remove
  `rogatio runtime activate` / `deactivate`; reword to "Start the runtime
  from the extension's Start/Stop controls"
- `samples/basic/README.md:95-125` — rewrite step 6 to use the extension's
  Start/Stop buttons; reorder so install happens first
- `packages/cli/README.md:42` — drop activate/deactivate/status
- `packages/docs-site/src/content/docs/guides/runtime.md:12-15` — drop
  activate/deactivate/status
- `packages/docs-site/src/content/docs/reference/cli.md:32-36` — drop
  activate/deactivate/status
- `packages/docs-site/src/content/docs/reference/platforms.md:22-25` —
  drop activate/deactivate/status
- `packages/docs-site/src/content/docs/rules/mocks.md:18-20` — drop
  `rogatio runtime activate`; reword to extension Start
- `rogatio-overview.md:28,35` — drop the activate line; update the
  lifecycle sentence to use extension Start/Stop (user authorized the edit
  to this frozen file)

## Validation

`pnpm validate` after each phase. The CLI deletion phase is a small
typecheck + test cycle. The extension phase exercises the status-level
test. The docs phase is a no-op for `pnpm validate` but is part of the
user-facing acceptance criteria.

## Risk

Low. The deleted surface is undocumented in real use (the only documentation
that mentions it is the docs we are editing). The extension's Start/Stop
controls already bypass this CLI. The trust lifecycle is real but is
unchanged.

The biggest risk is the extension messaging: we have to ensure that the new
`request-body-needs-trust` reason is reachable. The runtime must surface it
correctly when a project has request-body rules and trust is not
established. The status-level test in this PR is enough to lock the
classification; a follow-up PR can add the UI render test.
