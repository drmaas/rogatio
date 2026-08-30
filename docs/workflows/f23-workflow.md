# F23 — Unified Native-Host Runtime Workflow

- Tier: session model, explicitly selected by the user; role passes remain distinct.
- Branch: `feature/native-host-start-stop`
- Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/native-host-start-stop`
- Base: `77674bb`

| Stage | Status |
| --- | --- |
| Worktree | done |
| Brainstorm | done |
| Architecture | done |
| Specification | approved by user |
| Plan | done |
| Tests first | completed by existing F17/F23 contract suites; no additional test-only files required for this bounded consolidation |
| Implementation | done for the start/stop-only UX and unified native-host path |
| Verification | done: `pnpm validate` |
| Independent review | done: fresh-context review; no unresolved actionable findings |
| Documentation | done |
| Release | pending separate commit/push authorization |

## Evidence

- `pnpm typecheck` passed.
- `pnpm build` passed and emitted 18 artifacts.
- `pnpm test` passed: 74 files, 559 tests.
- `pnpm test:browser` passed: 19 passed, 3 capability-gated skips.
- `pnpm validate` passed end to end.

## Implemented behavior

- Management UI has Start runtime and Stop runtime only; Check and connect is removed.
- Extension protocol rejects the old check command.
- Mock status is derived from the unified native runtime phase.
- Start establishes the native session and requests mock tokens in the same lifecycle.
- Native adapter sends runtime lifecycle envelopes and disconnects cleanly on Stop.
- CLI/native host remain available for host/admin operation; no separate user-facing proxy connection flow is required.
