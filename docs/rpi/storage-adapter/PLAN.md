# PLAN — storage-adapter

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/storage-adapter`
**Branch:** `feature/storage-adapter`
**Source of truth:** `docs/rpi/storage-adapter/RESEARCH.md`

---

## Implementation strategy

TDD

---

## Goal

Introduce an injectable **project-lifecycle storage port** so the application depends on project-level operations—**list, get, create, import, update, delete**—rather than concrete filesystem helpers or backend APIs. The first and only production adapter in this feature is the existing JSON-file persistence (canonical `.rogatio.json` semantics: pretty-print, atomic temp+rename, unvalidated `unknown` reads). Later database or remote-API adapters plug into the **same port** without reshaping application architecture, schema, editor hosts, or the browser-core envelope/`StorageAdapter` surface.

Groups and rules remain **nested arrays inside each `RogatioProject` document**. RESEARCH shows no separate group/rule stores; this port does not add entity-level group/rule CRUD.

---

## Non-goals

- No database, remote API, cloud sync, hosted persistence, or second production adapter.
- No change to `.rogatio.json` / schema v1 wire format, JSON Schema, or nested `groups[].rules[]` shape.
- No entity-level group or rule repository APIs.
- No migration of browser-core `ProjectRepository` / `StorageAdapter` / envelope onto this port in this slice (see Risks—two lifecycle surfaces remain until an explicit unification).
- No new CLI subcommands for list/import/delete (port methods exist and are tested; product commands stay as today).
- No editor boundary changes; `createEditor` still receives host `validate` / `save` only.
- No moving validation or compilation into the store; callers keep `validateProjectDetailed` / `compileProject` at write boundaries.
- No file watcher, multi-process CAS, revision/conflict protocol, or edit-session reload semantics.
- No new npm dependencies, no new workspace package, no CLI flags or config to select backends.
- No architecture amendment that enables hosted/cloud backends as product behavior (deferred; see Risks).
- No DI container, backend registry, or factory options bag beyond a single optional root/scope string where the JSON adapter needs it for `list`.
- No change to `verify` / `test` stdin (`-`) paths: those keep parsing stdin JSON outside the store.

---

## Today’s operations map (RESEARCH)

| Lifecycle op | CLI today | Browser-core / extension today |
| --- | --- | --- |
| **get** (read document) | `readProject(path)` → `unknown` | `getProject` / `exportProject` (envelope-wrapped `RogatioProject`) |
| **create** (empty / new) | `edit` bootstrap: missing file → `{ version: 1, name: "", groups: [] }` + write | `ProjectRepository.createProject` |
| **update** (save document) | `writeProject` / `POST /api/save` | `ProjectRepository.saveProject` (revision + enablement reset) |
| **import** | No CLI import command; stdin `-` is parse-only, not store import | `ProjectRepository.importProject` (file picker → message) |
| **list** | None (single path per invocation) | `state()` → `envelope.projects` keys |
| **delete** | None | `ProjectRepository.removeProject` |

This feature defines one application-facing port covering the left-hand ops. CLI wires **get / create / update** to existing commands. **import / list / delete** are implemented and unit-tested on the JSON-file adapter so future DB/API backends (and later CLI/extension consumers) share the contract—without adding new CLI product commands or touching browser-core in this slice.

---

## Architecture

### Plan decisions (resolves RESEARCH open questions + revision)

| # | Question | Decision |
| --- | --- | --- |
| 1 | First-cut surface | **CLI-owned port + JSON-file adapter**, shaped as full project lifecycle. Browser-core envelope/`StorageAdapter` / `ProjectRepository` stay untouched this slice. |
| 2 | What “json file” means | Canonical VCS `.rogatio.json` (`RogatioProject`). Not Chrome `storage.local` JSON. |
| 3 | Entity vs document API | **Whole-project document** ops only. Nested groups/rules unchanged. |
| 4 | Future DB / remote vs local-first | **Not implemented.** Port is the plug-in seam; product/architecture docs stay local-first until an explicit amendment. |
| 5 | Package home | **`packages/cli`** for interface + JSON adapter (Node `fs`). No new package. Do not put the Node adapter in browser-core. If a second in-tree host must share the interface later, relocate the **interface only** then—do not invent that package now. |
| 6 | Atomicity | **Per-backend.** JSON-file keeps temp+rename. Do not invent shared CAS. Browser CAS remains separate. |
| 7 | File-backed envelope store | **No.** |
| 8 | Validation ownership | **Callers.** Store get/import/create accept or return unvalidated `unknown` / default empty document; schema/compile stay at save/verify/test/runtime boundaries. |
| 9 | Error vocabulary | Introduce backend-neutral **`ProjectStorageError`** with `code` + `id` (opaque project key). JSON-file sets `id` to the filesystem path. Keep **`ProjectFileError` as a thin subclass or alias** so existing `instanceof` / HTTP mapping can migrate with minimal churn (prefer subclass with `path` getter ≡ `id`). Codes: `not-found`, `already-exists`, `invalid-id`, `invalid-json`, `invalid-format`, `read-failed`, `write-failed`, `delete-failed`, `is-directory`. |
| 10 | Identity model | Opaque string **`id`**. JSON-file adapter: **path-as-id** (absolute or resolved filesystem path to the project file). Future DB/API: uuid/URI. |
| 11 | Port breadth | **Full lifecycle** on the interface even where CLI has no command yet. |

### Port shape (locked — final after Phase 2)

Phase 1 ships `get` / `create` / `update` only; Phase 2 widens the same interface to the full shape below (no throwaway stubs).

```ts
export interface ProjectRef {
  readonly id: string;
  readonly name: string; // from document `name` when a string; otherwise ""
}

