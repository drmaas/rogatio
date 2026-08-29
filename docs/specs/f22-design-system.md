# F22 — Design System for the Shared Editor and Browser Extension

## 1. Problem statement and goals

The shared CLI editor (`rogatio edit`), the Chrome extension management page, and the
toolbar popup render with default browser styling or the original light theme, with
the editor's styles embedded as a string in its controller. The user approved a dark
design system (palette, typography, dot-grid background, rounded surface cards, top
navigation) and asked for standalone CSS so the styling is modular and scalable.

Goals:

- Restyle every user-visible surface — shared editor, CLI editor host, extension
  management page, toolbar popup — with the approved design system.
- Move the editor's navigation from the left rail to the top of the layout.
- Convert the extension management page into a design-system shell: top app bar,
  workspace sidebar, and a project-cards home (Overview), with the editor kept as the
  Workspace view.
- Deliver all styling as standalone CSS artifacts (esbuild outputs) shipped inside
  the existing distributions; bundle the two OFL fonts offline.
- Preserve every behavior, accessibility contract, `data-*` attribute, role, label,
  and command name that existing tests and users depend on.

## 2. Scope and explicit non-goals

In scope:

- `packages/editor/src/editor.css` — new standalone editor stylesheet; removal of the
  embedded `EDITOR_CSS` string and `<style>` injection from `editor.ts`.
- Editor layout: desktop route rail becomes a top navigation bar; mobile select
  navigation unchanged.
- `packages/extension/src/extension.css` + shell rework in `extension-page-entry.ts`
  (top bar, sidebar, project-cards Overview) and `packages/extension/src/popup.css`
  + popup restyle on the design-system card.
- Build/CI pipeline: esbuild CSS outputs recorded in `build-manifest.json`, font
  copies, MIME types in `scripts/serve-smoke.ts`, `scripts/validate.ts` artifact
  checks, CLI `/vendor/editor.css` + `/vendor/fonts/*` routes, host HTML `<link>`
  updates, test fixture stylesheet link.
- Tests: new design-system browser coverage; updates to tests only where the
  approved layout truthfully changed.
- Docs: `docs/architecture.md`, `README.md`, workflow log, f21 spec/plan brand-text
  sync.

Non-goals:

- No new product features or views: no History tab, no Settings/Support pages, no
  accounts/avatar, no Mocks/Headers/Terminal nav destinations (no backing feature;
  mocks and headers are rule types inside rule cards, not navigation destinations).
- No changes to editor public API (`EditorOptions`, `EditorController`, rule-type
  extension contract), validation, save, search, CRUD, reorder, dry-run, permission,
  runtime, or popup messaging behavior.
- No framework, new runtime dependency, network access, telemetry, storage, or CSP
  change.
- No JavaScript behavior changes driven by styling (styling is class/attribute
  additive; removal of the injected `<style>` element is the only structural change).

## 3. Actors, entry points, and supported environments

- CLI users opening `rogatio edit <file>` — editor page served by the local server.
- Extension users opening the management page (`index.html`) and the toolbar popup.
- Developers running `node scripts/validate.ts` and browser tests.
- Supported: current editor/extension environments (Chrome MV3, Node 24 CLI,
  `pnpm validate`), unchanged.

## 4. Design tokens (authoritative)

Custom properties defined once per stylesheet root:

