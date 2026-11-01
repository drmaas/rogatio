# F4 - browser-core Implementation Plan

**Workflow:** doit (no formal specification gate; user requested implementation)
**Feature:** F4 - `@rogatio/browser-core` package
**Depends on:** F2 (`@rogatio/schema`), F3 (`@rogatio/compiler`)
**Scope guardrail:** Implement the browser-neutral core platform model and lifecycle only. No Chrome/WebExtensions/DNR APIs, no actions or rule kinds (F9+), no editor/CLI/extension UI, no persistence of runtime state, no telemetry, no network, no filesystem.

## Behavioral Notes

Borrowed from `rogatio-overview.md` and `sequence.md`, narrowed to what browser-core owns:

- Each browser profile retains up to 64 uniquely named projects, with exactly one active project whenever any exist. Merely choosing a project has no effect until **Switch**; switching restores the destination project's saved enablement without requesting permission or contacting a runtime.
- Creation, import/update, and browser save leave every group disabled; permission and group activation remain separate visible actions.
- Conflicts preserve committed state and provide an explicit refresh path. Removal is an explicit action with a named, cancelable confirmation (confirmation is UI; core performs the removal).
- Rules report `active` / `disabled` / `needs permission` / `needs proxy` / `unsupported` / `error`; the toolbar badge reflects the successfully installed active rules. Runtime-dependent statuses (`needs proxy`, `unsupported`) populate only in later rule slices; browser-core defines the model.
- Grant only declared site access: an origin may be granted only when it is a declared (effective) origin of the project.
- Mocks use a single user-clicked Check-and-connect whose status represents the last check, not continuous monitoring; response/request-body rules use explicit Start/Stop. Runtime state is in-memory in F4; persistence arrives with the runtime slices.

## Deterministic Defaults (documented decisions)

- Creating or importing the **first** project activates it (maintains "exactly one active whenever any exist"). Creating/importing additional projects never auto-activates.
- Removing the active project activates the remaining project with the highest `updatedAt` (tie-break: lexicographically smallest project id); removing the last project leaves `activeProjectId: null`.
- Project names are unique by exact match.
- Import/update and browser save reset enablement to all-disabled and prune granted origins to those still declared by the new data.
- Grants are per project and stored normalized; revoking a non-granted origin is an idempotent success.

## Acceptance Checks

- **AC-001:** `@rogatio/browser-core` is a private ESM workspace package whose only product dependencies are `@rogatio/schema` and `@rogatio/compiler`, built as a Node ESM artifact like F2/F3.
- **AC-002:** The storage envelope is versioned; `migrateEnvelope` turns `undefined` into a fresh empty envelope, validates structure defensively (own data only, no cycles/symbols/getters/proxies/sparse arrays), fails with `core.storage-corrupt` on unknown versions or structural violations, and never throws.
- **AC-003:** Repository reads/writes go through an injected `StorageAdapter` (`read` + atomic `compareAndSwap`); committed state is preserved on conflict; corruption fails closed with no writes.
- **AC-004:** `createProject` validates the data through the complete F2/F3 boundary (no partial or invalid project is stored), enforces the 64-project cap and unique names, never auto-activates except for the first project, and returns detached stored data.
- **AC-005:** `importProject` creates when absent and updates when present (by id, else by name); `saveProject` requires an exact `expectedRevision` and returns a `conflict` result carrying the committed project when the revision is stale; both reset enablement and prune grants.
- **AC-006:** `switchProject` only changes the active id; `removeProject` removes and re-establishes the single-active invariant deterministically; `setGroupEnabled` toggles per-project saved enablement; `grantOrigin` accepts only declared origins (normalized), `revokeOrigin` is idempotent.
- **AC-007:** `computeDesiredRules` returns exactly the operations of enabled groups whose origins are fully granted, in source order; `computeRuleStatuses` maps every operation to one stable status (`disabled`, `needs permission`, `active`, `error` with a diagnostic); `needs proxy` and `unsupported` exist in the model and are not produced by F4.
- **AC-008:** `computeBadge` renders the count of active rules with an attention flag when any enabled rule is not active; output is deterministic.
- **AC-009:** `InstallService` atomically replaces the installed set through the injected `RuleInstallerAdapter`, treats an identical set as a no-op, rolls back to the previous set on install failure, reports recovery success/failure with stable diagnostics, and serializes concurrent `apply` calls.
- **AC-010:** The runtime state model defines mock (`disconnected/checking/connected/failed` with last-check) and native (`stopped/starting/started/failed`) phases; the controller enforces the transition table, records the last check, and returns stable `core.runtime-transition` diagnostics on invalid transitions; snapshots are detached.
- **AC-011:** Diagnostics use stable codes, `error` severity, JSON-pointer paths where applicable, safe structured params (never echoing input values), and deterministic ordering.
- **AC-012:** Root build emits the browser-core artifact; `pnpm validate` executes the emitted module, enforces the `schema -> compiler -> browser-core` direction (compiler/schema must not depend on browser-core), and the negative fixture targets the still-absent `@rogatio/extension` package.
- **AC-013:** No F5+ behavior is introduced: no actions, no browser APIs, no DNR translation, no editor/CLI/extension UI, no runtime persistence, no network, no telemetry, no filesystem access.

