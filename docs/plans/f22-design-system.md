# F22 — Design System Implementation Plan

Approved spec: `docs/specs/f22-design-system.md`. Worktree:
`/home/drmaas/.local/share/opencode/worktree/rogatio/feature/design-system`
(branch `feature/design-system`). Canonical verification: `node scripts/validate.ts`.

## Task map

| Task | Area | Behavior / invariant | ACs | Verification |
| --- | --- | --- | --- | --- |
| T1 | `packages/editor/assets/fonts/` | Bundle Hanken Grotesk (400/500/700) and JetBrains Mono (400/700) woff2 + OFL license texts; no runtime fetch | AC-001, AC-003, AC-008 | Files present; fonts served woff2 |
| T2 | `packages/editor/src/editor.css` (new) | Token system, `@font-face`, dot grid, top nav layout, cards/buttons/badges/dialog/test panel, forced-colors, reduced-motion, mobile | AC-001, AC-002, AC-007 | Browser computed-style + layout tests |
| T3 | `packages/editor/src/editor.ts` | Delete `EDITOR_CSS`; remove `<style>` injection; keep all `data-*`/roles | AC-001 | `tsc`, browser tests |
| T4 | `scripts/build.ts` | Emit `editor/dist/browser/index.css`, `extension/dist/extension-page.css`, `extension/dist/popup.css`; copy fonts to editor dist `fonts/` and extension dist `fonts/`; copy editor CSS to extension dist `editor.css`; record all in `build-manifest.json` | AC-003, AC-008 | `node scripts/validate.ts` |
| T5 | `scripts/validate.ts` | Assert 3 CSS artifacts + font files in manifest/layout; JS-only MV3 forbidden guard unchanged | AC-003, AC-008 | `node scripts/validate.ts` |
| T6 | `packages/cli/src/commands/edit.ts`, `packages/cli/src/server/routes.ts` | Editor HTML links `/vendor/editor.css`; serve `/vendor/editor.css` (text/css) + `/vendor/fonts/*` (font/woff2, confined) | AC-003, AC-004 | `test/integration/cli-edit.test.ts` additions |
| T7 | `packages/extension/src/extension.css` (new), `packages/extension/src/extension-page-entry.ts`, `packages/extension/public/index.html` | Dark shell: top app bar (brand `Rogatio`, Dashboard/Workspace tabs, Refresh/Export/Remove, badge), sidebar (project card, switch/create/import, runtimes, group toggles, permissions), Overview project-card grid; preserve every `data-*`/role/label/command | AC-005, AC-007 | Browser tests incl. existing extension.spec |
| T8 | `packages/extension/src/popup.css` (new), `packages/extension/src/popup.ts`, `packages/extension/public/popup.html`, f21 docs | Dark popup card; brand "Rogatio" (rename only, no notes); link `popup.css` | AC-006, AC-010 | Browser popup test |
| T9 | `scripts/serve-smoke.ts`, `test/fixtures/editor-fixture.html`, `test/browser/design-system.spec.ts` (new) | Serve css/woff2 MIME; fixture links `/editor/index.css`; new dark-theme/top-nav/served-assets tests | AC-001..AC-003, AC-007 | `pnpm test:browser` |
| T10 | `docs/` | Architecture section (done at Stage 2, keep synced), README design-system note, workflow log, f21 doc brand rename | AC-009 | Doc review |

## Ordering and dependencies

1. T1 (assets) — prerequisite for every CSS file and build copy.
2. T2 + T3 (editor CSS + removal of embedded styles) together; T3 depends on T2.
3. T4 + T5 (build + validation) — must land with T2/T3 or `pnpm build`/`validate` break; T6 (CLI host) depends on their artifacts.
4. T7 (shell) and T8 (popup) depend on T4 (they ship the extension CSS entries).
5. T9 (tests/fixture/server) can proceed in parallel with T7/T8; T10 last.

Tests are written first (Stage 6): the new `test/browser/design-system.spec.ts`,
the fixture stylesheet link, and the `cli-edit.test.ts` CSS/font route assertions.
They are intentionally red until T2/T4/T6 land.

## Notes

- CSS is Biome-formatted (`pnpm format:check` covers CSS per biome.json includes).
- `@font-face` sources use relative `fonts/…` paths so each host resolves them next
  to its stylesheet: CLI `/vendor/editor.css` → `/vendor/fonts/…`; extension
  `editor.css`/`extension-page.css`/`popup.css` → `fonts/…` in extension dist.
- Overview card stats use truthful existing state (persisted groups/rules/enabled
  counts, project id); Export/Remove reuse the existing commands.
- No dependency additions; no MV3 CSP or manifest permission changes.