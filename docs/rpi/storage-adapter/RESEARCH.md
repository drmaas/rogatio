# RESEARCH: storage-adapter

## Problem restatement

Use the rpi skill to create an adapter layer for the project, group, and rule storage, which currently has 1 implementation: json file. The goal is to add other implementations over time, which could be databases or remote APIs, without changing the application architecture.

## Codebase findings

### Fit to the problem

The product already has two injected-or-helper persistence seams, neither of which is a shared project/group/rule repository. Groups and rules are nested arrays inside `RogatioProject`; there is no entity-level store today. A plan that preserves application architecture should introduce (or unify behind) whole-document ports in the existing injected-adapter style, then decide whether CLI file I/O, browser-core envelope storage, or both are the first cut — without requiring group/rule CRUD unless the product scope expands.

### Two persistence surfaces today (not one)

Rogatio persists project/group/rule *source* in two different places with different shapes and ports. Neither surface exposes group- or rule-level CRUD; groups and rules are nested fields inside a whole-project document.

| Surface | Shape | Port / I/O | Production implementation |
| --- | --- | --- | --- |
| Canonical file (CLI / VCS) | `RogatioProject` (schema v1) | `readProject` / `writeProject` | Single `.rogatio.json` on disk |
| Browser profile store | `StoredEnvelope` wrapping many `StoredProject` | `StorageAdapter` (`read` + `compareAndSwap`) | Chrome `storage.local` key `"rogatio"` |

Product overview states the repository file is canonical and that import/export is explicit between file and browser (`rogatio-overview.md:5`).

### Schema: project / group / rule document shape

Authoritative types live in `@rogatio/schema`:

- `RogatioProject`: `{ version, name, description?, groups, requestBodyPolicy? }` (`packages/schema/src/types.ts:157-163`).
- `RogatioGroup`: `{ id, name, origins, rules }` (`packages/schema/src/types.ts:150-155`).
- `RogatioRule`: matcher fields plus optional action fields (`packages/schema/src/types.ts:119-148`).

JSON Schema root: object, `additionalProperties: false`, required `version` / `name` / `groups` (`packages/schema/src/schema.ts:20-38`). `$id` is `https://rogatio.dev/schema/project-v1.json` (`packages/schema/src/schema.ts:22`).

Bounds (selected): `maxGroups: 64`, `maxRulesPerGroup: 256`, `maxRulesPerProject: 4096` (`packages/schema/src/limits.ts:2-4`).

Sample file matching this shape: `samples/basic/.rogatio.json` (project with nested `groups[].rules[]`).

There is no separate on-disk store for a group or a rule; they exist only as array elements inside the project document.

### CLI: the JSON-file implementation

File I/O is owned by `packages/cli/src/utils/file.ts`. Public surface: `ProjectFileError`, `readProject`, `writeProject`.

- `ProjectFileError`: `{ code: string, path: string }` plus message/cause (`packages/cli/src/utils/file.ts:5-15`).
- `readProject(path: string): Promise<unknown>` — `fs.readFile` + `JSON.parse`; rejects non-objects/arrays/null with code `invalid-format`; maps `ENOENT` → `not-found`, `SyntaxError` → `invalid-json`, other I/O → `read-failed` (`packages/cli/src/utils/file.ts:17-57`). Does **not** run schema validation; callers validate.
- `writeProject(path: string, data: unknown): Promise<void>` — `mkdir(dirname, { recursive: true })`, write a sibling temp file, `rename` onto the target, pretty-print with `JSON.stringify(data, null, 2)`; on failure attempts temp `unlink`, maps `EISDIR` → `is-directory`, else `write-failed` (`packages/cli/src/utils/file.ts:60-90`). Atomicity is rename-replace of one file, not compare-and-swap / revision checks.

Callers of `readProject` / `writeProject`:

- `rogatio edit` — default path `cwd/.rogatio.json`; creates `{ version: 1, name: "", groups: [] }` when missing (`packages/cli/src/commands/edit.ts:58-106`).
- Editor save path: loopback `POST /api/save` — CSRF check; body JSON parse; `validateProjectDetailed` → `400 validation-failed`; `compileProject` → `400 compilation-failed`; then `context.writeProject(context.filePath, body)`, assigns `context.project = body`, or `500 write-failed` (`packages/cli/src/server/routes.ts:317-381`).
- `GET /api/project` returns the in-memory `context.project` snapshot, not a fresh disk read (`packages/cli/src/server/routes.ts:273-277`).
- `rogatio verify` (`packages/cli/src/commands/verify.ts:52`), `rogatio test` (`packages/cli/src/commands/test.ts:316`), and `rogatio runtime` (`packages/cli/src/commands/runtime.ts:342`) also `readProject` the same file shape.