## Architecture Note

- **Package boundary.** `@rogatio/browser-core` sits between `compiler` and the extension/CLI layers. It is browser-neutral: every platform-specific capability (storage, rule installation) enters through a narrow injected adapter interface, so the same logic runs under Vitest and inside the future Chrome MV3 service worker. The verified distribution target remains Node ESM; MV3 packaging stays a later extension-boundary decision.
- **Storage.** A single versioned envelope (`version`, `projects` record keyed by project id, `activeProjectId`) is persisted through `StorageAdapter.read` / `compareAndSwap(previous, next)`. `compareAndSwap` is the atomicity authority; the repository uses a bounded read-modify-CAS retry for non-explicit operations and a strict, no-retry CAS (conflict result with committed state) for editor-style saves carrying an expected revision. Reads defensively snapshot the raw value and validate envelope structure; project data is fully F2/F3-validated at write time.
- **Status model.** Statuses derive from four inputs: compiled operations (source order), per-project saved enablement, per-project granted origins (subset of declared effective origins), and the currently installed rule ids reported by the installer adapter. Rules of disabled groups are `disabled`; enabled rules with un-granted origins are `needs permission`; enabled+granted rules absent from the installed set are `error`; the rest are `active`. The badge is a pure function of statuses.
- **Install lifecycle.** The active project's desired set is computed from enablement + grants; `InstallService.apply` compares with the adapter's current set (no-op when equal), installs, and on failure rolls back to the previous set, reporting `core.install-failed` / `core.recovery-failed`. Only the active project's rules are ever installed; switching replaces the set wholesale.
- **Runtime state.** Mock and native runtime phases are modeled with a guarded transition table in memory; the last mock check result is recorded but never persisted in F4.
- **Alternatives rejected.** A persistent compiled-operation cache (staleness risk, no benefit at this scale); storing declared origins (derivable from data); browser/extension-specific storage APIs in core (breaks neutrality and testability); persisting runtime state now (runtime slices will specify the semantics).

## Ordered Tasks

### T1 - Package boundary and plan artifact
- **Files:** `docs/plans/f4-browser-core.md`, `packages/browser-core/package.json`, `packages/browser-core/tsconfig.json`, `packages/browser-core/vitest.config.ts`, root `pnpm-lock.yaml` (via `pnpm install`).
- **Behavior:** Private ESM `@rogatio/browser-core` package; exports map to `src/index.ts` types and `dist/node/index.js`; dependencies exactly `@rogatio/schema` and `@rogatio/compiler` (`workspace:*`).
- **Acceptance:** AC-001. **Verification:** `pnpm install --frozen-lockfile`, package metadata inspection.

### T2 - Tests first
- **Files:** `packages/browser-core/test/migrate.test.ts`, `repository.test.ts`, `status.test.ts`, `install.test.ts`, `runtime.test.ts`, `test/fixtures/forbidden-direction.ts`.
- **Behavior:** Contracts for envelope migration and corruption, repository lifecycle (create/import/save/switch/remove/enable/grant/export, CAS conflict, caps, auto-activation, fail-closed storage), status/badge computation, install orchestration with recovery and serialization, and runtime transitions — all before production source. Update the negative fixture to the still-absent `@rogatio/extension`.
- **Acceptance:** AC-002 through AC-011. **Verification:** focused Vitest run records the expected missing-module red result.

