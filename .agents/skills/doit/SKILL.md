---
name: doit
description: Run a fast, execution-focused development workflow for well-understood software changes. Use this skill when the user wants to just get a clearly scoped change done, asks to skip formal specs or planning, or requests the lightweight counterpart to an SDD/TDD process. It keeps an isolated worktree, brainstorming, architecture checks, tests-first development, verification, up to three independent fresh-context review rounds, documentation, and release preparation, but deliberately skips the formal specification, human review gate, and implementation-plan stages.
compatibility: Requires Git with worktree support, the repository's existing development tools, and an independent review context or reviewer.
---

# Do-It Development Workflow

Use this as the fast counterpart to the `sdd` workflow. It is appropriate when the request is already clear, the behavior change is bounded, and delaying implementation for formal artifacts would add little value.

This workflow deliberately omits:

- A formal specification document.
- A formal human approval gate before implementation.
- A separate implementation plan.

Do not use those omissions to hide ambiguity. Ask blocking questions during brainstorming. If requirements, architecture, compatibility, security, or scope remain materially ambiguous, recommend switching to `sdd` rather than guessing.

## Operating rules

- Work in a dedicated feature worktree, not the main checkout.
- Match repository conventions, package manager, architecture, naming, and test tooling.
- Derive a concise set of behavioral notes and acceptance checks from the user's request and brainstorming. Keep them in the task, issue, PR description, or a lightweight workflow note rather than writing a formal specification.
- Write tests before production code whenever practical.
- Keep the change focused. Do not add speculative abstractions or unrelated refactors.
- Keep behavioral notes, architecture, tests, implementation, documentation, and verification consistent.
- Use existing scripts and dependencies. Do not install new tooling without approval.
- Record stage status, verification commands, review rounds, findings, and fixes.
- Commit, push, and PR creation are separate release actions. Obtain explicit user approval immediately before performing them; never force-push.

## Stage 0 — Enter an isolated worktree

1. Inspect the repository root, current branch, worktrees, status, recent conventions, and available package/test scripts.
2. Do not mix existing uncommitted user work into this change. Ask how to proceed if the base checkout is dirty or the intended base is unclear.
3. Create or enter a dedicated feature worktree and branch using the repository's naming convention.
4. Confirm the shell is operating in that worktree before editing files.
5. Record the base commit, branch, worktree path, requested outcome, and workflow checklist.

If the user supplied a worktree, verify that it is the intended feature worktree.

## Stage 1 — Brainstorm and scope

Quickly establish enough context to implement safely:

- Restate the requested outcome and affected users/callers.
- Inspect current behavior and the relevant code/documentation.
- Identify constraints, invariants, security/privacy concerns, compatibility requirements, and non-goals.
- Consider alternatives when the design is not obvious and choose the smallest sound approach.
- Write concise behavioral notes and acceptance checks, using stable IDs such as `AC-001` when useful. Keep them in the task/PR description, or persist them to `docs/specs/<feature>.md` if a durable note is warranted.
- Ask only questions that block a safe implementation. Do not wait for a formal approval packet.

If discovery reveals a substantial new product decision, cross-cutting architecture change, migration risk, or unclear user-visible behavior, stop and suggest using `sdd` for the change.

## Stage 2 — Architecture check

Perform a focused architecture pass before coding. Record only what is needed for implementation and review:

- Components/modules and responsibilities affected.
- Public APIs, data models, schemas, state transitions, and error paths.
- Data/control flow and important integration boundaries.
- Persistence, migration, concurrency, rollback, and compatibility behavior when relevant.
- Security boundaries, permissions, secrets, input validation, and observability.
- Extension points and testing seams.
- Alternatives rejected and why, when the choice is non-obvious.

Keep this proportional. Do not produce a formal architecture/specification package; a short note in the workflow log or task is sufficient. If a durable note is warranted, record the architecture in `docs/architecture.md` (human readable) and any ordering or plan notes in `docs/plans/<feature>.md`.

## Stage 3 — Write tests first

Translate the behavioral notes and acceptance checks into executable tests before implementation whenever the repository permits it.

- Cover normal behavior, boundaries, invalid input, failures, security constraints, and compatibility behavior relevant to the request.
- Use the narrowest appropriate level: unit tests for deterministic logic, integration tests for component boundaries, and end-to-end tests for real user journeys.
- Prefer real serializers, schemas, parsers, and boundaries over excessive mocks.
- Follow existing test naming and fixture conventions.
- Run the new tests before implementation when useful and record the expected red state.
- Do not weaken assertions merely to make an incomplete implementation pass.

If a test cannot be written first because of an integration or UI constraint, document the reason and write the closest executable contract before coding.

## Stage 4 — Write the implementation

Implement the smallest coherent change that satisfies the behavioral notes and tests.

