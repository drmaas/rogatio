# In-UI doctor checks — workflow

> Status: implemented (issue #319).
> Spec: [spec.md](./spec.md)

## Steps

1. Wrote `spec.md` and `plan.md` under `docs/decisions/ui-doctor/` after reading issue #319, `docs/decisions/doctor/spec.md`, and the #317 doctor runner.
2. Implemented the extension report, the editor route, and the docs in this branch.
3. Ran `pnpm validate` on this branch before opening the pull request.

## Evidence

`pnpm validate` completed successfully on 2026-10-08: format, lint, typecheck, build, 177 unit files (1765 tests), and browser smoke (100 passed, 9 skipped).
