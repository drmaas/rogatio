# Popup Redesign — Checklist

- [x] Phase 1: Model layer — add `groups()` and `projects` accessor
  - [x] 1.1 Add `PopupGroupRow` interface to `popup-model.ts` (`{ id, name, enabled, status, ruleCount }`)
  - [x] 1.2 Implement `groups()` method on `PopupModel` that returns `PopupGroupRow[]` from `activeProject.data.groups`
  - [x] 1.3 Add `projects` accessor returning `readonly { id: string; name: string | null }[]` for the picker
  - [x] 1.4 Write unit tests: `groups()` returns correct enabled/status per group, empty when no project; `projects` returns all project entries

- [x] Phase 2: CSS — dimensions, fonts, and new component styles
  - [x] 2.1 Change `html, body` width from `420px` to `600px`
  - [x] 2.2 Bump body font-size from `0.95rem` to `1.05rem`
  - [x] 2.3 Bump monospace font sizes: rule name `0.8rem` → `0.85rem`, group label `0.72rem` → `0.78rem`, status `0.75rem` → `0.8rem`
  - [x] 2.4 Increase `ul` max-height from `25rem` to `30rem`
  - [x] 2.5 Add styles for `<details>/<summary>` group expanders and `<select>` project picker; add forced-colors overrides for new elements

- [x] Phase 3: Render restructure — group-level rows with expanders
  - [x] 3.1 Add project picker `<select>` to header, populated from `model.projects`, displaying active project
  - [x] 3.2 Replace flat `rows()` loop with `groups()` loop in `render()`
  - [x] 3.3 Each group `<li>` contains `<details>/<summary>` with group name, status badge, toggle, edit link
  - [x] 3.4 Rules within a group render inside `<details>` body as a sub-list (rule name + status); empty groups show "No rules"
  - [x] 3.5 Toggle checkbox sends `set-group-enabled` for the group (preserves existing behavior)
  - [x] 3.6 Preserve create form, import, status line, and "Open app" link behavior unchanged

- [x] Phase 4: Verify and review
  - [x] 4.1 Run `pnpm validate` — fix any format/lint/typecheck/test failures
  - [x] 4.2 Self-review diff for scope creep, over-engineering, missing acceptance criteria
  - [x] 4.3 Verify forced-colors and reduced-motion queries cover new elements
