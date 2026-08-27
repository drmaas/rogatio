# F19 — Implementation Plan (Astro + Starlight docs site)

Branch: `feature/f19-docs-site` · Tier: Free (single-model; distinct role passes).

## Tasks

### T1 — Scaffold package + dependencies (covers REQ-001, REQ-002, REQ-007)
- **File:** `packages/docs-site/package.json` (new)
- **Behavior:** private `@rogatio/docs-site`; scripts `dev`/`build`/`preview`/`check`;
  deps `astro@^7`, `@astrojs/starlight@^0.41.9`. `type: module`.
- **Verify:** `pnpm install` resolves the workspace; `pnpm --filter @rogatio/docs-site build`
  runs after content exists.

### T2 — Starlight config + sidebar (covers REQ-006, REQ-003 structure)
- **File:** `packages/docs-site/astro.config.mjs` (new)
- **Behavior:** `starlight` integration, `title: "Rogatio"`, `social` omitted (no external
  calls), `sidebar` mapping 1:1 to REQ-003 sections, `lastUpdated` on.
- **Verify:** AC-005 — sidebar entries match sections.

### T3 — Author content pages (covers REQ-003, AC-002, AC-007)
- **Files:** `packages/docs-site/src/content/docs/**.md` (new)
- **Behavior:** overview, getting-started/{installation,quick-start}, guides/{projects-rules,
  editor, dry-run, extension, runtime}, rules/{redirects, query-params, headers, mocks,
  response-body, request-body}, reference/{cli, extension, platforms, security, architecture}.
  Content consistent with `rogatio-overview.md`/`sequence.md`; must state public CLI =
  edit/verify/runtime and request-body capability-gated `unsupported`.
- **Verify:** AC-002 — each page present in `dist/` after build.

### T4 — Isolate from canonical validation (covers REQ-004, REQ-005, AC-003, AC-004)
- **Files:** repo-root `tsconfig.json` (`exclude` += `packages/docs-site/**/*`);
  `.biomeignore` (+= `packages/docs-site`).
- **Behavior:** root `typecheck`/Biome no longer process the Astro/Markdown package.
- **Verify:** AC-004 — `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build &&
  pnpm test` all exit 0 from repo root.

### T5 — Build + verify (covers AC-001, AC-006)
- **Command:** `pnpm --filter @rogatio/docs-site build`
- **Behavior:** static `dist/` emitted; `dist/`, `node_modules/` gitignored; no secrets/telemetry.
- **Verify:** AC-001, AC-006.

## Ordering
T1 → T2 → T3 → T4 → T5 (T4 can run any time after T1; shown last to batch root-file edits).

## Tests
F19 is content/static-build; no Vitest suite. Verification is the build + root validation
(AC-001..AC-006). "Tests first" is satisfied by asserting the build + root green as the
contract; no implementation-only assertions to weaken.

## Generated / ignored artifacts
- `packages/docs-site/dist/` (gitignored via `**/dist` and `packages/*/dist/`).
- `packages/docs-site/node_modules/` (gitignored).
- Astro-generated `.astro/types.d.ts` (gitignored via `**/dist`? no — excluded from tsc).
