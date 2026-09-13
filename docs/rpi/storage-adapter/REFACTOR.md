# REFACTOR — storage-adapter

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/storage-adapter`  
**Branch:** `feature/storage-adapter`  
**Base:** `main`  
**Inputs:** `PLAN.md`, `CHECKLIST.md`, `RESEARCH.md`, `git diff main..HEAD`

Proposal only. No implementation in this phase.

---

## Candidate 1 — Split port/adapter out of `file.ts`

**Candidate:** Move `ProjectStorage`, `ProjectRef`, `ProjectStorageError` / `ProjectFileError`, helpers (`readDocument`, `writeDocument`, `pathExists`, `projectName`, list filename filter), and `createJsonFileProjectStorage` into an adjacent module (e.g. `packages/cli/src/utils/project-storage.ts`). Keep `packages/cli/src/utils/file.ts` as a thin public façade that re-exports the port surface and retains compat `readProject` / `writeProject` (and the module-level `defaultStorage` used by those wrappers).

**Expected benefit:** `file.ts` grew from a small read/write helper into the full lifecycle port (~320 lines). A sibling module matches the PLAN’s “`file.ts` or one adjacent module” home and gives the next JSON-or-other backend a clear place to land without further bloating the utils catch-all. Import sites that already talk about storage can point at the storage module; tests/fixtures that only need wrappers keep importing `file.js`.

**Risk:** Import-path churn in CLI commands, routes, and tests if re-exports are incomplete. Mitigate by re-exporting the full public surface from `file.ts` so existing import paths keep working; then optionally tighten imports in a follow-up.

**Scope:** `packages/cli/src/utils/file.ts`, new `packages/cli/src/utils/project-storage.ts` (name flexible), import updates only if not relying on re-exports. No behavior, error-code, or package `exports` changes. No new package.

**Test plan:** Existing `project-storage.test.ts` and `file.test.ts` pass unchanged (or with import path tweaks only). Grep that production still constructs storage via the factory and that wrappers still delegate. `pnpm --filter @rogatio/cli test` (or workspace equivalent) green; no `pnpm validate` regressions attributable to the move.

**Recommendation:** worth pursuing

---

## Candidate 2 — Optional `storage` override on CLI command options

**Candidate:** Where commands already accept an options bag (`editCommand` already has `EditCommandOptions`; mirror a small optional field on verify/test/runtime entrypoints that are testable), add `storage?: ProjectStorage` defaulting to `createJsonFileProjectStorage()`. Production CLI paths stay behavior-identical. Stop hardcoding the factory as the only construction site inside each command body when an override is supplied.

**Expected benefit:** The port is injectable in name, but every production command still constructs the JSON-file adapter inline. An optional override is the cheapest way for a future second backend (or unit tests) to swap the port without a registry, flags, or command-structure rewrite—aligning with the feature goal (“without changing the application architecture”) while staying inside PLAN non-goals (no DI container, no backend-selection config).

**Risk:** Signature/options surface grows on four commands; tests that construct commands must ignore or explicitly pass storage. Must not invent product flags or config to select backends. Runtime’s stdin path must remain outside the store.

**Scope:** `edit.ts`, `verify.ts`, `test.ts`, `runtime.ts` (options / factory default only), plus any existing command tests that need typing updates. No new CLI subcommands. No browser-core changes.

**Test plan:** Default path: existing edit/verify/runtime/test suites unchanged in behavior. Add or extend one narrow test that injects a fake `ProjectStorage` (e.g. `get` / `update` spies) and asserts the command uses it for file-backed I/O and still bypasses storage for stdin `-`. Confirm no production code path requires the override.

**Recommendation:** worth pursuing

---

## Candidate 3 — Single empty-document constant for create + edit bootstrap

**Candidate:** Export (or module-private + shared) one empty `RogatioProject`-shaped document `{ version: 1, name: "", groups: [] }` used by `create` when `data` is omitted and by `edit` bootstrap. Prefer `storage.create({ id: filePath })` without re-stating `data` in `edit.ts`, keeping in-memory `projectData` equal to that same constant (avoid a post-create `get`, which the harden commit already removed for good reason).

**Expected benefit:** Eliminates the only duplicated document literal between adapter and call site; prevents silent drift if empty shape ever gains a field.

**Risk:** Very small. Over-exporting a “public” empty document could imply a schema API; keep it internal to the storage module (or a non-exported shared const) unless tests need it.

**Scope:** `file.ts` / `project-storage.ts` `create` default, `edit.ts` bootstrap. No schema package changes.

**Test plan:** Existing create-default and edit-bootstrap tests; assert create-without-data and edit-on-missing-file still produce the same document. Optional: one assertion that both paths share the same object shape (deep equal), not necessarily the same reference.

**Recommendation:** marginal

---

## Candidate 4 — Hold `ProjectStorage` on `RouteContext` instead of bound `update`

**Candidate:** Change `RouteContext` from `update: ProjectStorage["update"]` + `storage.update.bind(storage)` to `storage: ProjectStorage` (save still calls `context.storage.update(context.filePath, body)`). Optionally keep a narrow `update` alias only if something external depended on the name—prefer one field.

**Expected benefit:** Removes `.bind` awkwardness; save route and edit bootstrap share the same injected object if Candidate 2 lands; slightly clearer “host owns the port” story for a later backend.

**Risk:** Test mock churn (`routes.test.ts` update mock → storage mock). YAGNI today: the HTTP surface only needs `update`. Doing this without Candidate 2 is mostly cosmetic.

**Scope:** `routes.ts`, `edit.ts`, `routes.test.ts`. No HTTP contract change.

**Test plan:** `routes.test.ts` save success/failure cases; edit smoke tests. Assert save still validate→compile→update and does not call get/create.

**Recommendation:** marginal (pursue only if Candidate 2 is approved; otherwise skip)

---

## Candidate 5 — Deduplicate overlapping file vs project-storage tests

**Candidate:** `file.test.ts` still covers atomic write, JSON round-trip, and read error codes via compat wrappers; `project-storage.test.ts` largely re-covers the same behaviors through the port plus wrapper-parity cases. Fold redundant wrapper scenarios into one suite (keep a thin wrapper-parity section; drop duplicated atomic/error cases from one file).

**Expected benefit:** Less double maintenance when adapter semantics change; clearer “port contract” vs “compat façade” ownership.

**Risk:** Accidental coverage loss if a case exists only in one file. Merge carefully; prefer deleting duplicates from `file.test.ts` while keeping wrapper entrypoints exercised in `project-storage.test.ts`.

**Scope:** `packages/cli/test/file.test.ts`, `packages/cli/test/project-storage.test.ts` only. No production code.

**Test plan:** Diff coverage / run both files before and after; ensure atomic-temp, `is-directory`, `invalid-json`, `invalid-format`, `not-found`, and wrapper upsert remain asserted exactly once each.

**Recommendation:** marginal

---

## Rejected (self-review)

| Idea | Why rejected |
| --- | --- |
| Shared path-or-stdin loader across verify/test/runtime | Command-structure refactor; PLAN scope-creep flag; stdin shapes differ (buffered vs stream). |
| Private `requireJsonFileId` only | Two near-identical blocks; benefit too small to stand alone (may fold into Candidate 1 mechanically). |
| Module-level singleton storage for all commands | Fights intentional optionless/stateless factory; worse for Candidate 2. |
| Throw `ProjectStorageError` instead of `ProjectFileError` inside JSON adapter | PLAN wants path compat via subclass; current throws already satisfy `instanceof` both ways. |
| Generic errno/`mapFsError` helper | Pattern matches the rest of CLI; low leverage. |
| Change `list` to rethrow non-parse failures | Behavior change, not a refactor. |
| browser-core / `ProjectRepository` unification | Explicit non-goal. |
| DB/API adapters, CLI list/import/delete commands, entity CRUD | New features, not refactors. |
| `edit.ts` dynamic `import("node:fs/promises")` → static import | Pre-existing style nit; unrelated leverage. |

---

## Summary ranking

1. Split port/adapter module — **worth pursuing**
2. Optional command `storage` inject — **worth pursuing**
3. Empty-document constant / edit `create({ id })` — **marginal**
4. `RouteContext.storage` vs bound `update` — **marginal** (pair with 2)
5. Deduplicate storage tests — **marginal**
