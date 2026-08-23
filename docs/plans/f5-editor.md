# F5 - Editor Implementation Plan

**Plan model:** `opencode-go/glm-5.3`
**Approved specification:** `docs/specs/f5-editor.md`
**Architecture:** `docs/architecture.md`, F5 Editor Architecture section
**Scope guardrail:** Implement only the approved `@rogatio/editor` package. Do not add browser-core, extension, CLI, runtime, persistence, filesystem, network, permission, telemetry, or action-specific rule behavior.

## Ordered Tasks

### T1 - Add the package boundary and browser target

- **Files:** `packages/editor/package.json`, `packages/editor/tsconfig.json`, `packages/editor/vitest.config.ts`, `pnpm-lock.yaml`, `scripts/build.ts`.
- **Behavior and invariants:** Add a private ESM `@rogatio/editor` package with explicit source/type and browser import exports. Keep F2/F3 references type-only in the browser entry; declare only the approved workspace contracts as product dependencies. Add one browser ESM target for the editor to the existing Node-based build without changing F1-F3 targets. Do not add a framework or DOM emulation dependency.
- **Acceptance mapping:** F5-REQ-001, F5-REQ-002, F5-REQ-022, F5-REQ-024; F5-AC-026, F5-AC-027.
- **Verification:** Frozen install after lockfile update, package metadata inspection, strict typecheck, emitted browser artifact inspection, and dependency-direction checks.

### T2 - Establish pure contracts and conversion tests first

- **Files:** `packages/editor/test/editor.test.ts`.
- **Behavior and invariants:** Write tests before editor production source exists for exact URL conversion, URL rejection, F2 regex-length bounds, deterministic output, no flags/captures/wildcards, and public type/export presence where executable. Use Node Vitest only for pure behavior; compare the fixed browser-safe conversion bound with the F2 documented bound without importing Node-only F2 runtime code into the browser entry.
- **Acceptance mapping:** F5-REQ-008, F5-REQ-021; F5-AC-010, F5-AC-011, F5-AC-026.
- **Verification:** Run `pnpm exec vitest run packages/editor/test/editor.test.ts` before production source exists and record the expected missing-module red result. Do not weaken assertions to make the pre-source run green.

### T3 - Establish browser interaction tests before production source

- **Files:** `test/fixtures/editor-fixture.html`, `test/browser/editor.spec.ts`, `scripts/serve-smoke.ts` only for fixture routing.
- **Behavior and invariants:** Add a dependency-free browser fixture that imports the eventual shipped `/editor/index.js` artifact and supplies a deterministic F2/F3-compatible validation adapter plus a controllable save host. Add Playwright journeys for mount, metadata, CRUD, source-order reorder, remove confirmation, search, routes, command context, validation errors, save/cancel, keyboard interaction, focus, extension safety, narrow layout, forced colors, and 200% zoom. The fixture must not replace the production editor with a test implementation.
- **Acceptance mapping:** F5-REQ-003 through F5-REQ-020, F5-REQ-023, F5-REQ-024; F5-AC-001 through F5-AC-025.
- **Verification:** Run the focused Playwright file before production source exists and record the expected missing browser-artifact or module failure. Preserve the existing F1 smoke journey.

### T4 - Implement defensive snapshots, draft state, and identity-safe mutations

- **Files:** `packages/editor/src/types.ts`, `packages/editor/src/editor.ts`, `packages/editor/src/index.ts`.
- **Behavior and invariants:** Implement an own-data, descriptor-based JSON snapshot guard that rejects symbols, accessors, cycles, sparse/inherited entries, unsupported values, and oversized arrays without invoking getters. Validate the snapshot before mounting; throw `EditorInitializationError` with safe diagnostics for invalid initial data. Keep detached committed/draft snapshots, a monotonic revision, stable route and focus identities, deterministic collision-free IDs, structural dirty comparison, and source-order group/rule mutation helpers. Never mutate caller input or expose live state.
- **Acceptance mapping:** F5-REQ-003, F5-REQ-004, F5-REQ-005, F5-REQ-006, F5-REQ-007, F5-REQ-012, F5-REQ-023, F5-REQ-024; F5-AC-001 through F5-AC-009, F5-AC-015, F5-AC-016, F5-AC-023.
- **Verification:** Focused Vitest/browser tests for hostile values, detached snapshots, stable IDs, dirty transitions, CRUD, source-position reorder, cancellation, and multiple instances.

