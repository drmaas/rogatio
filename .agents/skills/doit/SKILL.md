---
name: doit
description: Run a fast, execution-focused development workflow for well-understood software changes. Use this skill when the user wants to just get a clearly scoped change done, asks to skip formal specs or planning overhead, or requests the lightweight counterpart to an SDD/TDD process. It keeps an isolated worktree, ephemeral model-assisted brainstorming, a lightweight plan with a focused architecture note, tests-first model-assisted coding, model-assisted verification, fresh-context review, documentation, and release preparation, but deliberately skips the formal specification and human review gate.
compatibility: Requires Git with worktree support, the repository's existing development tools, and an independent review context or reviewer.
---

# Do-It Development Workflow

Use this as the fast counterpart to the `sdd` workflow. It is appropriate when the request is already clear, the behavior change is bounded, and delaying implementation for formal artifacts would add little value.

This workflow deliberately omits:

- A formal specification document.
- A formal human approval gate before implementation.

It keeps planning lightweight: a short, ordered plan with a focused architecture note (see Stage 2) is written up front rather than a heavyweight specification-and-plan package.

Do not use those omissions to hide ambiguity. Ask blocking questions during brainstorming. If requirements, architecture, compatibility, security, or scope remain materially ambiguous, recommend switching to `sdd` rather than guessing.

## Operating rules

- Work in a dedicated feature worktree, not the main checkout.
- Before editing with multiple worktrees, verify `git rev-parse --show-toplevel`, the current branch, `git worktree list`, and repository status; use the confirmed root for absolute paths.
- Match repository conventions, package manager, architecture, naming, and test tooling.
- Derive a concise set of behavioral notes and acceptance checks from the user's request and ephemeral brainstorming. Keep them in the task, issue, PR description, or a lightweight workflow note rather than writing a formal specification or retaining raw brainstorm files.
- Write a lightweight, ordered plan before tests or code.
- Write tests before production code whenever practical.
- Keep the change focused. Do not add speculative abstractions or unrelated refactors.
- Keep behavioral notes, architecture, plan, tests, implementation, documentation, and verification consistent.
- Use existing scripts and dependencies. Do not install new tooling without approval.
- Record stage status, verification commands, review rounds, findings, and fixes.
- Treat untrusted values and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, malformed encodings, and mutable shared state when relevant.
- Keep public diagnostics and serialized output deterministic and independent of third-party wording or incidental iteration order.
- After implementation or review fixes, rerun the repository's canonical validation command; CI should run that same authoritative command rather than a weaker duplicate.
- Before release operations, audit staged, unstaged, tracked, and untracked files for secrets, local settings, generated artifacts, unrelated changes, and accidental edits outside the worktree.
- Keep state-inspection commands clearly scoped so branch, path, and status output cannot be confused; a failed or malformed tool call is a no-op, not a reason to guess.
- Commit, push, PR creation, merge, and cleanup are separate release actions for audit purposes, but one explicit authorization for a clearly defined set remains valid for that set. Ask again only when authorization is absent, ambiguous, or the scope changes; never force-push or push directly to a protected default branch. Prompt immediately before deleting files/directories or removing worktrees.

## Agent Model Tiers

Choose exactly one tier before Stage 1 and carry that tier through every role in the workflow. If the user did not specify `free` or `normal`, ask them to choose before delegating work. Do not silently change tiers mid-workflow.

### Free tier

Free tier uses the OpenCode Zen free catalog and OpenRouter free models. Current exact model IDs are:

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

Free mode routes each phase to a primary model with a documented fallback. If the primary is unavailable, use the fallback rather than the session model or a paid provider. Never silently substitute an unlisted model; if both primary and fallback are unavailable, stop and ask the user to switch to normal tier or explicitly approve a replacement.

#### doit free-phase routing

| Stage | Phase | Primary | Fallback |
| --- | --- | --- | --- |
| 1 | Brainstorm and scope | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 2 | Architecture note and lightweight plan | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 3 | Tests first | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| 4 | Implementation | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| 5 | Verification and tests | `opencode/nemotron-3.5-lightning-free` | `openrouter/poolside/laguna-s-2.1:free` |
| 6 | Independent fresh-context review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 7 | Documentation | `opencode/hy3-free` | `openrouter/dots-studio/dots-3-note-preview:free` |
| 8 | Release actions | No delegated model; require user authorization | |

Nemotron Ultra Free is the primary for the reasoning-heavy scope pass, with Hy3 as fallback. Implementation and tests use Laguna S 2.1 with Inkling Small as fallback; verification uses Nemotron 3.5 Lightning with Laguna S 2.1 as fallback; review uses Nemotron 3 Ultra with Inkling Small so it stays separate from the implementation model.

### Normal tier

Normal tier retains the existing role chains, but prefers an exact or clearly equivalent free OpenCode Zen model before a paid normal model. The current exact equivalence is `opencode/hy3-free` for the existing `opencode-go/hy3` verification/documentation role. Other free models are alternatives by capability, not automatic equivalents.

