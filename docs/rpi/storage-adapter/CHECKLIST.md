# CHECKLIST — storage-adapter

Implementer ticks tasks as they complete. Each phase maps to `PLAN.md` Phases. Acceptance and proving tests are noted per phase.

**Strategy:** TDD (see `PLAN.md` → Implementation strategy). For Phases 1–3, write or adjust failing tests before production code.

## Phase 1 — Port + core JSON ops (get / create / update)

**Acceptance:** `ProjectStorage` (get/create/update) + `ProjectStorageError` + `createJsonFileProjectStorage` with path-as-id JSON semantics; compat wrappers parity; store does not validate/compile. Interface not yet required to include import/list/delete (Phase 2 extends it).

**Proves:** `packages/cli/test/file.test.ts` and/or `packages/cli/test/project-storage.test.ts`.

- [x] 1.1 **(TDD red)** Add contract tests for `get` / `create` / `update`: round-trip, atomic write (no leftover temps), default empty create, `already-exists` on create, `not-found` on update/get, `invalid-id` when JSON create omits id, prior read/write error codes, wrapper↔storage parity.
- [x] 1.2 Add `ProjectRef`, `ProjectStorage` with **get/create/update only**, `ProjectStorageError` (codes needed for these ops), and `ProjectFileError` compat (subclass/alias with `path` ≡ `id`) in `packages/cli` (`src/utils/file.ts` or one adjacent module re-exported from it).
- [x] 1.3 Implement `createJsonFileProjectStorage()` with `get` / `create` / `update` (pretty JSON, mkdir, temp+rename, path-as-id).
- [x] 1.4 Keep compat wrappers `readProject` / `writeProject` delegating to the JSON-file storage (get / upsert-compatible write).
- [x] 1.5 Export port, error types, and factory from the internal module; do **not** add a `package.json` `exports` entry.
- [x] 1.6 Confirm store does not validate or compile; `get` returns unvalidated `unknown`.
- [x] 1.7 **(TDD green)** Phase 1 tests pass.

## Phase 2 — Extend port: import / list / delete

**Acceptance:** `ProjectStorage` widened to full lifecycle; JSON-file adapter implements import/list/delete; no new CLI commands.

**Proves:** same storage unit test module as Phase 1.

- [x] 2.1 **(TDD red)** Tests for `import` (create + replace), `list` (no scope → `[]`; scope with/without `.rogatio.json` / `*.rogatio.json`, non-recursive), `delete` (success + `not-found`).
- [x] 2.2 Widen `ProjectStorage` with `import` / `list` / `delete` and implement them on `createJsonFileProjectStorage()` per PLAN semantics (add error codes `delete-failed` as needed).
- [x] 2.3 Confirm import does not perform network I/O; it only persists provided `data`.
- [x] 2.4 **(TDD green)** Phase 2 tests pass; TypeScript shows the full port on the factory return type.

## Phase 3 — Inject storage at CLI call sites

**Acceptance:** File-backed `edit` / `verify` / `test` / `runtime` / save use `ProjectStorage` (get/create/update), not compat wrappers; validate→compile→update on save; stdin and directory-stat UX unchanged.

**Proves:** `packages/cli/test/routes.test.ts`, `edit.test.ts`, `verify.test.ts`, runtime command tests; grep that production commands/routes do not call `readProject`/`writeProject`. No new `test` command unit suite.

- [x] 3.1 **(TDD red)** Update mocks/tests so injected write satisfies `ProjectStorage["update"]` (or store injection).
- [x] 3.2 Type `RouteContext` for storage update (or `ProjectStorage`); save still validates/compiles then updates.
- [x] 3.3 Wire `edit.ts`: `get` → on `not-found` `create` → inject update for save; preserve directory `stat` check.
- [x] 3.4 Wire `verify.ts`, `test.ts`, `runtime.ts` file-backed loads via `get`; leave stdin (`-`) unchanged.
- [x] 3.5 Grep/confirm: production command/route modules do not call compat wrappers and have no leftover project `fs` I/O outside the adapter module (tests may use wrappers as fixtures).
- [x] 3.6 **(TDD green)** Listed command/route tests pass; no command-structure refactors beyond the storage seam; no new list/import/delete CLI commands.

## Phase 4 — Docs sync + validation

**Acceptance:** Live docs describe `ProjectStorage` lifecycle port + JSON-file adapter; local-first stance unchanged; `pnpm validate` green.

**Proves:** `pnpm validate` in the worktree.

- [ ] 4.1 Update `docs/architecture.md` CLI/`file.ts` notes for `ProjectStorage` (list/get/create/import/update/delete), JSON-file adapter, and that browser-core `ProjectRepository` remains a separate surface.
- [ ] 4.2 Update `packages/cli/README.md` only if it documents storage helpers; otherwise record no README change needed.
- [ ] 4.3 Do **not** amend local-first / no-hosted-endpoints product rules for hypothetical remote backends.
- [ ] 4.4 Run `pnpm validate`; fix any failures in-scope for this feature.