### T5 - Implement deterministic URL conversion and common field editing

- **Files:** `packages/editor/src/url.ts`, `packages/editor/src/editor.ts`.
- **Behavior and invariants:** Use native WHATWG `URL` parsing with explicit HTTP(S), whitespace/control, credential, and fragment checks. Preserve URL serialization query order and duplicates, escape regex metacharacters, add only `^`/`$`, reject generated sources over the F2 bound, and mutate a rule only after explicit conversion. Render and edit project metadata, group IDs/names/origins, rule IDs/names/URL regex/origins/resource types/priority/optional method, with empty optional method omitted and no automatic source normalization.
- **Acceptance mapping:** F5-REQ-004, F5-REQ-006, F5-REQ-008; F5-AC-004, F5-AC-006, F5-AC-007, F5-AC-010, F5-AC-011.
- **Verification:** URL golden vectors plus browser field-edit and conversion journeys; assert source spelling, array order, priority, method omission, and no mutation on conversion failure.

### T6 - Implement validation, diagnostics, save, cancel, and revision guards

- **Files:** `packages/editor/src/editor.ts`, `packages/editor/src/types.ts`.
- **Behavior and invariants:** Invoke the synchronous host validator on fresh snapshots, merge controlled extension diagnostics, sort by path/code/message, map JSON-pointer paths to stable controls and summary links, and never expose Ajv or exception wording. Save validates again, captures revision/snapshot, disables conflicting mutation and Cancel, commits only a current successful result, preserves exact draft on failure, and ignores late results after destroy. Dirty Cancel uses a named keyboard-cancellable confirmation; clean Cancel calls the optional host callback.
- **Acceptance mapping:** F5-REQ-009, F5-REQ-010, F5-REQ-011, F5-REQ-012, F5-REQ-015, F5-REQ-016; F5-AC-012 through F5-AC-016, F5-AC-019.
- **Verification:** Browser tests for invalid fields, root/record/array paths, no-save-on-error, successful and failed save, retry, delayed/stale completion, destroy, cancel confirmation, and focus restoration.

### T7 - Implement navigation, search, command bar, and accessible DOM view

- **Files:** `packages/editor/src/editor.ts`.
- **Behavior and invariants:** Render safe DOM nodes and scoped CSS through a persistent editor shell. Provide semantic `main`/`nav`/`form`/headings/fieldsets, Project plus one stable group route, synchronized desktop rail and native mobile select, literal project-wide common-field search, contextual commands, explicit reorder/remove controls, live status, error summary, labels, descriptions, stable `aria-invalid`/`aria-describedby`, and keyed focus/caret/composition restoration. No user data is interpolated into HTML and no drag-and-drop or shortcut-only control is used.
- **Acceptance mapping:** F5-REQ-013, F5-REQ-014, F5-REQ-015, F5-REQ-016, F5-REQ-019, F5-REQ-020, F5-REQ-023; F5-AC-008, F5-AC-009, F5-AC-017 through F5-AC-022.
- **Verification:** Playwright keyboard-only, screen-reader-oriented DOM, focus/caret, IME, responsive, forced-colors, zoom, reduced-motion, and search/reorder journeys.

### T8 - Implement the controlled rule-type extension point

