# Popup UX Fix — Research

## Problem restatement

popup is a bit off. dont show project picker dropdown if no projects. also need show project name in card that lists groups, and arrow to show if group is expanded or not. also improve layout, style, and group of new project, import, dropdown, and open app buttons. use frontend design skills to make ux beautiful and consistent with full page app

Canonical screenshot: `docs/decisions/pop-ux-fix/popup-screenshot.jpg`.

## Codebase findings

### Surface and entry

- `packages/extension/public/popup.html` (L1–L13): shell only — loads `popup.css`, mounts `#rogatio-popup-root`, runs `popup.js`.
- `packages/extension/src/popup.ts` `render()` (L199–L328): sole DOM builder for the toolbar popup. Root class `.rogatio-popup` set on `#rogatio-popup-root` (L6).
- `packages/extension/src/popup-model.ts` `createPopupModel(options: PopupModelOptions): PopupModel` (L120–L225): pure view-model over the `get-state` envelope; no DOM. Public surface: `PopupModel` / `PopupModelOptions` / `PopupGroupRow` / `PopupRuleRow` (L40–L118).
- Styles: `packages/extension/src/popup.css` (design-system tokens + popup layout). Management page twin: `packages/extension/src/extension.css` (same `:root` token block L41–L67).

### Current render layout (matches screenshot)

`render()` appends, in order (L323–L327):

1. **header** — `h1` "Rogatio", project `<select>`, "Open app" anchor (L204–L226)
2. **`[data-project-actions]`** — "New project" | "Import project" side-by-side (L228–L248)
3. optional inline create form / status line (`createForm()` L89–L133; `statusLine()` L135–L141)
4. **`[data-group-list]`** — group `<details>` cards (L250–L321)
5. hidden import file input (`importField()` L144–L154)

CSS stacks header children in a single column (`.rogatio-popup header { display: grid; gap: 0.2rem }` at `popup.css` L100–L103). Open app uses the pill button styles (`a[data-open-app]` L223–L233) and stretches to the header grid track (no explicit `width: 100%`). Action buttons use `flex: 1 1 0` (`popup.css` L119–L135).

### 1. Project picker always shown

In `popup.ts` L208–L218 the picker is **always** created, populated from `current.projects`, and appended to the header (L226) with **no** length guard:

```ts
picker.disabled = true;
```

Empty `projects` → empty `<select>` still in the DOM. Model already returns `projects: []` when the envelope has none (`popup-model.ts` L186–L189; covered by `popup-model.test.ts` L299–L305).

Browser fixture always seeds two projects (`test/browser/design-system.spec.ts` L37–L78), and the design-system popup test asserts picker visibility unconditionally (`design-system.spec.ts` L295). A zero-project hide will need that assertion scoped or paired with an empty-state case. After a successful create/import from empty state, `refresh()` → `render()` must show the picker again once `projects.length > 0`.

### 2. Project name missing on group cards

Group summary DOM (`popup.ts` L266–L296) appends only: group name span, status span, enable checkbox, "Edit group" link. **No** project name node.

`PopupModel.activeProjectName` already exists (`popup-model.ts` L99, L132–L135; tested L110, L119) but `render()` never reads it. CSS still styles unused `[data-active-project]` (`popup.css` L110–L114) from an older header subtitle pattern — reusable for a muted project label on the card if desired.

`PopupGroupRow` (`popup-model.ts` L48–L54) has `id`, `name`, `enabled`, `status`, `ruleCount` — no project fields; project identity lives only at model root / `projects[]`. No envelope or model API change required to show the name. When `activeProjectName` is `null`, card label should fall back the same way the picker does (`project.id` at `popup.ts` L214) — use `activeProjectId` or look up `projects[]`.

### 3. Expand/collapse arrow absent

Groups use native `<details data-group>` / `<summary>` (`popup.ts` L263–L320). Expand/collapse works, but disclosure chrome is intentionally removed:

- `summary { list-style: none }` — `popup.css` L242–L248
- `summary::-webkit-details-marker { display: none }` — L250–L252
- `summary::marker { content: "" }` — L253–L255

No custom chevron/arrow CSS or element replaces the marker. Screenshot matches: flat summary row with no expand affordance. Prefer CSS affordance on `summary` / `details[open]` (or restore the native marker) rather than a second JS expand model. Any new chevron must stay in forced-colors / reduced-motion coverage (`popup.css` L291–L327).

Default open state: `<details>` created without `open` attribute → collapsed until user clicks summary. Nested rules list shows "No rules" when empty (`popup.ts` L300–L303).

### 4. Toolbar controls: layout vs full-page language

| Control | Popup today | Full-page analogue |
| --- | --- | --- |
| Brand | `h1` Rogatio in header | `.rogatio-topbar h1` (`extension.css` L151–L156) |
| Project switch UI | Disabled full-width `<select data-project-picker>` in header | Dashboard `[data-project-selector]` + "Switch project" in `.rogatio-dashboard-section-actions` (`extension-page-entry.ts` L682–L698; `extension.css` L409–L422) |
| Open app | Pill under picker (grid-stretched) | N/A (already on management page) |
| New / Import | Equal flex buttons in `[data-project-actions]` | Compact density of section-actions / neutral buttons — **not** the large Dashboard create tiles (`.rogatio-create-project` min-height 7.5rem) |

