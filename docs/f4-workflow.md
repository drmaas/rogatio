# F4 Workflow Log

## Scope and Preflight

- **Feature:** F4 - `browser-core` package
- **Base commit:** `c23ad64`
- **Branch:** `feature/f4-browser-core`
- **Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f4`
- **Workflow:** doit (user requested implementation directly; no formal specification gate)
- **Implementation authorization:** The user's explicit \"enter a worktree and implement the F4 feature\" request authorizes implementation within the documented F4 scope from `sequence.md` and `rogatio-overview.md`.
- **Release authorization:** Not yet granted; commit, push, PR, merge, and cleanup remain pending explicit user approval.

## Stage Status

- [x] Stage 0 - isolated worktree and model availability preflight
- [x] Stage 1 - primary and adversarial brainstorming; raw outputs remain ephemeral
- [x] Stage 2 - architecture note and lightweight plan in `docs/plans/f4-browser-core.md`
- [x] Stage 3 - tests first; focused suite was intentionally red before source creation
- [x] Stage 4 - implementation
- [x] Stage 5 - verification and evidence
- [x] Stage 6 - fresh-context self-review (single-model session; rounds completed: 1 of 1)
- [x] Stage 7 - documentation updates
- [ ] Stage 8 - release actions (awaiting user authorization)

## Model Roles

- Single-model session (Freebuff, `z-ai/glm-5.2`): every role, recorded as the documented fallback for each role. Model availability was checked against the session's provider list; no multi-model delegation was available in this session.
- Role passes were kept distinct: brainstorm -> adversarial challenge -> architecture/plan -> tests -> implementation -> verification -> fresh-context self-review of the final diff.

## Brainstorm Synthesis

The primary pass derived the F4 slice from `sequence.md` (versioned project storage, migrations, permissions, enablement, compare-and-swap lifecycle, atomic rule install/recovery, runtime state, diagnostics, badge state, and the rule status model) and `rogatio-overview.md` (64 uniquely named projects, exactly one active whenever any exist, explicit Switch with saved enablement restoration, groups disabled on creation/import/save, conflicts preserving committed state, grants limited to declared site access, rule statuses, and the badge reflecting installed active rules).

The adversarial pass challenged scope creep (no Chrome/DNR APIs, no actions or rule kinds, no editor/CLI/extension UI, no runtime persistence), invented product behavior (deterministic defaults were documented rather than hidden), CAS atomicity semantics, the storage trust boundary (light structural checks on read, full F2/F3 validation on write), dead abstraction risk for `needs proxy`/`unsupported` (kept as defined model members that F4 never produces), install concurrency, and diagnostics hygiene. No blocking questions remained; all product behaviors were already documented in the overview.

## Architecture Decisions

- `@rogatio/browser-core` is a private ESM package depending only on `@rogatio/schema` and `@rogatio/compiler`, built as a Node ESM artifact with both externalized. Chrome/WebExtensions/DNR translation and MV3 packaging stay with the later extension boundary.
- Storage is one versioned envelope (`version`, project record, `activeProjectId`) behind a `StorageAdapter` whose `compareAndSwap` is the atomicity authority; the repository retries transient CAS failures and returns explicit `conflict` results (committed project preserved) for editor-style saves and strict imports carrying an expected revision.
- Reads defensively snapshot raw storage (own data only; cycles, symbols, accessors, proxies, sparse arrays, and unknown versions fail closed with `core.storage-corrupt`); project data is validated through the complete F2/F3 boundary at write time.
- Deterministic product defaults: the first created/imported project activates; removing the active project activates the most recently updated remaining project (tie-break: smallest id); names are unique by exact match; data commits reset enablement and prune grants to the newly declared origins.
- Statuses derive from compiled operations, saved enablement, granted origins, and installed rule ids; `active` / `disabled` / `needs permission` / `error` are produced by F4, while `needs proxy` and `unsupported` remain model members for later runtime-dependent slices. The badge is a pure function of statuses.
- `InstallService` serializes concurrent applies, no-ops on identical sets, and rolls back to the previous set on install failure with stable `core.install-failed` / `core.recovery-failed` diagnostics.
- Runtime state (mock check-and-connect with last-check; native start/stop) is an in-memory guarded transition model; persistence is deferred to the runtime slices.

## Tests-First Evidence

Tests were written before production source in `packages/browser-core/test/` (migrate, repository, status, install, runtime suites, 69 tests initially). After package metadata and the lockfile were in place, `pnpm exec vitest run packages/browser-core/test/` failed as expected: all five suites could not resolve `../src/index.js`. The red result was recorded before any production code existed. The suite later grew to 71 tests with the racing-import regression tests added during review.

## Implementation and Verification Evidence

- Added the private ESM `@rogatio/browser-core` package with exact workspace dependencies on `@rogatio/schema` and `@rogatio/compiler`.
- Added the versioned envelope and defensive migration (`ENVELOPE_VERSION = 1`, `migrateEnvelope`, `createEmptyEnvelope`), the `ProjectRepository` over `StorageAdapter` with CAS lifecycle and the single-active invariant, `computeDesiredRules` / `computeRuleStatuses` / `computeBadge` / `computeDeclaredOrigins`, `InstallService` with rollback and serialization, the guarded in-memory `RuntimeStateController`, and stable `core.*` diagnostics.
- Updated the negative dependency fixture to the still-absent `@rogatio/extension` package; the root build emits six ESM artifacts including browser-core; `pnpm validate` executes the emitted browser-core module (create, switch, statuses, badge) and enforces the `schema -> compiler -> browser-core` dependency direction with no downstream dependencies.
- Final `pnpm validate` passed in this worktree:
  - `pnpm install --frozen-lockfile` passes with the updated lockfile.
  - Format and lint checks pass across 57 files with no warnings.
  - Strict TypeScript typecheck passes (the negative extension fixture fails with its expected missing-module diagnostic).
  - Root build emits and checks six ESM artifacts.
  - Vitest passes 105 tests across 9 files, including 71 browser-core tests.
  - The three negative TypeScript fixtures fail with their expected diagnostics.
  - The Chromium Playwright smoke test passes (1 test).

## Fresh-Context Self-Review

Round 1 (single-model session; the fresh-context pass re-read the final diff against the behavioral notes without the implementer's working notes) found and fixed:

- A consistency defect: strict `importProject` with an expected revision used no-retry CAS and would report `core.storage-conflict` on a racing concurrent commit instead of a `conflict` result. Changed to retry-on-CAS so the rebuild detects the revision mismatch, and added two regression tests (racing strict import -> conflict with committed project; racing loose import -> retried success).
- Test-only findings: stale expected revisions in two save tests, an over-eager hostile-input expectation for proxies/inherited properties (the descriptor-based snapshot correctly ignores both), and a timing-fragile serialization assertion.

No actionable findings remain after the fixes; verification was rerun and passed.

## Documentation Updates

- `docs/architecture.md`: F4 status line and the full F4 browser-core architecture section.
- `README.md`: released-status paragraph, browser-core boundary section, build-script description, package-boundary summary, and project-document links.
- `docs/plans/f4-browser-core.md`: behavioral notes, acceptance checks, architecture note, and ordered tasks.
- `AGENTS.md`: no orientation change required; package boundaries and the feature sequence are unchanged.
- No raw brainstorm output was retained.

## Release Evidence

- Commit `a7a6caa` (`feat(f4): add browser-core platform layer`) was created and pushed on `feature/f4-browser-core`.
- PR #4 (`https://github.com/drmaas/rogatio/pull/4`) was opened against `main`.
- Merge and worktree cleanup remain pending explicit authorization.