`RouteContext` already injects `writeProject: (path: string, data: unknown) => Promise<void>` (`packages/cli/src/server/routes.ts:13-17`), but the concrete implementation is always the JSON file helper from `edit.ts` (`packages/cli/src/commands/edit.ts:118-122`).

**CLI does not import `@rogatio/browser-core`, `ProjectRepository`, or `StorageAdapter`.** Grep under `packages/cli` finds no such references.

### Browser-core: existing adapter port for multi-project storage

`StorageAdapter` is already the injected persistence boundary for the extension lifecycle:

```ts
interface StorageAdapter {
  read(): Promise<unknown>;
  compareAndSwap(previous: unknown, next: unknown): Promise<boolean>;
}
```

(`packages/browser-core/src/types.ts:24-33`)

Contract notes from the same type comment: `read` may return `undefined` when empty; `compareAndSwap` replaces only when the stored value structurally equals `previous`; the adapter is the atomicity authority and must serialize concurrent operations.

Envelope types:

- `StoredEnvelope`: `{ version, projects: Record<id, StoredProject>, activeProjectId }` (`packages/browser-core/src/types.ts:18-22`).
- `StoredProject`: `{ id, name, data: RogatioProject, revision, createdAt, updatedAt, enabledGroupIds, grantedOrigins }` (`packages/browser-core/src/types.ts:7-16`).
- Canonical project source sits in `StoredProject.data`; enablement/grants/revision are browser-profile metadata around that source.

`RepositoryOptions`: `{ storage: StorageAdapter; generateId?: () => string; now?: () => number }` (`packages/browser-core/src/repository.ts:21-25`). `MAX_PROJECTS = 64` (`packages/browser-core/src/repository.ts:19`).

`ProjectRepository` constructor takes `RepositoryOptions` (`packages/browser-core/src/repository.ts:68-77`) and exposes whole-project lifecycle: `state`, `createProject`, `importProject`, `saveProject(projectId, data, expectedRevision)` (conflict when revision mismatches; no CAS retry), `switchProject`, `removeProject`, `setGroupEnabled`, `exportProject` (returns `RogatioProject` from `StoredProject.data`), etc. Mutations are read-modify-CAS via private `mutate` with optional retry (`packages/browser-core/src/repository.ts:528-532`). Write paths validate through private `validateData` → `validateProjectDetailed` (+ origins) (`packages/browser-core/src/repository.ts:484-501`). Corrupt/unknown storage fails closed: `readEnvelope` maps storage `read` throws and failed `migrateEnvelope` to `core.storage-corrupt` (`packages/browser-core/src/repository.ts:504-525`); `migrateEnvelope` treats `undefined` as empty via `createEmptyEnvelope` (`packages/browser-core/src/migrate.ts:10-12`, `168-174`) and rejects unknown versions / structural violations.

Architecture docs restate CAS as the atomicity authority and list product invariants (≤64 projects, single active, enablement reset on create/import/save, grant pruning) (`docs/architecture.md:90-92`).

Same injected-adapter style exists for rule installation (`RuleInstallerAdapter` in `packages/browser-core/src/types.ts:35-44`); useful only as a pattern parallel, not a storage dependency.

Public exports include `StorageAdapter`, `StoredEnvelope`, `StoredProject`, `ProjectRepository`, `RepositoryOptions` (`packages/browser-core/src/index.ts:5-6`, `17-34`).

### Extension: Chrome `StorageAdapter` implementation

`createStorageAdapter(api)` (`packages/extension/src/chrome.ts:74-114`):

- `read()` → `chrome.storage.local.get("rogatio")`; returns the `rogatio` value (may be `undefined` when empty); throws `extension.storage-failed` if the get result is not a plain object.
- `compareAndSwap(previous, next)` serializes mutations with an in-process promise lock; CAS success requires `JSON.stringify(current) === JSON.stringify(previous)`, then `set({ rogatio: next })`; same `extension.storage-failed` guard on get.

Wired into `ProjectRepository` in `createExtensionApplication` (`packages/extension/src/service-worker.ts:217-221`) and constructed in `background.ts` (`packages/extension/src/background.ts:235`).