| Token | Value | Usage |
| --- | --- | --- |
| `--rogatio-bg` | `#121417` | Page background with dot grid |
| `--rogatio-surface` | `#161B22` | Cards, containers, editor window |
| `--rogatio-surface-raised` | `#1C222C` | Hover, active controls |
| `--rogatio-surface-inset` | `#10131A` | Inset stats/console boxes |
| `--rogatio-primary` | `#007AFF` | Accent, links, active states, focus |
| `--rogatio-primary-strong` | `#0066D6` | Filled button background (AA with white text) |
| `--rogatio-secondary` | `#64748B` | Secondary accents, faint text |
| `--rogatio-tertiary` | `#0F172A` | Deep sidebar/nav surfaces |
| `--rogatio-neutral` | `#1E293B` | Rail/secondary button surfaces |
| `--rogatio-text` | `#F8FAFC` | Primary text |
| `--rogatio-muted` | `#94A3B8` | Secondary text |
| `--rogatio-faint` | `#64748B` | Tertiary text, placeholders |
| `--rogatio-border` | `rgba(148, 163, 184, 0.16)` | Hairline borders |
| `--rogatio-danger` | `#F87171` | Errors, remove actions |
| `--rogatio-danger-bg` | `rgba(248, 113, 113, 0.12)` | Danger tinted surfaces |
| `--rogatio-success` | `#4ADE80` | Active/matched states |
| `--rogatio-warning` | `#FBBF24` | Attention states |
| `--rogatio-radius` | `0.75rem` | Card radius (controls 0.5rem, pills full) |

Type: `--rogatio-font-display`/`--rogatio-font-body` = `"Hanken Grotesk", system-ui,
-apple-system, "Segoe UI", sans-serif`; `--rogatio-font-mono` = `"JetBrains Mono",
ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`.

Dot grid: `background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px,
transparent 1px); background-size: 24px 24px;` on host page bodies.

## 5. Functional requirements

### F22-REQ-001 — Tokens and fonts

- `F22-REQ-001a` Each stylesheet defines the token set above on its root selector.
- `F22-REQ-001b` Hanken Grotesk (400/500/700) and JetBrains Mono (400/700) woff2 are
  bundled under `packages/editor/assets/fonts/` with OFL license texts; `@font-face`
  rules reference relative `fonts/` paths.
- `F22-REQ-001c` No font or asset is fetched over the network at runtime; every
  stylesheet and font loads from the host's own origin.

### F22-REQ-002 — Standalone editor stylesheet

- `F22-REQ-002a` `packages/editor/src/editor.css` contains all editor styles with
  the existing `.rogatio-editor` scoping and every existing selector
  (`data-*`, state classes); `EDITOR_CSS` is deleted from `editor.ts` and the
  constructor no longer appends a `<style>` element.
- `F22-REQ-002b` The editor build emits `packages/editor/dist/browser/index.css`;
  the build manifest and `scripts/validate.ts` record and assert it.
- `F22-REQ-002c` Hosts that mount the editor link the stylesheet: the CLI editor
  page (`/vendor/editor.css`), extension `index.html` (`index.css`), and the browser
  fixture (`/editor/index.css`). The host-supplied stylesheet requirement is
  documented in `docs/architecture.md`.

### F22-REQ-003 — Editor layout: navigation at the top

- `F22-REQ-003a` `[data-editor-layout]` stacks the navigation above the main content
  (grid rows).
- `F22-REQ-003b` `[data-desktop-route-rail]` renders as a sticky horizontal top bar
  with the active route visually accented (pill/underline); route order and
  accessible names (`Project`, group names, `Test rules`) are unchanged.
- `F22-REQ-003c` At `max-width: 48rem` the desktop top bar is hidden and the existing
  `[data-mobile-route-nav]` select remains the navigation (unchanged behavior).

### F22-REQ-004 — Editor components

- `F22-REQ-004a` Fieldsets, rule cards, and test-result cards render as surface
  cards (background, border, radius); matched/unmatched/na badges are mono pills in
  success/danger/neutral tints.
- `F22-REQ-004b` Button variants: Save = primary filled (`--rogatio-primary-strong`),
  Validate = secondary (neutral surface), Cancel/destructive = outlined/danger,
  icon buttons = ghost; disabled/loading states remain visibly distinct.
- `F22-REQ-004c` Error summary, `aria-invalid` fields, helper text, search input
  (with icon), status line, and confirmation dialog follow the token system with
  unchanged roles/labels.