### T3 - Diagnostics and shared types
- **Files:** `packages/browser-core/src/diagnostics.ts`, `packages/browser-core/src/types.ts`.
- **Behavior:** Stable `core.*` diagnostic codes (extending the compiler code union), safe-param copying, deterministic ordering; envelope/stored-project/status/badge/runtime/result types.
- **Acceptance:** AC-002, AC-007 through AC-011. **Verification:** strict typecheck and contract tests.

### T4 - Envelope migration
- **Files:** `packages/browser-core/src/migrate.ts`.
- **Behavior:** `ENVELOPE_VERSION = 1`; `migrateEnvelope(value)` returns a fresh empty envelope for `undefined`, defensively snapshots own data (no cycles/symbols/getters/proxies/sparse arrays), validates version and structure (ids match keys, name/revision/timestamps, unique group ids and origins, active id exists), fails with `core.storage-corrupt` otherwise, never throws.
- **Acceptance:** AC-002. **Verification:** migrate tests.

### T5 - Project repository
- **Files:** `packages/browser-core/src/repository.ts`.
- **Behavior:** `ProjectRepository` over `StorageAdapter` with injected id/time sources; all mutation ops validated, CAS-committed with bounded retry (strict conflict for explicit revisions), fail-closed on corrupt storage; data validated via `validateProjectDetailed` + `compileProject`; enablement reset and grant pruning on data commits; deterministic single-active invariant.
- **Acceptance:** AC-003 through AC-006. **Verification:** repository tests.

### T6 - Desired rules, statuses, and badge
- **Files:** `packages/browser-core/src/status.ts`.
- **Behavior:** `computeDesiredRules`, `computeRuleStatuses` (stable per-rule statuses in source order, `core.rule-not-installed` diagnostics on error), `computeBadge` (active count + attention flag), `computeDeclaredOrigins` (union of normalized effective origins from compiled operations).
- **Acceptance:** AC-007, AC-008. **Verification:** status tests.

### T7 - Install orchestration
- **Files:** `packages/browser-core/src/install.ts`.
- **Behavior:** `RuleInstallerAdapter` contract (`current`, `install`); `InstallService.apply` with no-op detection, atomic replace, rollback on failure, recovery diagnostics, and serialized concurrent calls.
- **Acceptance:** AC-009. **Verification:** install tests.

### T8 - Runtime state model
- **Files:** `packages/browser-core/src/runtime.ts`.
- **Behavior:** Mock/native phase types, last-check record, guarded transition controller returning `core.runtime-transition` diagnostics, detached snapshots.
- **Acceptance:** AC-010. **Verification:** runtime tests.

### T9 - Root build and validation integration
- **Files:** `packages/browser-core/src/index.ts`, `scripts/build.ts`, `scripts/validate.ts`, `test/fixtures/forbidden-direction.ts`.
- **Behavior:** Public exports; browser-core Node ESM artifact with schema/compiler externalized; emitted-module execution check; boundary checks (browser-core depends only on schema+compiler; schema/compiler must not depend on browser-core; negative fixture targets absent `@rogatio/extension`).
- **Acceptance:** AC-001, AC-012. **Verification:** `pnpm validate` full sequence.

### T10 - Documentation synchronization
- **Files:** `docs/architecture.md`, `README.md`, `docs/f4-workflow.md`.
- **Behavior:** Record F4 as released, package layer status, storage/status/install/runtime decisions, verification evidence, and absence of F5+ behavior; keep durable docs consistent.
- **Acceptance:** AC-013. **Verification:** documentation consistency review, `git diff --check`, generated-artifact/secret scan.

### T11 - Fresh-context review and release preparation
- **Files:** Final diff and `docs/f4-workflow.md`; code changes only for approved in-scope defects.
- **Behavior:** Self-review the final diff against the behavioral notes (fresh context, no implementer notes), rerun validation after any fix, then present summary and await explicit user authorization for commit/push/PR.
- **Acceptance:** Full plan. **Verification:** review record, final `pnpm validate`.

## Generated and Local-Only Files

Do not commit `node_modules/`, package `dist/`, build manifests, coverage, Playwright output, browser binaries, caches, environment files, or secrets. The lockfile and durable plan/architecture/workflow documentation are source-controlled.
