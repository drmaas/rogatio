# Agent Orientation

## Repository State

Rogatio has completed Feature 1, the monorepo and tooling bootstrap. Read `rogatio-overview.md` and `sequence.md` before changing scope. F1 must not implement schema, compiler, editor, extension, CLI, runtime, release, telemetry, or traffic-capture behavior.

## Durable Documentation

- Specifications belong in `docs/specs/`; brainstorm output stays ephemeral.
- Implementation plans belong in `docs/plans/`.
- Architecture decisions belong in `docs/architecture.md`.
- Raw brainstorm output is ephemeral; do not create or retain brainstorm documents. Prompt before deleting existing brainstorm files.
- Documentation changes must keep `docs/architecture.md`, `README.md`, and `AGENTS.md` synchronized.

## Model Roles

- Use `opencode-go/gpt-5.6-luna` for primary brainstorming, architecture synthesis, and SDD specification synthesis.
- Use `opencode-go/minimax-m3` for adversarial brainstorming.
- Use `opencode-go/glm-5.3` for implementation plans and independent review.
- Use `opencode-go/gpt-5.6-luna` for tests-first coding tasks.
- Use `opencode-go/hy3` for verification and documentation updates.
- Verify model availability before delegation and never silently substitute a different model.

## F1 Rules

- Preserve the documented pnpm `10.32.1`, Node 24 baseline, TypeScript 7 (pinned `7.0.2`), and ESM/NodeNext constraints unless the specification is explicitly revised.
- Keep package boundaries and dependency direction explicit.
- Do not commit generated build output, coverage, browser binaries, dependency directories, environment files, or secrets.
- Review new dependencies and install-script permissions before adding them.
- Use cross-platform Node-based scripts instead of Bash-only orchestration.
- Verify real test execution, emitted builds, and browser prerequisites; do not accept false-green checks.
- Run `pnpm validate` before declaring F1 bootstrap work complete.
- Keep negative fixtures outside normal typecheck and Biome inputs, and preserve their intended failures.
- Treat `build-manifest.json`, package `dist/`, coverage, Playwright output, browser binaries, and dependencies as generated or local-only.

## Workflow

Use a dedicated feature worktree for implementation. Keep the current uncommitted workflow-skill change separate from F1 work. Before declaring an implementation complete, run the project validation sequence and record evidence against the specification acceptance criteria. Do not commit, push, or create a PR without explicit user approval.

Always prompt before deleting files or directories.