- `F22-REQ-004d` Focus-visible uses the primary accent; forced-colors mode maps
  tokens to `CanvasText`/`Canvas`/`Highlight`/`Mark`/`ButtonText`/`ButtonFace`;
  reduced-motion disables transitions; layout reflows without horizontal overflow at
  `max-width: 48rem` and 200% zoom.

### F22-REQ-005 — Extension page shell

- `F22-REQ-005a` `packages/extension/src/extension.css` (→ `dist/extension-page.css`)
  styles the management page: dark page background with dot grid, top app bar
  (brand heading `Rogatio` — the existing `#rogatio-title` `h1` — plus Dashboard /
  Workspace tabs and Refresh/Export/Remove actions and the badge pill), workspace
  sidebar (active-project card, switch/create/import controls, runtime commands and
  states, group activation switches, permissions summary).
- `F22-REQ-005b` The Overview renders a responsive project-card grid: one card per
  stored project with a status line (active project = primary dot "Active Runtime";
  others = neutral "Idle"), truthful stats (rules count, groups count, enabled groups
  count), the project id, and Export/Remove actions; a dashed "Create New Project"
  card runs the existing create flow. Card selection updates `pendingProjectId` and
  the existing "Selected …" announcement without switching (the explicit-switch
  invariant is preserved); the `Project to switch` select remains functional and
  synchronized.
- `F22-REQ-005c` Tabs switch between the Overview (cards) and Workspace (editor with
  the reorganized shell); no other routes exist.
- `F22-REQ-005d` Every existing `data-*` attribute, role, label, and command name is
  preserved: `projectSelector`, command buttons (`switch`, `create`, `import`,
  `review-permissions`, `grant-permissions`, `start-native-runtime`,
  `stop-native-runtime`, `check-mock-runtime`, `refresh`, `export`, `remove`),
  `importInput`, `permissionSummary`, `groupToggle`/`groupId` checkboxes,
  `badgeState`, `nativeRuntimeState`, `mockRuntimeState`, `ruleStatuses`,
  `editorRoot`, and the `#rogatio-title` heading with text `Rogatio`.

### F22-REQ-006 — Popup

- `F22-REQ-006a` `packages/extension/src/popup.css` (→ `dist/popup.css`) styles the
  popup as a dark card: brand "Rogatio", active-project line, group rows with mono
  names, rule counts, status pills, switch-styled toggles, pencil and "Open app"
  controls.
- `F22-REQ-006b` The popup header text and `popup.html` title read "Rogatio".

### F22-REQ-007 — CLI editor host

- `F22-REQ-007a` `generateEditorHtml` links `/vendor/editor.css`.
- `F22-REQ-007b` The edit server serves `GET /vendor/editor.css`
  (`text/css; charset=utf-8`) and `GET /vendor/fonts/<file>` (confined to the editor
  font directory, `font/woff2`), reading from the editor package's built assets,
  alongside the existing `/vendor/editor.js`.

### F22-REQ-008 — Build and validation pipeline

- `F22-REQ-008a` `scripts/build.ts` emits `index.css`, `extension-page.css`,
  `popup.css` as esbuild outputs, records them in `build-manifest.json`, and copies
  the bundled fonts into `packages/editor/dist/browser/fonts/` and
  `packages/extension/dist/fonts/`.
- `F22-REQ-008b` `scripts/serve-smoke.ts` serves `.css` as `text/css` and `.woff2`
  as `font/woff2`.
- `F22-REQ-008c` `scripts/validate.ts` asserts the three CSS artifacts and the font
  files; the MV3 forbidden-dependency guard keeps scanning JS artifacts only; the
  editor browser artifact remains free of Node globals and forbidden imports.

### F22-REQ-009 — Accessibility, security, privacy, performance

- `F22-REQ-009a` Accessibility: forced-colors, reduced-motion, keyboard
  completeness, visible focus, and 200% zoom/narrow reflow requirements from the
  editor architecture remain satisfied on every restyled surface; filled buttons use
  `--rogatio-primary-strong` so white button text meets WCAG AA; muted text on
  surfaces keeps ≥ 4.5:1.