- **Primary brainstorm:** `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- **Adversarial brainstorm:** `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- **Architecture + plan:** `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/openai/gpt-5.5` → session model.
- **Tests and coding:** `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → `opencode-go/kimi-k2.7-code` → session model.
- **Verification and documentation:** `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

### Selection and recording

At workflow start, verify the selected tier's IDs with `opencode models` or the session's provider list. Record the selected tier, the model used for each role, and every fallback in the workflow log. A model report is not verification evidence; all required commands still run for real. Under a single-model session, keep the role passes distinct and perform the fresh-context review as a deliberate self-review.

## Stage 0 — Enter an isolated worktree

1. Verify the repository root with `git rev-parse --show-toplevel`, then inspect the current branch, worktrees, status, and available package/test scripts. If the checkout has uncommitted work, do not mix it in — ask how to proceed or branch from a clean known base.
2. Create or enter the dedicated feature worktree and branch using the repository's naming convention. Confirm the shell is operating in that worktree before editing.
3. Record base commit, branch, worktree path, requested outcome, and which models will serve each role. If the user supplied a worktree, verify it is the intended feature worktree before editing.

## Stage 1 — Brainstorm and scope

Quickly establish enough context to implement safely. Run the primary pass with the primary-brainstorm model, then give its result and repository evidence to the adversarial model for a challenge. Keep both raw outputs ephemeral and do not create `docs/specs/<feature>-brainstorm.md` files.

- Restate the requested outcome and affected users/callers.
- Inspect current behavior and the relevant code/documentation.
- Identify constraints, invariants, security/privacy concerns, compatibility requirements, and non-goals.
- Consider alternatives when the design is not obvious and choose the smallest sound approach.
- Write concise behavioral notes and acceptance checks, using stable IDs such as `AC-001` when useful. Keep them in the task/PR description, or persist them to `docs/specs/<feature>.md` if a durable note is warranted.
- Ask only questions that block a safe implementation. Do not wait for a formal approval packet.

Skip the adversarial pass only when the change is a pure documentation or config edit with no behavior, security, persistence, migration, public-API, or compatibility surface; record the skip reason.

If discovery reveals a substantial new product decision, cross-cutting architecture change, migration risk, or unclear user-visible behavior, stop and suggest using `sdd` for the change.

## Stage 2 — Architecture note and lightweight plan

Capture a short, ordered plan that another engineer could follow, preceded by a focused architecture note. Keep both proportional to the change — a few bulleted tasks and 2–4 architecture bullets are enough; do not produce a heavyweight specification-and-plan package.

Have the architecture+plan model write them. Record:

**Architecture note (only the non-obvious parts):**

- Components/modules and responsibilities affected.
- Public APIs, data models, schemas, state transitions, and error paths that change.
- Persistence, migration, concurrency, rollback, or compatibility behavior when relevant.
- Security boundaries, permissions, secrets, input validation, and observability when relevant.
- Alternatives rejected and why, only when the choice is non-obvious.

**Plan, one bullet per task:**

- The file, module, package, or configuration area it touches.
- The behavior or invariant being added or changed.
- Ordering constraints and dependencies on earlier tasks.
- The acceptance-check IDs it covers, when useful.
- The test or verification that proves it is done.

Persist the plan to `docs/plans/<feature>.md` when the change is large enough to outlive the session; otherwise keep it in the task or PR description. Record durable architecture decisions in `docs/architecture.md` only when the change shifts boundaries or decisions. If planning reveals scope or architecture ambiguity, return to Stage 1 rather than guessing.

## Stage 3 — Write tests first

Have the tests-and-coding model translate the behavioral notes and acceptance checks into executable tests before implementation whenever the repository permits it.

- Cover normal behavior, boundaries, invalid input, failures, security constraints, and compatibility behavior relevant to the request.
- Use the narrowest appropriate level: unit tests for deterministic logic, integration tests for component boundaries, and end-to-end tests for real user journeys.
- Prefer real serializers, schemas, parsers, and boundaries over excessive mocks.
- Follow existing test naming and fixture conventions.
- Run the new tests before implementation when useful and record the expected red state.
- Do not weaken assertions merely to make an incomplete implementation pass.

If a test cannot be written first because of an integration or UI constraint, document the reason and write the closest executable contract before coding.

## Stage 4 — Write the implementation

Have the tests-and-coding model implement the smallest coherent change that satisfies the behavioral notes and tests.

- Preserve behavior outside the requested scope.
- Validate untrusted input at the correct boundary and return stable, actionable errors.
- Keep public names, schemas, migrations, generated files, and adapters synchronized.
- Avoid speculative abstractions and unrelated cleanup.
- If implementation exposes a new behavior decision, pause and ask the user rather than silently expanding scope.
- Update tests only for behavior that is within the already understood request; if behavior changes materially, switch to `sdd` or return to brainstorming.

## Stage 5 — Verification and tests

Have the verification model drive the complete relevant project verification suite, not only the new tests. The workflow must still execute real commands and capture their output; a model report alone is not evidence. Use the repository's equivalents of:

- Formatting and linting.
- Type checking or static analysis.
- Unit tests.
- Relevant integration tests.
- End-to-end browser or system tests.
- Build, packaging, migration, and generated-artifact checks when applicable.