/**
 * Application-facing project lifecycle persistence.
 * Groups/rules are nested inside each project document — not separate resources.
 * `id` is backend-defined (filesystem path for JSON-file; uuid/URI for future backends).
 */
export interface ProjectStorage {
  list(scope?: string): Promise<readonly ProjectRef[]>;
  get(id: string): Promise<unknown>;
  create(options?: { id?: string; data?: unknown }): Promise<ProjectRef>;
  import(data: unknown, options?: { id?: string }): Promise<ProjectRef>;
  update(id: string, data: unknown): Promise<void>;
  delete(id: string): Promise<void>;
}
```

**Semantics (contract):**

| Method | Behavior |
| --- | --- |
| `get` | Return unvalidated document; `not-found` / parse errors as today. |
| `create` | Persist a new project; default data `{ version: 1, name: "", groups: [] }` when `data` omitted. Fail `already-exists` if id already present. JSON-file **requires** `id` (path); omit → `invalid-id`. Future DB may mint ids when omitted. |
| `import` | Persist caller-supplied document at `id` (create or replace at that id). JSON-file **requires** `id`. Does not fetch remote URLs—callers supply `data` (future API adapter may load remotely inside `import`). |
| `update` | Replace document for existing id; `not-found` if missing. |
| `delete` | Remove project; `not-found` if missing. JSON-file: unlink file (`delete-failed` on I/O). |
| `list` | Return refs. JSON-file: `scope` = directory to scan **non-recursively** for `.rogatio.json` and `*.rogatio.json`; omit `scope` → empty list. Future DB may ignore `scope`. |

Factory: `createJsonFileProjectStorage(): ProjectStorage` — **stateless, optionless**. Path/root concerns pass via `id` / `list(scope)`.

### JSON-file adapter

- Move current read/write bodies behind `get` / `update` (+ `create`/`import`/`delete`/`list` as above). Preserve pretty-print, recursive mkdir on write, sibling temp+rename, prior read error mapping.
- **Compat wrappers** `readProject` / `writeProject`: thin delegates (`get` / upsert-via-update-or-create) for existing **tests** and importers. Production commands must use `ProjectStorage`, not wrappers.
- `ProjectFileError` remains available for compat; new code prefers `ProjectStorageError`.

### Call-site injection (CLI)

| Site | Change |
| --- | --- |
| `edit.ts` | `get(id)`; on `not-found` → `create({ id, data: empty })`; inject `storage.update` (or store) into route context for save. Keep directory `stat` UX outside the store. |
| `RouteContext` | Injected write typed as `ProjectStorage["update"]` (or hold `ProjectStorage`). Save still validates/compiles then `update`. |
| `verify.ts`, `test.ts`, `runtime.ts` | File-backed load via `get(id)`. Stdin (`-`) unchanged. |
| Editor | Unchanged. |

Do **not** add CLI commands that only exercise list/import/delete; adapter unit tests own that coverage.

### What stays unchanged

- Schema types and sample `.rogatio.json`.
- Browser-core / extension storage and `ProjectRepository` lifecycle.
- Edit session in-memory snapshot after load/save.
- Dependency direction: still no `cli` → forced browser-core coupling for this slice.
- `verify` / `test` stdin (`-`).

### Public API note

- **No wire-format / `.rogatio.json` change.**
- Port + factory remain **internal CLI modules** (same layer as `utils/file.ts`). Do **not** add a `package.json` `exports` path for the store.

---

## Phases

### Phase 1 — Port + core JSON ops (`CHECKLIST.md` Phase 1)

**TDD:** failing contract tests first, then interface + adapter.

Define `ProjectRef`, `ProjectStorageError` (+ `ProjectFileError` compat), and `ProjectStorage` **initially with `get` / `create` / `update` only**, plus `createJsonFileProjectStorage` implementing those methods. Keep `readProject` / `writeProject` as compat wrappers. (Phase 2 extends the same interface—avoid stub methods that throw.)

**Acceptance:** get/create/update match agreed semantics and preserve prior read/write behavior for the path-as-id mapping; wrappers parity; no validate/compile inside store.

**Tests:** `packages/cli/test/file.test.ts` and/or `project-storage.test.ts` — round-trip, atomic write, create empty, create `already-exists`, update `not-found`, read error codes, wrapper parity.

### Phase 2 — Extend port: import / list / delete (`CHECKLIST.md` Phase 2)

**TDD:** tests for **`import` / `list` / `delete`** first, then widen `ProjectStorage` and implement on the JSON-file adapter.

**Acceptance:** Interface includes the full lifecycle; import create-or-replace; list(scope) non-recursive `.rogatio.json` / `*.rogatio.json`; delete unlink + `not-found`; no CLI product commands added.

**Tests:** same storage test module — import overwrite, list empty/with files, delete success/missing, `delete-failed` only if cheap to assert.

### Phase 3 — Inject storage at CLI call sites (`CHECKLIST.md` Phase 3)

**TDD:** adjust route/command mocks/tests first where practical, then wire.

Wire `edit` / save / `verify` / `test` / `runtime` to `ProjectStorage` (**get / create / update** only). Grep: production modules do not call compat wrappers or raw project `fs` outside the adapter module.

**Acceptance:** existing CLI UX preserved (bootstrap, directory rejection, stdin); save still validate→compile→update.

**Tests:** `routes.test.ts`, `edit.test.ts`, `verify.test.ts`, runtime command tests; no new `test` command suite.

### Phase 4 — Docs sync + validation (`CHECKLIST.md` Phase 4)

Update `docs/architecture.md` CLI notes for `ProjectStorage` + JSON-file adapter and lifecycle ops. README only if it documents helpers (today it does not). Do not amend local-first product rules. Run `pnpm validate`.

---

## Risks

1. **Two lifecycle surfaces.** CLI `ProjectStorage` vs browser-core `ProjectRepository` both express create/import/update/list/delete-like ops. Unifying them is explicitly deferred. Callers must not assume one port covers the extension profile store.
2. **Remote/DB vs local-first docs.** A future API/DB adapter that hosts or syncs user projects conflicts with `rogatio-overview.md` / `docs/architecture.md` (no accounts, no hosted endpoints, persistent data = VCS `.rogatio.json`) until those docs are deliberately amended. This plan defines the **plug-in seam only**—it does not invent a sync product or amend those rules.
3. **Path-as-id coupling.** JSON-file ids are filesystem paths; DB/API ids will differ. Acceptable; avoid opaque handle objects now.
4. **`list(scope)` is slightly file-shaped.** DB backends may ignore `scope`. Prefer that over a heavier query API.
5. **No multi-writer safety.** Unchanged edit-session vs disk divergence.
6. **Compat wrappers vs real injection.** Production code must use `ProjectStorage`; wrappers are test/compat only.
7. **Stdin bypass intentional.** `verify` / `test` `-` never hit the store.
8. **Import does not mean HTTP fetch in the JSON adapter.** Callers pass `data`. A future remote adapter may implement network I/O inside `import` without changing callers that already pass documents.
9. **Public / wire surface.** No schema change; no new package exports for the store.
10. **Scope-creep flags (do not implement):**
    - DB/remote adapters; backend selection flags; sync; shared package extraction.
    - Wiring or rewriting browser-core / extension onto `ProjectStorage`.
    - New CLI list/import/delete commands.
    - Entity-level group/rule APIs; validate/compile inside the store.
    - Shared CAS/revision protocol; factory options bags; in-memory production adapter.
    - Refactors of edit/verify/test/runtime beyond the storage seam.

---

## Acceptance criteria

1. `ProjectStorage` exists in `packages/cli` with `list`, `get`, `create`, `import`, `update`, `delete` as specified.
2. `createJsonFileProjectStorage()` implements all six methods with JSON-file semantics (path-as-id, atomic writes, codes above).
3. Groups/rules remain nested in the project document only—no group/rule store APIs.
4. Compat `readProject` / `writeProject` remain and delegate appropriately; production CLI commands/routes use `ProjectStorage` for file-backed I/O.
5. `edit` uses get + create bootstrap; save uses update; `verify` / `test` / `runtime` use get for file paths; stdin (`-`) unchanged.
6. Validation/compilation remain at caller boundaries.
7. No schema/editor/browser-core/extension storage changes; no DB/remote adapter code; no backend-selection config.
8. Unit tests cover get/create/update/import/list/delete on the JSON adapter; route/command tests still pass.
9. Docs describe the lifecycle port; local-first product constraints unchanged.
10. `pnpm validate` passes.
11. Implementation followed **TDD** for Phases 1–3.