- `F22-REQ-009b` Security/privacy: no new network, storage, telemetry, or
  permissions; MV3 CSP unchanged; fonts are static local assets; the popup and shell
  keep their existing data boundaries.
- `F22-REQ-009c` Performance: the dot grid is a single `radial-gradient`; no layout
  thrash, no runtime CSS generation, no animation beyond brief hover transitions
  (reduced-motion respected).

### F22-REQ-010 — Documentation

- `F22-REQ-010a` `docs/architecture.md` gains the design-system section (prepared at
  Stage 2) and stays synchronized with the implementation.
- `F22-REQ-010b` `README.md` notes the design system and bundled fonts.
- `F22-REQ-010c` The f21 popup spec/plan documents use "Rogatio".

## 6. Acceptance criteria

- `F22-AC-001` In the editor fixture, computed styles use the dark system: the
  editor window background is `#161B22` (or darker surface), the page body background
  is `#121417` with a `radial-gradient` dot grid, and the font stack resolves through
  the bundled faces.
- `F22-AC-002` The rail's bounding box is above the main content's (navigation at
  the top); at `360×800` the desktop top bar is hidden and the mobile select is
  visible and navigates.
- `F22-AC-003` `/editor/index.css`, `/extension/extension-page.css`,
  `/extension/popup.css`, and the font files are served `200` with `text/css` /
  `font/woff2` by the test server; `build-manifest.json` contains the three CSS
  artifacts; `node scripts/validate.ts` passes end to end.
- `F22-AC-004` The CLI editor HTML contains the `/vendor/editor.css` link; the edit
  server answers `GET /vendor/editor.css` with `text/css` and a bundled font with
  `font/woff2` (integration test).
- `F22-AC-005` The extension page renders the top bar, sidebar, and Overview cards;
  the existing browser test for the explicit-switch flow still passes unmodified;
  Overview cards show truthful per-project counts and Export/Remove work; the
  dashed Create card opens the create flow.
- `F22-AC-006` The popup page (loaded with the test chrome mock) shows the "Rogatio"
  header, group rows with switches, and the "Open app" control; `popup.html` links
  `popup.css`.
- `F22-AC-007` The existing forced-colors / reduced-motion / 200% zoom / keyboard
  browser tests remain green; new assertions cover dark computed styles and the top
  navigation layout.
- `F22-AC-008` No editor or MV3 JS artifact contains new forbidden patterns (`node:`,
  `process.`, `Buffer`, `eval`, `new Function`, `@rogatio/` runtime imports in MV3);
  no new runtime dependency is added.
- `F22-AC-009` Documentation (architecture, README, workflow log, f21 sync) matches
  the implemented state.

## 7. API, CLI, UI, and file-format changes

- No public API or file-format changes. CLI internal additions: `/vendor/editor.css`
  and `/vendor/fonts/*` routes; `editor.html` gains a stylesheet link. UI changes are
  presentational plus the extension Overview cards view.

## 8. Security, privacy, performance, accessibility, and operational requirements

Covered by F22-REQ-009. Operational: the canonical validation remains
`node scripts/validate.ts`; CI runs the same command.

## 9. Migration, rollout, and backward compatibility

- The stylesheet move is a repo-internal contract: all in-repo hosts are updated in
  the same change; no versioned public contract changes. Users of the published CLI
  or extension ZIP get the new files automatically in the next release.
- Rollback: the previous release's editor bundle still embeds its own styles;
  reverting this feature restores the light theme without schema/data impact.

## 10. Open questions and assumptions

- Assumption: the bundled OFL fonts may be distributed with the packages (license
  texts included); confirmed by user (bundle fonts).
- Assumption: the extension Overview replaces the current bare shell landing while
  the editor remains the Workspace view (user chose "Restyle + Shell rework").
- Assumption: "History" and other mock-design nav destinations are non-goals because
  no backing feature exists (confirmed in review packet).