# Popup Redesign — Research

## Problem restatement

Get rid of horizontal and vertical scroll in the popup view (make it wider and taller). Make the font size a little bigger. Display group names (the level at which users enable/disable/edit) instead of individual rules. Add an expander to optionally see rules under a group. Add a project picker to show and switch the current project.

## Codebase findings

### Current popup structure

- **`packages/extension/public/popup.html`** — minimal shell: loads `popup.css` and `popup.js`, mounts `#rogatio-popup-root`.
- **`packages/extension/src/popup.css`** — design system: fixed `width: 420px` on `html,body`, `max-height: 25rem; overflow-y: auto` on the `<ul>` group list. Chrome clamps popups at 800×600.
- **`packages/extension/src/popup.ts`** — renders header (title, active project name, "Open app" link), project actions (New/Import), and a flat `<ul>` of **rule rows** (not groups). Each row shows rule name, group ID, status, toggle checkbox, edit link. No group-level grouping or project picker exists.
- **`packages/extension/src/popup-model.ts`** — `PopupModel.rows()` flattens all groups' rules into `PopupRuleRow[]`. `PopupProjectGroup` has `{ id, name, rules[] }`. `PopupEnvelope` has `{ projects, activeProjectId, ruleStatuses, badge }`. The model already exposes group-level data (`activeProject.data.groups`) but the UI flattens it.

### Current data model

```
PopupEnvelope
  activeProjectId: string | null
  projects: Record<string, PopupProject>
    data: { groups: PopupProjectGroup[] }
    enabledGroupIds: string[]
    name?: string
  ruleStatuses?: PopupRuleStatus[]
```

Each `PopupProjectGroup` has `id`, `name`, and `rules[]`. The model already has group-level structure — the UI just doesn't use it.

### Chrome popup constraints

- Max dimensions: 800×600 CSS pixels.
- Current width: 420px. Current max-height: 25rem (400px).
- Font: Hanken Grotesk body, JetBrains Mono for rule/group text. Base `font-size: 0.95rem`.

### Existing tests

- `packages/extension/test/popup-model.test.ts` — unit tests for `aggregateGroupStatus`, `createPopupModel`, toggle, create, import. Tests exercise the model layer (rows, toggle, create, import). No DOM-level tests.
- `packages/extension/test/popup-envelope.test.ts` — tests for envelope construction.

### Group-level behavior

- Toggle sends `set-group-enabled` per group (not per rule). The UI already toggles at group level — it just displays at rule level.
- Group status is aggregated via `aggregateGroupStatus(enabled, ruleStatuses[])`.
- Edit link uses `groupUrl(groupId)` → `index.html?group=<id>`.

## Constraints and invariants

- Chrome popup max: 800×600.
- Must preserve existing toggle behavior (group-level enable/disable).
- Must preserve existing create/import project functionality.
- Must preserve existing management page link behavior.
- Model layer (`popup-model.ts`) exposes group-level data; UI layer (`popup.ts`) needs restructuring.
- Forced-colors and reduced-motion media queries must be maintained.

## Open questions

- Exact pixel dimensions for the wider/taller popup (suggest ~600px wide, ~500px tall to stay within Chrome's 800×600 limit with padding).
- Exact font-size bump (0.95rem → 1.0rem or 1.05rem body; monospace from 0.8rem → 0.85rem).
- Project picker UI: dropdown `<select>` vs clickable current-project label that opens a list. Dropdown is simplest.
- Expander implementation: `<details>`/`<summary>` or custom toggle. `<details>` is native and accessible.
