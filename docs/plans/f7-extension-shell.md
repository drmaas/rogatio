# F7 Chrome MV3 Extension Shell Implementation Plan

**Status:** Approved after DNR-scope revision
**Specification:** `docs/specs/f7-extension-shell.md`
**Base:** `25fb417`
**Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f7`

## Architecture

Add private package `@rogatio/extension` as the browser-specific downstream boundary. Keep F4 lifecycle, CAS, conflict, project-limit, enablement, status, badge, and install-recovery behavior in `@rogatio/browser-core`; inject Chrome adapters from the extension service worker. Keep F5 responsible for common project/rule editing and mount it from the extension page. Bundle the extension's approved browser-safe source graph into MV3 outputs without loading Node/Ajv runtime artifacts.

The first F7 operation kind is the existing F3 `matcher` operation. F7 projects it deterministically for inspection but does not install it because it has no action; action-specific operations remain deferred. DevTools console diagnostics are explicitly deferred and are not part of this plan.

## Ordered Tasks

### 1. Package and build boundary

**Files:** `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/vitest.config.ts`, `packages/extension/src/`, `packages/extension/public/`, `scripts/build.ts`, `scripts/validate.ts`, `pnpm-lock.yaml`.

Create the private browser package, explicit workspace dependencies, MV3 manifest, extension page, service-worker entry, and browser build targets. Add only local Chrome API declarations/adapters; do not add an ambient Chrome dependency without approval. Add artifact and dependency-direction checks for the new package.

**Covers:** REQ-026, AC-001, AC-017.

**Proof:** package format/lint/typecheck, browser bundle inspection, manifest validation, root build and boundary checks.

### 2. Deterministic matcher translation

**Files:** `packages/extension/src/dnr.ts`, `packages/extension/test/dnr.test.ts`.

Project F3 matcher operations into deterministic browser-neutral records for future DNR action translation. Preserve regex source, resource types, priority, optional method, and effective origins. Define stable numeric IDs and stable extension diagnostics for unsupported operation shapes. Keep source group/rule identity in an internal map or metadata helper. Do not send actionless records to DNR or invent an allow/no-op action.

**Covers:** REQ-014, REQ-015, REQ-016, AC-009, AC-011, AC-012.

**Proof:** repeated translation is byte-for-byte stable; malformed and unsupported operations fail without partial output.

### 3. Chrome adapters

**Files:** `packages/extension/src/chrome.ts`, `packages/extension/src/storage.ts`, `packages/extension/src/permissions.ts`, `packages/extension/src/diagnostics.ts`, tests for each adapter.

Implement narrow, promise-based adapters for `storage.local`, `permissions`, action badge, and runtime messaging. Keep a DNR installer seam for later action-bearing slices, but do not invoke it for F7 matcher projections. Normalize rejected/malformed Chrome results into stable diagnostics. Implement exact declared-origin projection and no broad permissions.

**Covers:** REQ-001, REQ-009 through REQ-013, REQ-018, REQ-024, REQ-025, AC-002, AC-016.

**Proof:** fake API contract tests, hostile values, exact permission request assertions, deterministic diagnostics.

### 4. Service-worker application boundary

**Files:** `packages/extension/src/service-worker.ts`, `packages/extension/src/protocol.ts`, `packages/extension/test/service-worker.test.ts`.

Create the service-worker application that owns a repository, DNR installer, project commands, permission flow, group enablement, refresh, state projection, and badge updates. Validate versioned messages before dispatch. Preserve conflicts and return explicit refresh-ready responses. Ensure switching is the only operation that changes active project selection.

**Covers:** REQ-002 through REQ-007, REQ-016 through REQ-019, REQ-023, AC-003 through AC-013, AC-016.

**Proof:** application tests with fake Chrome adapters, project cap/conflict/permission/install failure cases, status and badge snapshots.

### 5. Extension-page management shell

**Files:** `packages/extension/src/extension-page.ts`, `packages/extension/public/index.html`, `packages/extension/test/extension-page.test.ts`.

Mount F5's editor for the active project and add explicit project selector, Switch, import/export, project lifecycle controls, permission review/grant, group activation, status, conflict refresh, and cancelable removal controls. Keep pending selection local until Switch. Keep F7's rule-type extension registration empty.

**Covers:** REQ-008, REQ-020 through REQ-023, AC-004, AC-007, AC-014, AC-015, AC-017.

**Proof:** DOM/controller tests and browser smoke journey for selection without switching, explicit switch, cancelable removal, and editor mounting.

### 6. Documentation and validation integration

**Files:** `README.md`, `docs/architecture.md`, `docs/f7-workflow.md`, root validation/build scripts, browser fixtures as needed.

Document the released F7 boundary, supported Chrome environment, deferred DevTools behavior, package/build commands, and verification evidence. Keep sequence/spec/plan/workflow synchronized. Add the extension artifact to root validation and browser prerequisites without weakening existing checks.

**Covers:** AC-001, AC-017 and repository documentation requirements.

**Proof:** `pnpm validate`, documentation/diff audit, fresh-context review.

## Tests-First Order

1. Add package metadata and test configuration needed for test discovery.
2. Add tests for DNR translation, permission projection, hostile protocol values, service-worker lifecycle, and extension-page selection/removal/editor behavior.
3. Run focused F7 tests before production source; record the expected missing-module red state.
4. Implement production sources in the task order above.
5. Run focused tests, then the complete canonical validation sequence.

## Generated and Local-Only Files

Do not commit `dist`, `build-manifest.json`, coverage, Playwright reports, browser binaries, `node_modules`, environment files, or secrets. MV3 source manifest and static extension page are authored source, not generated output.

## Rollback

The package is private and has no prior extension consumers. Removing the package and its build/validation entries reverts F7 without changing F2-F6 runtime behavior. The DevTools record remains deferred and is not a compatibility obligation for this slice.
