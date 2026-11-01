# F12 Implementation Plan — Offline Dry-Run / Test

**Spec:** `docs/specs/f12-offline-dry-run.md` (Option A approved at gate).
**Worktree:** `feature/f12-offline-dry-run`. **Base:** `acf4c2c`.

## Package layout

New private package `@rogatio/dry-run` (Node ESM, pure). Deps: `@rogatio/compiler`,
`@rogatio/schema`. Consumed by `@rogatio/cli` (both `test` command and `edit` server).
NOT imported by the editor browser bundle.

```
packages/dry-run/
  package.json
  tsconfig.json
  src/
    index.ts        # public exports
    types.ts        # DryRunTestCase, MatchDimension, RuleMatchResult, DryRunResult, DryRunOptions, errors
    dryrun.ts       # dryRunProject engine + matching + input validation
    url.ts          # safe URL parse helper (no network)
  test/
    dryrun.test.ts  # unit: AC-001..AC-008
```

## Task list (ordered)

### T1 — `@rogatio/dry-run` package scaffold
- `package.json` (name `@rogatio/dry-run`, `type: module`, ESM/NodeNext, deps on
  workspace `compiler` + `schema`, Biome/tsconfig aligned with repo). Add to pnpm
  workspace (`pnpm-workspace.yaml`) if not auto-globbed.
- `tsconfig.json` matching repo strict TS 7 / NodeNext settings (mirror `packages/compiler`).
- Covers: REQ-001, REQ-007, REQ-008.

### T2 — Engine types (`types.ts`)
- `DryRunTestCase`, `MatchState`, `MatchDimension`, `ActionPreview`, `RuleMatchResult`,
  `UrlDryRunResult`, `DryRunError`, `DryRunOptions`, `DryRunResult` exactly per spec §7.
- Covers: REQ-002, REQ-003, REQ-004, REQ-008.

### T3 — Safe URL parse (`url.ts`)
- `parseTestUrl(url): { ok: true; origin: string } | { ok: false }`.
- Uses WHATWG `URL`; rejects non-string, empty, and non-absolute URLs; never fetches.
- Covers: REQ-006, REQ-007 (origin dimension).

### T4 — Engine (`dryrun.ts`)
- `dryRunProject(operations, cases, options?)`:
  1. Defensive snapshot of `cases` (reject proxies/accessors/cycles/symbols without
     invoking getters) → `dryrun.invalid-case` per bad entry.
  2. `maxCases` default 256; if `cases.length > maxCases` → single `dryrun.batch-limit`
     error, empty results.
  3. Compile each `urlRegex.source` to `RegExp` once per operation (cache map); on
     invalid regex source skip rule for that run with a stable note (should not happen
     post-compile, but defensively treat as `unmatched` regex + detail).
  4. Per case: `parseTestUrl`; invalid → `dryrun.invalid-url` error, excluded from
     matching; valid → evaluate all operations' 4 dimensions per REQ-003/REQ-004.
  5. `actionPreview`: call `options.previewAction` if provided; else `null`.
  6. Build `summary` (caseCount, urlCount=valid, matchedUrlCount, matchedRuleTotal).
- Covers: REQ-001, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008.

### T5 — Unit tests (`test/dryrun.test.ts`)
- Map to AC-001..AC-008. Use compiled fixtures (call `compileProject` on small projects).
- Include: resourceTypes-empty matches all; no-method matches all; batch limit boundary
  (maxCases vs maxCases+1); invalid URL; cyclic case rejected.
- Also a test asserting **no network/filesystem side effects** (counts `fetch`/fs calls —
  Node has no global `fetch` in this surface; assert engine makes zero module-level
  network calls by stubbing `globalThis.fetch` if present).

### T6 — CLI `test` command (`packages/cli`)
- `commands/test.ts`: arg parse (positional path + urls, `--json`, `--method`,
  `--resource-type`, `--urls-file`, `--max-cases`, `--help`). Read project (file or `-`
  stdin). `validateProjectDetailed` + `compileProject`; invalid → diagnostics + exit 1.
  Build `DryRunTestCase[]` (apply global method/resourceType). Call `dryRunProject`.
  Print human report (per URL → per rule → dimension states + overall) or `--json`
  `DryRunResult`. Exit 0 on success, 2 on IO/parse error.
- `index.ts`: register `test` case + help text. Update top-level help (`Commands:` list).
- Covers: REQ-009, REQ-010, AC-009, AC-010.

### T7 — Editor server endpoint (`packages/cli/server/routes.ts`)
- `POST /api/dry-run` (CSRF-protected): body `{ project, cases, options }`. Server-side
  compile; return `DryRunResult` JSON; invalid CSRF → 403; invalid JSON → 400.
- Covers: REQ-011, AC-011.

### T8 — Editor "Test rules" route/panel (`packages/editor`)
- Add host `dryRun` adapter type to `EditorOptions` (mirror `validate`):
  `(cases, options) => DryRunResult | Promise<DryRunResult>`; on error returns stable
  editor diagnostic.
- Add a "Test rules" command to the command bar (project route), a test panel route with
  a URLs textarea (one per line) + optional method/resource-type selects, Run button,
  and a results view (per-URL / per-rule dimension states + overall match badges).
- Accessibility: keyboard, SR, forced-colors, 200% zoom parity with F5.
- Covers: REQ-012, AC-012.

### T9 — Editor host wiring (`packages/cli/commands/edit.ts`)
- Add `dryRun` adapter to `createEditor` options that POSTs to `/api/dry-run`.
- Covers: REQ-012 end-to-end.

### T10 — Integration test (no-side-effects + endpoint)
- `packages/cli/test`: start `edit` server, `POST /api/dry-run` happy + 403 + 400
  (AC-011). `test` command against a temp project file: valid run exit 0, invalid
  project exit 1, missing file exit 2, `--json` shape (AC-009/AC-011).

## Verification (Stage 8)
- `pnpm -r --filter @rogatio/dry-run run test` (Vitest), plus cli integration tests.
- Repo canonical validation: Biome format+lint, `tsc` strict, build (esbuild), full
  `pnpm test` for changed packages.
- Assert AC-013 (no network/fs/permission/runtime calls) via the side-effect test + review.

## Rollback / flags
- Additive package + new CLI subcommand + new editor route. No migration, no file-format
  change. If reverted, only the new package and the two new integration points change.

## Documentation (Stage 10)
- `docs/architecture.md`: add F12 section (new package, boundary, no Node import in
  editor bundle). Update package-boundary diagram.
- `README.md`: document `rogatio test` usage.
- `AGENTS.md` orientation: note F12 landed.
