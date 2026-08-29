# F22 — Design System for Editor and Extension Workflow Log

## Tier and model assignment

- Tier: **free** — single-model session (user chose "use the current model of this
  session"); distinct role passes; fresh-context self-review at Stage 9, following the
  F21 precedent.
- Brainstorm / architecture / specification: session model (synthesized as the free
  primary `opencode/nemotron-3-ultra-free` equivalent, per single-model precedent).
- Plan / documentation: session model (free primary `opencode/hy3-free` equivalent).
- Tests / implementation: session model (free primary
  `openrouter/poolside/laguna-s-2.1:free` equivalent).
- Verification: session model (free primary `opencode/nemotron-3.5-lightning-free`
  equivalent).
- Independent review: fresh-context self-review by the session model.

Fallback models recorded per SDD free-phase routing; none were required because the
session model served every role in a single-model environment.

## User decisions (Stage 1)

- Tier: current session model (single-model).
- Fonts: **bundle OFL font files** — Hanken Grotesk (400/500/700) and JetBrains Mono
  (400/700) woff2 shipped with the editor and extension dist; no runtime network.
- Scope: **restyle + shell rework** — dark design-system restyle of the shared editor,
  CLI host, extension management page, and popup; the extension Overview becomes a
  project-cards home; the editor remains the Workspace view; nav bars move to the top.
  No new product features (no History/Settings/Support/accounts, no Mocks/Headers/
  Terminal nav destinations — those have no backing feature).

## Stage status

| Stage | Status | Notes |
| --- | --- | --- |
| 0 Worktree | done | `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/design-system`, branch `feature/design-system` from `main` `b47f9f6` (clean). `pnpm install` completed. |
| 1 Brainstorm | done (ephemeral) | User-supplied approved design + palette; standalone CSS per user instruction; adversarial self-pass recorded below. |
| 2 Architecture | done | `docs/architecture.md` "Design System" section added. |
| 3 Spec | done | `docs/specs/f22-design-system.md` approved at Stage 4. |
| 4 Human review gate | done | User approved spec + architecture as written; also instructed to remove all "Requestify" traces and rename to "Rogatio" silently. |
| 5 Plan | done | `docs/plans/f22-design-system.md`, tasks T1-T10 mapped to AC-001..AC-009. |
| 6 Tests first | done | `test/browser/design-system.spec.ts`, fixture stylesheet link, CLI CSS/font route assertions. |
| 7 Implementation | done | `editor.css`, `extension.css`, `popup.css`, editor `<style>` removal + top nav, shell rework (Dashboard + Workspace tabs, sidebar, project cards), popup restyle + Rogatio rename, build/validate pipeline, CLI CSS/font routes, font bundling, f21 doc brand rename. |
| 8 Verification | done | `node scripts/validate.ts` green (format, lint 0 errors, tsc, build 18 artifacts, 561 unit tests, MV3 contract, forbidden-dep guard, 19 browser E2E incl. new design-system suite + real extension lifecycle). |
| 9 Review | done | Fresh-context self-review round 1: restored popup deep-link `navigateToGroup` regression; no other actionable findings. |
| 10 Docs | done | `docs/architecture.md` Design System section, README note, f22 workflow log, f21 spec/plan brand rename. |
| 11 Release | pending | Awaiting user authorization. |

## Brainstorm synthesis (ephemeral, not retained as a file)

- Problem: the shared CLI editor and Chrome extension look utilitarian (light editor
  theme with an embedded CSS string, unstyled popup, functional-but-plain management
  shell) against the approved dark design system (palette #007AFF / #64748B / #0F172A /
  #1E293B, dot-grid page background, rounded surface cards, Hanken Grotesk + JetBrains
  Mono, top nav bars).
- Chosen approach: standalone CSS per surface (`editor.css`, `extension.css`,
  `popup.css`) emitted by esbuild as real artifacts, linked by hosts; the editor stops
  injecting a `<style>` element (host-supplied stylesheet contract, mirroring the
  existing host-supplied validation/save ports). Offline-first fonts as bundled woff2
  (OFL). Nav bar moved to the top of the editor layout; mobile select navigation
  unchanged. Extension Overview becomes a project-cards home; Workspace keeps the
  editor with the existing command surface reorganized into a top bar + sidebar.
- Adversarial pass (self): CSS selector bleed between the three stylesheets (scoped by
  `.rogatio-editor` / shell root classes); hosts that omit the stylesheet link
  (all in-repo hosts updated: CLI HTML, extension `index.html`, `popup.html`, browser
  fixture); build-manifest expected-artifact count and MV3 forbidden-dep guard must be
  updated together with the build; `serve-smoke.ts` MIME types for CSS/fonts; contrast
  AA on `#007AFF` white-button text fails AA for normal text, so filled buttons use a
  darker `--rogatio-primary-strong` token while `#007AFF` remains the accent; no
  runtime network or CSP changes; data attributes, roles, labels, and commands asserted
  by browser tests must be preserved (identified: `data-desktop-route-rail`,
`data-mobile-route-nav`, `data-rogatio-editor`, `#rogatio-title` heading, "Project to
switch", "Switch project", group toggles, badge/status regions); all user-visible
surfaces and the f21 popup documents use the "Rogatio" brand.

## Verification evidence (Stage 8)

Command: `node scripts/validate.ts` (canonical: Biome format + lint, `tsc --noEmit`,
`node scripts/build.ts`, Vitest, MV3 manifest contract, forbidden-dependency guard,
Playwright browser E2E).

- Format: clean (after `biome check --write` import-sort fix).
- Lint: 0 errors (6 pre-existing-style `!important` warnings in reduced-motion
  blocks, matching the pre-existing pattern; no unknown properties after fixing a
  `font-weight-neutral` typo).
- Typecheck: clean.
- Build: `Built 18 ESM artifact(s)` — 15 JS + 3 CSS (`editor/dist/browser/index.css`,
  `extension/dist/extension-page.css`, `extension/dist/popup.css`); fonts copied to
  `editor/dist/browser/fonts/` and `extension/dist/fonts/` (5 woff2 + 2 OFL txt);
  `extension/dist/editor.css` copy for `index.html`.
- Unit/integration: `Test Files 76 passed (76)`, `Tests 561 passed (561)` including
  the new CLI `cli-edit.test.ts` CSS/font route assertions.
- MV3 contract: `action.default_popup === "popup.html"`, service worker, storage
  permission, optional host permissions, CSP unchanged.
- Forbidden-dep guard: MV3 JS artifacts (background/extension-page/popup) remain free
  of `new Function`/`eval`/`node:`/`process.`/`Buffer`/`ajv`/`@rogatio/` runtime refs.
- Browser E2E: `19 passed (3 skipped)` — all existing editor/extension/real-extension
  tests plus the new design-system suite (dark theme, top nav, served CSS/fonts, shell
  tabs + project cards, popup Rogatio card).
- Visual check: screenshots of the editor and extension dashboard captured and
  inspected via OCR + computed styles (editor `#161b22`, page `#121417` + dot grid,
  sticky top rail, neutral buttons).

## Review findings (Stage 9, round 1)

Fresh-context self-review of the full diff:

- **Regression (fixed):** the extension shell rewrite dropped the popup deep-link
  `editor.navigateToGroup(deepLinkGroup)` call; restored in
  `extension-page-entry.ts`. Re-ran canonical validation — green.
- No missing requirements, security/privacy, or other regressions found.
- 6 Biome `!important` warnings in reduced-motion blocks mirror the pre-existing
  editor CSS pattern and are intentional (override hover transitions).
- Design-system test coverage is additive; the real-extension E2E still drives the
  full lifecycle (import, permissions, group toggle, Workspace editor mount).

## Known limitations

- The dot-grid background is applied at the host-page level (CLI editor page, extension
  `html/body`, fixture) and in the shell/popup stylesheets; the editor stylesheet
  itself styles only the `.rogatio-editor` window.
- Fonts are bundled offline (OFL); text may fall back to system-ui until the woff2
  load, which is instant from the same origin.
- The extension Dashboard cards show truthful persisted counts (groups/rules/enabled)
  and the project id; the design mock's "Last Modified" timestamp is not persisted by
  the storage envelope, so it is intentionally not faked.
- No accounts/avatar/History/Settings/Support or Mocks/Headers/Terminal nav — those
  are explicit non-goals with no backing feature (confirmed in the review packet).