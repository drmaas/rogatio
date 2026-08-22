# Agent Orientation

## Repository State

Rogatio has released Feature 1, the monorepo and tooling bootstrap, and Feature 2, the schema package. Feature 3 compiler work is isolated to the `feature/f3-compiler` worktree and specified in `docs/specs/f3-compiler.md` until its release is complete. Read `rogatio-overview.md` and `sequence.md` before changing scope. F1 must not implement schema, compiler, editor, extension, CLI, runtime, release, telemetry, or traffic-capture behavior.

## Durable Documentation

- Specifications belong in `docs/specs/`; brainstorm output stays ephemeral.
- Implementation plans belong in `docs/plans/`.
- Architecture decisions belong in `docs/architecture.md`.
- Raw brainstorm output is ephemeral; do not create or retain brainstorm documents. Prompt before deleting existing brainstorm files.
- Documentation changes must keep `docs/architecture.md`, `README.md`, and `AGENTS.md` synchronized.

## Model Roles

The `sdd` and `doit` skills define the per-role model preferences and fallback chain. Summary:

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna`, falling back to `openrouter/openai/gpt-5.6-luna`, then the session model.
- Adversarial brainstorm: `opencode-go/minimax-m3`, falling back to `opencode-go/minimax-m2.7`, `openrouter/anthropic/claude-opus-5`, then the session model.
- Implementation plans and independent review: `opencode-go/glm-5.3`, falling back to `opencode-go/glm-5.2`, `openrouter/anthropic/claude-sonnet-5`, then the session model.
- Verification and documentation: `opencode-go/hy3`, falling back to `openrouter/openai/gpt-5.5`, then the session model.

Verify model availability once at workflow start with `opencode models opencode-go` (or the session's provider list). Record which model served each role; record a fallback as a note, not a blocker. A missing preferred model is never an excuse to silently widen scope or skip a stage. Under a single-model session (for example Freebuff), one model performs every role and the fresh-context review becomes a deliberate self-review pass that re-reads the final diff without the implementer's working notes.

## F1 Rules

- Preserve the documented pnpm `10.32.1`, Node 24 baseline, TypeScript 7, and ESM/NodeNext constraints unless the specification is explicitly revised.
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
