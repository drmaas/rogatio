# Requestly import — plan

> Audience: hybrid
> Status: draft for review with the implementation (issue #262)
> Issue: [#262](https://github.com/drmaas/rogatio/issues/262)
> Spec: `docs/decisions/requestly-import/spec.md`

## Approach

Put the mapping in a new private package `@rogatio/requestly-import` that depends only on `@rogatio/schema`. The CLI command reads the export, calls the package, runs the same schema-plus-compiler checks as `rogatio verify`, and writes only after those checks pass.

Rejected alternatives:

- Mapping inside `@rogatio/schema`. The schema package does not own action payloads or consumers.
- Mapping inside `@rogatio/compiler`. The compiler turns a valid project into operations. Import is the other direction.
- Mapping inside the CLI only. The editor would have to reimplement it, and the tests would need a filesystem for every rule type.

## Package

`packages/requestly-import` exports:

- `importRequestlyExport(value, options?)` → `{ ok: true, project, report }` or `{ ok: false, error }`
- `mergeProjects(existing, imported)` → a version-2 project plus rename notes, or an error when a limit would be exceeded

Modules:

- `snapshot.ts` — own-data snapshot. Reject cycles, accessors, symbols, sparse arrays, and non-plain prototypes.
- `parse.ts` — array export, single rule, `{ rules, groups | updatedGroups }`, and non-empty `children`.
- `source.ts` — Url / host / path operators to a Rogatio source condition, plus filter reading.
- `replace.ts` — literal Replace to one or two redirect rules.
- `map.ts` — one Requestly rule to drafts, changes, or a skip reason.
- `project.ts` — groups, ids, names, priorities, report counts.
- `merge.ts` — append groups onto an existing project.

No `node:` imports. No new dependencies.

## CLI

`packages/cli/src/commands/import.ts`

- `rogatio import requestly <export.json> [--out <path>] [--merge] [--json]`
- Default `--out` is `./.rogatio.json`.
- Existing file without `--merge`: exit 2, no write.
- `diagnoseProject` extracted from the verify command so import and verify share one validation path.
- Help text on `rogatio --help`, `rogatio import --help`, and `rogatio import requestly --help`.

Build and test wiring: esbuild target, CLI alias so the published bundle has no workspace dependency, vitest alias, and `scripts/validate.ts` artifact list plus a boundary check that the package depends only on `@rogatio/schema`.

## Fixtures

`packages/requestly-import/test/fixtures/` holds one export per supported rule type and `mixed.json` (groups, every supported type, Cancel, Delay, Script). Tests assert the mapped project passes `validateProjectDetailed` and `compileProject`, and that the mixed report names each skipped rule.

CLI tests cover overwrite refusal, `--merge`, `--out`, and `--json`.

## Docs

- Docs site page `guides/migrating-from-requestly.md`, sidebar link.
- README, CLI readme, help, `docs/architecture.md`, `rogatio-overview.md`, and `AGENTS.md` gain the command and the package boundary.

## Verification

`pnpm validate` is the completion check. It is the same sequence CI runs.

## Not in this change

Editor import UI. Cancel, delay, and script rules stay skipped on purpose.

## Addendum — host authority confinement (issue #307)

`source.ts` `convertHost`:

- `Wildcard_Matches` uses `hostWildcardBody` (`*` → `([^/?#@]*?)`) plus an optional `:port` before the path/query/fragment group.
- `Contains` uses `[^/?#@]*` instead of `[^/?#]*`.
- `Matches` is skipped with a fixed reason (RE2 has no lookarounds).

URL/path wildcard handling and `replace.ts` stay on `wildcardBody` (`(.*?)`).
Regression coverage lives in `packages/requestly-import/test/import.test.ts`.