- **Files:** `packages/editor/src/types.ts`, `packages/editor/src/editor.ts`, `packages/editor/test/editor.test.ts`, `test/browser/editor.spec.ts`.
- **Behavior and invariants:** Snapshot the registry at construction; reject duplicate IDs and ambiguous matches. Give extensions only defensive rule snapshots and a controlled field store that rejects common-field writes, validates JSON-like values, registers controls for diagnostics, and supports synchronous cleanup. Catch callback failures into stable diagnostics. Do not define an action discriminant, pass through unowned unknown data, or add any action implementation.
- **Acceptance mapping:** F5-REQ-017, F5-REQ-018; F5-AC-024, plus F5-AC-001, F5-AC-012, F5-AC-023.
- **Verification:** Browser and unit journeys for controlled writes, defensive reads, duplicate/ambiguous registration, malformed/cyclic extension values, thrown callbacks, cleanup, error association, and multiple instances.

### T9 - Integrate browser serving, build validation, and package boundaries

- **Files:** `scripts/build.ts`, `scripts/validate.ts`, `scripts/serve-smoke.ts`, `test/fixtures/editor-fixture.html`, `test/browser/editor.spec.ts`, `test/fixtures/forbidden-direction.ts` only if the existing boundary assertion needs an editor-specific check.
- **Behavior and invariants:** Build a non-empty browser editor artifact with no Node built-ins/globals and no runtime F2/F3 import. Serve only the editor fixture/artifact through the existing loopback static test server. Extend artifact and emitted-module checks, dependency-direction checks, and browser validation without weakening F1-F3 checks or changing the forbidden downstream fixture's purpose.
- **Acceptance mapping:** F5-REQ-001, F5-REQ-021, F5-REQ-022, F5-REQ-024; F5-AC-023, F5-AC-026, F5-AC-027.
- **Verification:** `pnpm build`, emitted browser import in Playwright, source/bundle scan for `node:`, `process`, `Buffer`, filesystem imports, and forbidden downstream packages, plus the existing negative fixtures.

### T10 - Final focused verification and documentation synchronization

- **Files:** `README.md`, `docs/architecture.md`, `AGENTS.md`, `docs/specs/f5-editor.md`, `docs/plans/f5-editor.md`, `docs/f5-workflow.md`.
- **Behavior and invariants:** Keep the approved specification and plan aligned with implemented behavior. Record exact commands and results against every acceptance criterion, update the status from proposed to implemented only after verification/review, retain no brainstorm output, and document browser-safe adapter limitations, supported environments, accessibility behavior, and known residual risks. Do not perform release actions.
- **Acceptance mapping:** All F5 requirements and acceptance criteria, especially F5-REQ-021 through F5-REQ-024 and F5-AC-025 through F5-AC-027.
- **Verification:** Run focused Vitest and Playwright tests, then the canonical `pnpm validate`; run `git diff --check`, generated-file/secret/scope audits, and review the final documentation set.

## Acceptance-Criterion Coverage Matrix

- **F5-AC-001 through F5-AC-003:** T4, T6, T7, T8.
- **F5-AC-004 through F5-AC-009:** T4, T5, T7.
- **F5-AC-010 through F5-AC-011:** T2, T5.
- **F5-AC-012 through F5-AC-016:** T6, T7, T8.
- **F5-AC-017 through F5-AC-019:** T7.
- **F5-AC-020 through F5-AC-023:** T7, T9.
- **F5-AC-024:** T8.
- **F5-AC-025 through F5-AC-027:** T9, T10.

## Generated and Local-Only Files

Do not commit `node_modules/`, `packages/*/dist/`, `build-manifest.json`, coverage, Playwright reports/results, browser binaries, caches, environment files, or secrets. Keep the lockfile and source-controlled tests/configuration/docs only. Negative fixtures remain outside normal typecheck and Biome inputs.

## Rollback

F5 introduces no file-format, storage, or data migration. Before release, rollback is a revert of the package, build/validation wiring, fixture/test files, and documentation changes in this feature worktree. The host owns atomic persistence; F5 does not attempt to undo a host write that already succeeded. Worktree and branch cleanup require separate user authorization and a prompt immediately before deletion.
