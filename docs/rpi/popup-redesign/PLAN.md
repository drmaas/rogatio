# Popup Redesign — Plan

## Implementation strategy

Code first — the changes are primarily CSS and DOM structure in a framework-free popup with no testable logic beyond what the model already covers. Unit tests for new model methods will be added alongside.

## Goal

Redesign the Chrome extension popup to show group-level rows (with expandable rule details) instead of a flat rule list, add a project picker, increase dimensions to eliminate scroll, and bump font sizes — all while preserving existing toggle, create, import, and navigation behavior.

## Non-goals

- Does not change the service worker message protocol or `PopupEnvelope` wire format.
- Does not add new Chrome permissions or storage APIs.
- Does not change the management page (`index.html`) or editor.
- Does not add animations, transitions, or visual effects beyond what already exists.
- Does not restructure the model layer beyond adding a `groups()` accessor (the existing `rows()` flattening is preserved for any consumers).
- Does not change the build pipeline, manifest, or package structure.

## Architecture

### Dimensions and font

- Popup width: 420px → 600px. Stays within Chrome's 800×600 limit with `0.5rem` margin on each side.
- `max-height` on the group list: 25rem → 30rem (~480px) to use more vertical space without hitting Chrome's cap.
- Body font: 0.95rem → 1.05rem. Monospace (rule/group text): 0.8rem → 0.85rem. Group label: 0.72rem → 0.78rem. Status: 0.75rem → 0.8rem.

### Group-level display

The `PopupModel` already has `activeProject.data.groups` with `{ id, name, rules[] }`. The plan adds a `groups()` method that returns `PopupGroupRow[]` (group id, name, enabled, status, rules count). The render function switches from `rows()` to `groups()` for the main list, and uses `rows()` filtered by groupId inside expander details.

### Expander

Use native `<details>/<summary>` for each group row. Summary shows: group name, status badge, toggle checkbox, edit link. Details body shows the individual rules within that group (rule name, status). This is zero-JavaScript for open/close state, accessible by default, and keyboard-navigable.

### Project picker

Replace the static "Active project: X" text with a `<select>` dropdown listing all projects from `envelope.projects`. The picker is display-only — it shows the active project and available projects. There is no `set-active-project` command in the current codebase; project switching is out of scope (would be a separate feature). The `<select>` is non-functional for now but establishes the UI for future switching.

### Files changed

| File | Change |
|------|--------|
| `packages/extension/src/popup.css` | Widen to 600px, bump fonts, adjust list max-height, add `<details>`/`<summary>` styles, add `<select>` picker styles |
| `packages/extension/src/popup.ts` | Switch render from `rows()` to `groups()`, add expander DOM, add project picker `<select>`, filter rules inside details |
| `packages/extension/src/popup-model.ts` | Add `PopupGroupRow` interface, add `groups()` method, add `projects` accessor for picker |
| `packages/extension/test/popup-model.test.ts` | Add tests for `groups()` and `projects` accessor |

### Public API / wire format changes

None. The `PopupModel` interface gains `groups()` and `projects` — these are additive, not breaking. The `set-group-enabled` message format is unchanged. No new commands are introduced.

## Phases

### Phase 1: Model layer — add `groups()` and `projects` accessor

Add `PopupGroupRow` type and `groups()` method to `PopupModel` that returns group-level rows with enabled/status. Add `projects` accessor returning `{ id, name }[]` for the picker. Write unit tests first (TDD).

**Checklist range:** CHECKLIST.md Phase 1 (tasks 1.1–1.4)

### Phase 2: CSS — dimensions, fonts, and new component styles

Widen popup to 600px, bump all font sizes, increase list max-height. Add styles for `<details>/<summary>` group expanders and the project picker `<select>`. Preserve forced-colors and reduced-motion queries.

**Checklist range:** CHECKLIST.md Phase 2 (tasks 2.1–2.5)

### Phase 3: Render restructure — group-level rows with expanders

Rewrite `render()` in `popup.ts` to iterate `groups()` instead of `rows()`. Each group is a `<li>` with `<details>/<summary>` containing name, status, toggle, edit link. Rules appear inside `<details>` body. Add project picker `<select>` to header.

**Checklist range:** CHECKLIST.md Phase 3 (tasks 3.1–3.6)

### Phase 4: Verify and review

Run `pnpm validate` (format, lint, typecheck, tests). Fix any mechanical failures. Self-review the diff for scope creep, missing acceptance criteria, or over-engineering.

**Checklist range:** CHECKLIST.md Phase 4 (tasks 4.1–4.3)

## Risks

- **Chrome popup height limit (600px):** With 600px width and 30rem max-height, we stay within bounds. If many groups with many rules are expanded, the popup will scroll internally — this is acceptable and matches current behavior.
- **No project switching command:** The user asked for a "project picker to show the current project selected." This is display-only. If switching is later requested, it requires a new service worker command — flagged as out of scope.
- **`<details>` open/close state is not persisted across popup reopen:** Chrome destroys and recreates the popup DOM each time it opens. All expanders start collapsed. This is acceptable; no persistence needed.
- **Group status aggregation already works:** `aggregateGroupStatus` handles enabled/disabled and rule-level status precedence. No changes needed to this logic.
- **Forced-colors mode:** New `<details>`, `<summary>`, and `<select>` elements need explicit forced-colors overrides. Must be tested.
- **No DOM tests exist:** The popup has no Playwright or jsdom tests. The render restructure is verified by visual inspection and `pnpm validate`. Adding DOM tests is explicitly out of scope (not requested).

## Acceptance criteria

1. Popup width is 600px; no horizontal scrollbar appears.
2. Popup height uses up to ~500px of vertical space; no vertical scrollbar on the outer popup (internal group list may scroll).
3. Body font size is 1.05rem; monospace font for rule/group text is 0.85rem.
4. The main list shows one row per group (not per rule). Each row displays group name, aggregated status, enable/disable toggle, and edit link.
5. Each group row has an expander (`<details>`) that shows the rules within that group when opened.
6. A project picker (dropdown or label) in the header shows the active project name and lists available projects.
7. Existing toggle, create project, import project, and "Open app" link behaviors are preserved.
8. `pnpm validate` passes (format, lint, typecheck, tests).
9. Forced-colors and reduced-motion media queries are maintained for new elements.
10. Empty groups (no rules) display "No rules" inside the expander body.
11. When no active project is selected, the group list shows "No active project" and the picker is disabled.
12. The `ruleCount` field is available on `PopupGroupRow` for future use but not displayed in the UI.