- Preserve behavior outside the requested scope.
- Validate untrusted input at the correct boundary and return stable, actionable errors.
- Keep public names, schemas, migrations, generated files, and adapters synchronized.
- Avoid speculative abstractions and unrelated cleanup.
- If implementation exposes a new behavior decision, pause and ask the user rather than silently expanding scope.
- Update tests only for behavior that is within the already understood request; if behavior changes materially, switch to `sdd` or return to brainstorming.

## Stage 5 — Verification and tests

Run the complete relevant project verification suite, not only the new tests. Use the repository's equivalents of:

- Formatting and linting.
- Type checking or static analysis.
- Unit tests.
- Relevant integration tests.
- End-to-end browser or system tests.
- Build, packaging, migration, and generated-artifact checks when applicable.

Review the diff and test output together. Confirm that each acceptance check has evidence, tests do not rely on accidental implementation details, no unrelated files changed, and no secrets or local settings are included. Fix failures before review and record exact commands and results.

## Stage 6 — Independent fresh-context review loop

Review the completed change from an independent fresh context. Give the reviewer only the user request, behavioral notes, focused architecture note, final diff, and verification results—not the implementer's unstated reasoning.

Use a maximum of **three review rounds**:

1. Request findings ordered by severity, including missing behavior, incorrect assumptions, security/privacy issues, regressions, test gaps, maintainability concerns, and documentation gaps.
2. If there are no actionable findings, mark the review passed and continue.
3. If findings exist, route each to the earliest appropriate stage:
   - Unclear or changed behavior → Brainstorm and scope; ask the user if a decision is required.
   - Architecture, boundary, migration, or API issue → Architecture check, then implementation.
   - Missing or weak coverage → Tests first, then implementation and verification.
   - Implementation defect within the understood scope → Implementation, then verification.
   - Verification or release-process gap → Verification, then review.
   - Documentation-only issue → Documentation after the fix.
4. Re-run affected tests and verification after fixes, then start the next fresh review round.
5. Record the round number, reviewer context, findings, fixes, and evidence.

Never exceed three rounds. If actionable disagreement or findings remain after round three, stop and ask the user to decide rather than continuing an unbounded loop. If a finding shows the change was not actually well-scoped, switch to `sdd` instead of continuing to bypass its formal stages.

## Stage 7 — Documentation updates

After behavior and review findings are stable, update documentation that users and maintainers rely on. The following three files are **always** updated to reflect the latest changes, regardless of change size:

- `docs/architecture.md` — human-readable architecture: components, boundaries, data/control flow, and decisions affected by this change.
- `README.md` — human-readable project overview, setup, usage, and examples affected by this change.
- `AGENTS.md` — a concise record of the latest changes so agents working in the repository stay oriented.

Then update the rest of the documentation set as needed:

- User guides, CLI/API references, and examples.
- Configuration, migration, release, and troubleshooting documentation.
- Changelog or release notes when the repository uses them.

Document supported platforms, limitations, security behavior, and upgrade steps when relevant. Keep examples consistent with the implementation and run available documentation checks or generated-doc builds.

## Stage 8 — Commit, push, and PR

Before release actions, show the user the final summary, changed-file list, verification evidence, review-round result, and known limitations. Confirm that the worktree contains only intended changes.

With explicit user approval:

1. Review staged and unstaged diffs and recent commit-message conventions.
2. Stage only files belonging to this change; exclude secrets, local settings, generated noise, and unrelated user work.
3. Create a concise conventional commit when the repository uses conventional commits, describing why the change was made.
4. Push the feature branch to the expected remote. Never force-push or push directly to a protected default branch.
5. Open or update a pull request using the repository's supported tooling. Include the problem, solution, scope, tests/verification, review-round summary, documentation changes, migrations, and known risks.
6. Report the commit, branch, PR, and any remaining action required from the user.

If approval for any release action is absent, stop after preparing the exact proposed command or PR content. Do not infer permission to commit, push, merge, or deploy.

## Completion checklist

- [ ] Work happened in the intended feature worktree.
- [ ] Brainstorm/scope notes and the focused architecture decision are recorded (architecture in `docs/architecture.md`).
- [ ] No unresolved requirement or architecture ambiguity was guessed through.
- [ ] Tests were written first or the exception was documented.
- [ ] Relevant formatting, linting, type, unit, integration, E2E, and build checks pass.
- [ ] Fresh-context review passed within three rounds, or unresolved findings were escalated.
- [ ] `docs/architecture.md`, `README.md`, and `AGENTS.md` are updated with the latest changes.
- [ ] Other documentation and release notes are updated as needed.
- [ ] The user approved commit/push/PR actions before they were performed.
- [ ] The commit and PR contain only intended changes and include verification evidence.