Import/export of the canonical `.rogatio.json` shape is explicit UI/protocol (`export-project` command in `packages/extension/src/extension-page-entry.ts:1470-1493`), not continuous file sync.

Test doubles for `StorageAdapter` (Memory / Flaky / Racing) live in `packages/browser-core/test/repository.test.ts:71-156`.

### Editor host ports (related, not storage)

`createEditor` takes host-supplied `validate` and `save` adapters; the editor owns no persistence (`docs/architecture.md:165-177`, interface sketch `175-201`). CLI and extension each wire those adapters to their own save paths (file HTTP API vs repository/messages). Any new storage layer should remain behind those hosts so the editor boundary stays unchanged.

### Package boundary summary

Dependency direction from AGENTS / architecture: `schema → compiler → { editor, dry-run, browser-core } → { cli, extension }`; `runtime` depends on schema + compiler only. Browser-core already owns “versioned project storage” behind adapters (`AGENTS.md` package role for `browser-core`; `docs/architecture.md:74-76`). CLI file I/O is a separate, package-local concern today. There is no shared package that abstracts both `.rogatio.json` document I/O and the browser envelope.

## External findings

Not greenfield for the core problem: the repository already defines adapter ports and a JSON-file project store. No external library survey is load-bearing for planning where the new layer should sit.

## Constraints and invariants

- **Canonical source shape** remains schema v1 `RogatioProject` with nested groups/rules; validation is `validateProjectDetailed` / `compileProject` at write boundaries (CLI save route; repository `validateData`). Raw CLI `readProject` returns unvalidated `unknown`.
- **Local-first product stance:** overview states no accounts, hosted runtime, or cloud sync (`rogatio-overview.md:5`). Architecture security section forbids hosted endpoints and persistent user data beyond the version-controlled `.rogatio.json` file (`docs/architecture.md:52-54`). Remote/DB backends would need an explicit product/architecture amendment if they change that boundary.
- **Browser-core storage invariants** (CAS atomicity, fail-closed corrupt reads, ≤64 projects, single active, enablement/grant rules) must remain behind `StorageAdapter` + `ProjectRepository` unless a decision supersedes them (`docs/architecture.md:90-92`).
- **Do not skip package boundaries** or introduce cycles (`AGENTS.md` dependency direction).
- **Editor must stay persistence-free**; hosts keep supplying `save` / `validate` (`docs/architecture.md:165-177`).
- **Groups/rules are not independently versioned documents** in either current store; any adapter that models per-entity storage must define how that maps back to whole-project validation and export of `.rogatio.json`.
- Problem statement requires **other backends over time without changing application architecture** — prefer extending the existing injected-adapter style rather than rewriting CLI/extension call sites around storage details.
- **CLI edit session** keeps an in-memory project snapshot after load/save; disk and memory can diverge if another process writes the file while the editor server is up (no file watcher / reload path today).

## Open questions

1. **Which surface is in scope for the first adapter cut?** CLI whole-project JSON I/O only; browser-core `StorageAdapter` / envelope only; a new shared port that both hosts implement; or a higher-level project/group/rule repository above both?
2. **Does “json file” mean only `.rogatio.json`, or also the Chrome envelope (which is JSON but not a VCS file)?** Today those are different ports and shapes.
3. **Should group/rule operations be entity-level APIs** (get/put/delete group or rule) or remain whole-document load/save with nested arrays, matching current schema and editor drafts?
4. **How do future database / remote-API backends reconcile with local-first / no-cloud-sync / no-hosted-endpoints** documented in `rogatio-overview.md` and `docs/architecture.md`? Optional opt-in? Offline-only DB? Architecture doc update?
5. **Where should new adapter interfaces and JSON implementation live?** Options with different boundary costs: new package; `browser-core` (already owns storage ports); `cli` (owns file I/O today); thin shared module imported by both.
6. **Must the first JSON implementation preserve CLI atomic rename semantics and browser CAS semantics**, or is a single weaker contract acceptable for all backends?
7. **Is a file-backed `StorageAdapter` (envelope on disk) desired**, or only a `RogatioProject` document store for CLI/edit/verify/test/runtime?
8. **Who owns validation?** Keep validate/compile at callers (current CLI read + browser repository write), or push into the adapter?
9. **What is the cross-backend error contract?** Preserve `ProjectFileError` codes / HTTP `write-failed`, map to `CoreResult` diagnostics, or introduce a new stable error vocabulary for all backends?
