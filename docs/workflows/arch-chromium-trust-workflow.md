> Status: frozen 2026-10-14

# Workflow: arch-chromium-trust

Audience: agent

Flow: doit. RPI unfit: issue #354 already bounds the behavior, and the user asked to land it without a research gate.

## Models

- reasoning: parent session. Fit: synthesis of an existing issue. Complexity: medium, security-sensitive sudo path.
- adversarial: grok-4.7-high-fast. Different family. Blocked the first design. The implemented design follows that review: no `trust anchor --store` on the anchors file, no invented anchors directory, recorded manifest dirs, restore previous bytes, non-`ENOENT` probe errors exclude a browser.
- plan: parent session.
- coding: parent session. A fresh coding agent would not have held the adversarial corrections.
- verify: parent session, real commands.
- review: grok-4.7-high-fast. gpt-5.6-sol-medium, gemini-4-argon-medium, and claude-sonnet-5-5-high were quota-blocked.
- docs: parent session.

## Stages

- [x] Stage 0 worktree `/home/drmaas/Projects/github/drmaas/rogatio-worktrees/arch-chromium-trust` branch `feature/arch-chromium-trust` base `f985ab7`
- [x] Stage 1 brainstorm plus adversarial review
- [x] Stage 2 plan recorded in this folder
- [x] Stage 3–4 tests and implementation
- [x] Stage 5 `pnpm validate` exit 0 on 2026-10-14 before the round-3 installer cleanup (format, lint, typecheck, knip, build, exports, 1911 unit tests, 100 browser tests). Final re-run recorded below after that cleanup.
- [x] Stage 6 review round 1 (grok-4.7-high-fast). Two findings, both fixed:
  - Store removal ran after the CA key was deleted, so a failed `update-ca-trust` made the next uninstall skip the store and report success. A `.rogatio-ca-store-pending` marker keeps the retry on the remover.
  - A missing directory record treated every current browser config as required, so an older Chrome-only install failed verify after Chromium's config appeared. With no record, verify requires only manifests that already exist.
- [x] Stage 6 review round 2 (grok-4.7-high-fast). One code finding, fixed: a p11-kit remover returned before `update-ca-trust` when the anchors file was already gone, so a failed refresh could not be retried. p11-kit removal now refreshes even when the file is absent. Debian still skips that refresh when no anchors file is present. Architecture uninstall text now mentions `.rogatio-ca-store-pending`.
- [x] Stage 6 review round 3 (grok-4.7-high-fast). Debian `unlinkSync` without `update-ca-certificates` stays. That remover contract and its test are existing behavior, not a regression. p11-kit install now deletes the anchors file and runs `update-ca-trust` again when the first refresh fails, then still throws. A blanket pending marker on every installer throw was rejected: a cancelled install must not call the store remover.
- [x] Stage 7 living docs: `docs/architecture.md`, `packages/docs-site/src/content/docs/reference/platforms.md`
- [x] Stage 8 freeze onto `docs/plans/arch-chromium-trust.md`, `docs/plans/arch-chromium-trust-notes.md`, and `docs/workflows/arch-chromium-trust-workflow.md`. Release commit follows on this branch.

## Evidence

`pnpm exec vitest run --project unit` on the trust detect, linux install, trust controller, and path tests: 115 passed, exit 0, after `pnpm build`.

`pnpm validate` on 2026-10-14, after the round-3 installer cleanup, exited 0. Format, lint, typecheck, knip, build, and exports passed. Unit: 181 files, 1912 tests. Browser: 100 passed, 9 skipped. An earlier run of the same command failed only because `127.0.0.1:4173` was already bound; that process was stopped and this re-run succeeded.
