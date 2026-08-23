# Agent Orientation

## Repository State

Read `rogatio-overview.md` and `sequence.md` before changing scope. Respect the documented feature sequence, package boundaries, and non-goals; do not implement work assigned to a later sequence item without an explicit scope change.

## Durable Documentation

- Specifications belong in `docs/specs/`; brainstorm output stays ephemeral.
- Implementation plans belong in `docs/plans/`.
- Architecture decisions belong in `docs/architecture.md`.
- Raw brainstorm output is ephemeral; do not create or retain brainstorm documents. Prompt before deleting existing brainstorm files.
- Workflow logs record stage status, approvals, review rounds, verification evidence, and release state.
- Documentation changes must keep `docs/architecture.md`, `README.md`, `AGENTS.md`, and any affected specification, plan, or workflow log synchronized.

## Model Roles

The `sdd` and `doit` skills define the per-role model preferences and fallback chain. Summary:

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna`, falling back to `openrouter/openai/gpt-5.6-luna`, then the session model.
- Adversarial brainstorm: `opencode-go/minimax-m3`, falling back to `opencode-go/minimax-m2.7`, `openrouter/anthropic/claude-opus-5`, then the session model.
- Implementation plans and independent review: `opencode-go/glm-5.3`, falling back to `opencode-go/glm-5.2`, `openrouter/anthropic/claude-sonnet-5`, then the session model.
- Verification and documentation: `opencode-go/hy3`, falling back to `openrouter/openai/gpt-5.5`, then the session model.

Verify model availability once at workflow start with `opencode models opencode-go` (or the session's provider list). Record which model served each role; record a fallback as a note, not a blocker. A missing preferred model is never an excuse to silently widen scope or skip a stage. Under a single-model session (for example Freebuff), one model performs every role and the fresh-context review becomes a deliberate self-review pass that re-reads the final diff without the implementer's working notes.

## Repository Rules

- Preserve the documented pnpm `10.32.1`, Node 24 baseline, TypeScript 7, and ESM/NodeNext constraints unless the specification is explicitly revised.
- Keep package boundaries and dependency direction explicit.
- Do not commit generated build output, coverage, browser binaries, dependency directories, environment files, or secrets.
- Review new dependencies and install-script permissions before adding them.
- Use cross-platform Node-based scripts instead of Bash-only orchestration.
- Verify real test execution, emitted builds, and browser prerequisites; do not accept false-green checks.
- Run the repository's canonical validation command before declaring work complete.
- Keep negative fixtures outside normal typecheck and Biome inputs, and preserve their intended failures.
- Treat build manifests, package output, coverage, browser reports, browser binaries, and dependencies as generated or local-only.
- Before editing with multiple worktrees, verify `git rev-parse --show-toplevel`, the current branch, `git worktree list`, and repository status; never guess an absolute path.
- Treat untrusted input and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, and mutable shared state.
- For code that consumes untrusted structured data, include adversarial tests for those behaviors and other relevant malformed inputs.
- Keep public diagnostics and serialized output stable and independent of third-party wording or incidental iteration order.
- CI should run the same authoritative validation used locally rather than a weaker manually duplicated subset.
- Keep the proposed F5 editor as a framework-free, browser-safe DOM boundary: use host-supplied F2/F3 validation and save ports, preserve detached draft state, and do not import Node-only validation artifacts into browser output.

## Workflow

Use a dedicated feature worktree for implementation. Before declaring an implementation complete, run the project validation sequence and record evidence against the relevant acceptance criteria. Before release, audit staged, unstaged, tracked, and untracked files for unrelated changes, generated output, local settings, and secrets. A single explicit user authorization for a clearly defined set of commit, push, PR, merge, or cleanup actions remains valid for that set; ask again only when authorization is absent, ambiguous, or scope changes. Never force-push or push directly to a protected default branch. After merge, reconcile release/status documentation and verify the default branch, worktrees, and remote refs are in the intended final state.

Always prompt before deleting files or directories.
