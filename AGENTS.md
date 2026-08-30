# Agent Orientation

## Repository State

Read `rogatio-overview.md` and `docs/architecture.md` before changing scope. Respect the documented package boundaries and non-goals; do not expand scope beyond the current feature without an explicit change.

## Durable Documentation

- Specifications belong in `docs/specs/`; brainstorm output stays ephemeral.
- Implementation plans belong in `docs/plans/`.
- Architecture decisions belong in `docs/architecture.md`.
- Raw brainstorm output is ephemeral; do not create or retain brainstorm documents. Prompt before deleting existing brainstorm files.
- Workflow logs record stage status, approvals, review rounds, verification evidence, and release state.
- Documentation changes must keep `docs/architecture.md`, `README.md`, `AGENTS.md`, and any affected specification, plan, or workflow log synchronized.

## Agent Model Tiers

Every workflow must choose one agent tier at the start and use it for every delegated role. If the user did not specify `free` or `normal`, ask them to choose before delegating work:

- **Free:** Route each phase to its documented primary model, falling back to the documented fallback only when the primary is unavailable. Never silently substitute an unlisted free model, a paid model, or the session model; the free catalog spans both OpenCode Zen free and OpenRouter free. If both primary and fallback are unavailable, stop and ask the user to switch tiers or explicitly approve a replacement.
- **Normal:** Use the existing role-specific model chains below. Before using a paid normal model, check whether the exact model or a clearly equivalent free OpenCode Zen model is available; prefer that free equivalent. Do not substitute a merely convenient or unrelated free model and call it equivalent. Normal mode may fall back through its existing provider chain and finally the session model.

The free catalog spans the current OpenCode Zen free provider and OpenRouter free models:

OpenCode Zen free:

- `opencode/x-preview-f-free` (Ox Alpha Free)
- `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free)
- `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free)
- `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free)
- `opencode/hy3-free` (Hy3 Free)
- `opencode/mimo-v2.5-free` (MiMo V2.5 Free)
- `opencode/big-pickle` (Big Pickle)

OpenRouter free:

- `openrouter/poolside/laguna-s-2.1:free` (Laguna S 2.1)
- `openrouter/thinkingmachines/inkling-small:free` (Inkling Small)
- `openrouter/dots-studio/dots-3-note-preview:free` (Dots3-Note Preview)

Free mode routes each phase to a primary model with a documented fallback. If the primary is unavailable, use the fallback rather than the session model or a paid provider; never silently substitute an unlisted model. Phase-to-model routing is defined per workflow in the `sdd` and `doit` skills. The canonical phase routing is:

| Phase | Primary | Fallback |
| --- | --- | --- |
| Brainstorm / architecture | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Specification | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Tests authoring | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation (code) | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Verification / debug loop | `opencode/nemotron-3.5-lightning-free` | `openrouter/poolside/laguna-s-2.1:free` |
| Independent review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Documentation | `opencode/hy3-free` | `openrouter/dots-studio/dots-3-note-preview:free` |

Normal-tier role chains remain:

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- Adversarial brainstorm: `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- Implementation plans and independent review: `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/anthropic/claude-sonnet-5` → session model.
- Verification and documentation: `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

Verify model availability once at workflow start with `opencode models` or the session's provider list. Record the selected tier and the model that served each role; record normal-tier fallbacks as notes, while free-tier unavailability pauses the workflow. A missing preferred model is never an excuse to silently widen scope or skip a stage. Under a single-model session, keep the role passes distinct and use a fresh-context self-review.

The `sdd` and `doit` skills repeat the operational tier-selection rules and role defaults so they remain usable when loaded independently.

## Repository Rules

- Preserve the documented pnpm `10.32.1`, Node 24 baseline, TypeScript 7, and ESM/NodeNext constraints unless the specification is explicitly revised.
- Keep package boundaries and dependency direction explicit.
- Do not commit generated build output, coverage, browser binaries, dependency directories, environment files, or secrets.
- Every commit must reference an open issue (`#<NN>` or `Closes #<NN>`); the `.husky/commit-msg` hook enforces this. Before committing, reuse an existing issue or create one automatically, and confirm the issue number with the user rather than inventing one. See `CONTRIBUTING.md`.
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

**Enter the worktree FIRST.** Before ANY specification, architecture, brainstorm output, plan, test, or code change — create or enter the feature worktree and confirm the shell is operating in it. No edits of any kind (including `docs/specs/`, `docs/plans/`, `docs/architecture.md`) happen in the main checkout.

Use a dedicated feature worktree for implementation. Before declaring an implementation complete, run the project validation sequence and record evidence against the relevant acceptance criteria. Before release, audit staged, unstaged, tracked, and untracked files for unrelated changes, generated output, local settings, and secrets. A single explicit user authorization for a clearly defined set of commit, push, PR, merge, or cleanup actions remains valid for that set; ask again only when authorization is absent, ambiguous, or scope changes. Never force-push or push directly to a protected default branch. After merge, reconcile release/status documentation and verify the default branch, worktrees, and remote refs are in the intended final state.

Always prompt before deleting files or directories.

## Worktree Convention

All implementation work uses a dedicated git worktree created with `git worktree add`, never the `opencode-worktree` plugin.

- Worktrees always live at `/home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name>`.
- Create a worktree with `git worktree add -b <branch> /home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name> <baseBranch>`.
- After creating, run the project setup in the new worktree (e.g. `pnpm install`) and confirm the shell is operating there.
- Tear down with `git worktree remove /home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name>` (auto-commit your changes first).
- Exception: the pre-existing manual worktree `~/Projects/github/drmaas/rogatio-f7` (branch `feature/f7-extension-shell`) remains in place.