Shared visual system (do not invent a new brand): identical `--rogatio-*` tokens and dotted radial background (`popup.css` L40–L84; `extension.css` L41–L83). Popup group cards use inset surface + border (`popup.css` L237–L241); management project cards use raised surface (`extension.css` L431–L447). Buttons share neutral fill + border hover pattern. Consistency target = token parity + control grouping density, not copying Dashboard creation-grid chrome into the 600px popup.

Picker is **display-only**: `disabled = true` (`popup.ts` L218); no `change` handler; no `switch-project` send from popup. Service worker **does** implement `switch-project` (`service-worker.ts` L457–L477). Frozen plan `docs/plans/popup-redesign.md` (Project picker section) scoped the select as non-functional UI and claimed no switch command existed — that "no command" claim is stale; SW has the command today. This problem statement asks to regroup/restyle the toolbar, not necessarily wire switching.

### Model / lifecycle to preserve

- Toggle: `PopupModel.toggle` → `set-group-enabled` (`popup-model.ts` L190–L198).
- Create / import: `createProject` / `importProject` (`popup-model.ts` L200–L216); UI form + file picker in `popup.ts` L156–L197, L228–L248. Status strings on success/failure: "Project created." / "The project could not be created." / import equivalents / invalid JSON (`popup.ts` L160–L195).
- Nav: `openAppUrl()` → `index.html` (`MANAGEMENT_PAGE`); `groupUrl(id)` → `index.html?group=…` (`popup-model.ts` L66, L88–L90, L218–L223).
- Empty list copy: "No active project" / "This project has no saved groups." (`popup.ts` L253–L260).
- Module UI state across re-renders: `createFormOpen`, `createDraft`, `statusMessage` (`popup.ts` L39–L43) — preserve when regrouping DOM.

### Edge cases already in code

- No active project: `groups()` / `rows()` return `[]` (`popup-model.ts` L137, L167); UI shows "No active project" list item.
- Project name null: picker falls back to `project.id` (`popup.ts` L214); `activeProjectName` is `null`.
- Zero projects: picker still rendered (empty); actions still available so user can create/import.
- Checkbox `change` uses `stopPropagation` so toggling does not toggle `<details>` (`popup.ts` L283–L286).
- Create form: `window.prompt` unavailable in action popups — inline form required (`popup.ts` L87–L88).
- `refresh()` silent-fails when `get-state` is not ok or has no value (`popup.ts` L330–L332) — no status line in that path; do not change unless product asks.
- Width: `html,body { width: 600px }` (`popup.css` L73); architecture text still says F25 "420px" (`docs/architecture.md` L102) — CSS is source of truth after redesign.

### Tests that touch this surface

- Unit: `packages/extension/test/popup-model.test.ts` — groups, projects, create/import, `activeProjectName`; no DOM assertions. Model changes unlikely for this UX pass.
- Browser: `test/browser/design-system.spec.ts` "popup renders the dark Rogatio card" (L280–L331) — heading, **picker visible**, group "One", open app, create/import flows, width > 400. Plan must update picker assertion and add coverage for: picker absent when zero projects, project name on group card, visible expand affordance.

## External findings

Not greenfield. Skip. Consistency target is the existing Rogatio extension management page (`extension.css` / `extension-page-entry.ts`), not an external design system.

## Constraints and invariants

- Stay inside `packages/extension` popup surface (`popup.ts` / `popup.css` / browser tests). Prefer DOM + CSS only; `popup-model.ts` already exposes what render needs. Do not invent a new palette, type stack, or brand mark — reuse shared `--rogatio-*` tokens.
- Preserve create, import, group toggle, Open app, and Edit group behaviors and command shapes (`create-project`, `import-project`, `set-group-enabled`, management URLs).
- Chrome action popup cap ~800×600; list already scrolls at `max-height: 30rem` (`popup.css` L189–L192).
- Keep forced-colors and prefers-reduced-motion coverage (`popup.css` L291–L327).
- Hide picker when `projects.length === 0` (problem statement); when projects exist, picker remains part of the regrouped toolbar.
- `<details>`/`<summary>` already provide expand state; fix is visible affordance (restore marker or add chevron), not a second expand model unless design requires it.
- Project name on group cards can use existing `activeProjectName` (with id fallback) without envelope changes.
- Architecture: popup has no editor/search/permission/runtime surfaces; no popup-only persisted nav state (`docs/architecture.md` L98–L102).

## Open questions

1. When projects exist but only one: still show the (currently disabled) picker, or hide until ≥2 projects?
2. Should this UX pass wire the picker to `switch-project`, or keep it display-only while regrouping controls?
3. Preferred project-name placement on the group card: muted subtitle under group name, prefix `Project / Group`, or small meta chip — any preference beyond "show project name"?
4. Empty zero-project toolbar: after hiding picker, should Open app / New / Import collapse into one action row mirroring Dashboard section-actions density, or stay stacked?
5. Default group expand state: leave collapsed (current), or open first group by default for discoverability of the new arrow?

## Addendum — human-gate resolutions (2026-09-14)

Resolved at research-review human gate:

1. **Picker visibility:** hide when `projects.length < 2` (0 or 1). Show only when ≥2 projects.
2. **Picker behavior:** wire to `switch-project`. Open app navigates to the active project (management URL must land on / open the active project).
3. **Project name on group card:** muted subtitle under the group name.
4. **Toolbar layout:** single action row — New project | Import project | Open app. When picker is visible (≥2), picker on its own row above that action row.
5. **Group expand default:** stay collapsed (no `open` by default).