Review the diff and test output together. Confirm that each acceptance check has evidence, tests do not rely on accidental implementation details, no unrelated files changed, and no secrets or local settings are included. Fix failures before review and record exact commands and results.

## Stage 6 — Independent fresh-context review loop

Have the independent-review model review the completed change from a fresh context — a different model than the one that implemented whenever possible. Give it only the user request, behavioral notes, focused architecture note, plan, final diff, and verification results — not the implementer's unstated reasoning.

Use a maximum of **three review rounds**:

1. Round 1 is mandatory. Request findings ordered by severity: missing behavior, incorrect assumptions, security/privacy issues, regressions, test gaps, maintainability concerns, and documentation gaps.
2. If round 1 has no actionable findings, mark the review passed and continue.
3. Rounds 2 and 3 run only when round 1 produced findings. Route each finding to the earliest appropriate stage:
   - Unclear or changed behavior → Brainstorm and scope; ask the user if a decision is required.
   - Architecture, boundary, migration, or API issue → Architecture note and plan, then implementation and verification.
   - Missing or weak coverage → Tests first, then implementation and verification.
   - Implementation defect within the understood scope → Implementation, then verification.
   - Verification or release-process gap → Verification, then review.
   - Documentation-only issue → Documentation after the fix.
4. Re-run the canonical validation command and any affected tests after fixes, then start the next fresh review round.
5. Record the round number, reviewer context, findings, fixes, and evidence.

Never exceed three rounds. If actionable disagreement or findings remain after round three, stop and ask the user to decide rather than continuing an unbounded loop. If a finding shows the change was not actually well-scoped, switch to `sdd` instead of continuing to bypass its formal stages.

## Stage 7 — Documentation updates

After behavior and review findings are stable, have the documentation model update the files this change actually touches. Update at minimum:

- `docs/architecture.md` when the change alters components, boundaries, data/control flow, or decisions.
- `README.md` when the change alters setup, usage, or examples visible to users.
- `AGENTS.md` orientation line when the change shifts what an agent working in the repo needs to know first.

Then update the rest of the documentation set as needed: user guides, CLI/API references, examples, configuration, migration, release, and troubleshooting docs; changelog or release notes when the repository uses them.

Document supported platforms, limitations, security behavior, and upgrade steps when relevant. Keep examples consistent with the implementation and run available documentation checks or generated-doc builds. Record final release/status changes in the established workflow documentation.

## Stage 8 — Commit, push, PR, merge, and cleanup

Before release actions, show the user the final summary, changed-file list, verification evidence, review-round result, and known limitations. Confirm that the worktree contains only intended changes.

With explicit user approval for the defined release-action set (an existing authorization remains valid unless it is absent, ambiguous, or the scope changes):

1. Verify the active repository root, branch, worktree list, status, and recent commit-message conventions.
2. Review staged, unstaged, tracked, and untracked files and diffs; exclude secrets, local settings, generated noise, and unrelated user work.
3. Create a concise conventional commit when the repository uses conventional commits, describing why the change was made.
4. Push the feature branch to the expected remote. Never force-push or push directly to a protected default branch.
5. Open or update a pull request using the repository's supported tooling. Include the problem, solution, scope, tests/verification, review-round summary, documentation changes, migrations, and known risks.
6. When merge is in scope and authorized, wait for required checks and merge without bypassing branch protections.
7. After merge, reconcile release/status documentation and verify the default branch, worktrees, local branches, and remote refs. Remove worktrees, local branches, or merged remote branches only when cleanup is in scope; prompt immediately before deleting files/directories or removing worktrees.
8. Report the commit, branch, PR, merge result, cleanup result, verification evidence, and any remaining action required from the user.

If approval for any release action is absent or ambiguous, stop after preparing the exact proposed command or PR content. Do not infer permission to commit, push, merge, deploy, or delete.

## Completion checklist

- [ ] Work happened in the intended feature worktree.
- [ ] Primary and adversarial brainstorm passes were completed ephemerally (or the skip was recorded with reason); only the focused architecture decision is retained (architecture in `docs/architecture.md` when applicable).
- [ ] Each role's model was checked; fallbacks were recorded, not silently substituted.
- [ ] A lightweight, ordered plan with a focused architecture note is recorded (in `docs/plans/<feature>.md` or the task/PR description).
- [ ] No unresolved requirement or architecture ambiguity was guessed through.
- [ ] Tests were written first or the exception was documented.
- [ ] Relevant formatting, linting, type, unit, integration, E2E, and build checks pass.
- [ ] The canonical validation command was rerun after implementation and after later fixes; CI runs the same authoritative validation.
- [ ] Fresh-context review passed within three rounds, or unresolved findings were escalated.
- [ ] Documentation this change touches is updated (architecture, README, AGENTS as applicable).
- [ ] The user approved commit/push/PR actions before they were performed.
- [ ] The final release audit covered staged, unstaged, tracked, and untracked files; the commit and PR contain only intended changes and include verification evidence.
- [ ] After merge, release/status documentation, the default branch, worktrees, local branches, and remote refs were reconciled and verified.
