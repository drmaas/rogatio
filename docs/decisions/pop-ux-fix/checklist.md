# Popup UX Fix — Checklist

Strategy: **TDD** (see `plan.md` → Implementation strategy). Write failing tests before production edits in each phase.

## Phase 1: Toolbar regroup + picker visibility

**Acceptance:** Picker only when `projects.length >= 2`; single action row New | Import | Open app; picker row above when visible; token-consistent density; create/import still work; 0/1 fixtures prove post-create/import absence without mock mutation.

**Proving tests:** `test/browser/design-system.spec.ts` (toolbar + 0/1/≥2 picker cases).

- [x] 1.1 Update browser test: two-project fixture still expects `[data-project-picker]` visible; assert Open app lives under `[data-project-actions]` with New and Import
- [x] 1.2 Add browser fixture/case: zero projects → picker absent; New / Import / Open app present
- [x] 1.3 Add browser fixture/case: one project → picker absent; actions present (stand-in for post-create single-project state)
- [x] 1.4 Regroup DOM in `popup.ts`: move Open app into `[data-project-actions]`; keep header as brand (+ optional picker)
- [x] 1.5 Gate picker render on `current.projects.length >= 2` (do not append empty/disabled select)
- [x] 1.6 Restyle toolbar in `popup.css` to one compact action row; picker full-width row above when present; reuse `--rogatio-*` (no new tokens)
- [x] 1.7 Confirm create-form / status / import-input lifecycle and module UI state still work after regroup
- [x] 1.8 Run affected browser tests; fix until green

## Phase 2: Group card subtitle + expand chevron

**Acceptance:** Muted `[data-active-project]` subtitle under group name; visible CSS chevron; groups collapsed by default; toggle/checkbox behavior preserved; no subtitle on empty-state rows.

**Proving tests:** `test/browser/design-system.spec.ts` (subtitle + chevron + default collapsed).

- [ ] 2.1 Update browser test: group card shows active project name (fixture “Project A”) via `[data-active-project]` under group name
- [ ] 2.2 Update browser test: expand affordance visible (CSS marker/chevron); `details[data-group]` not open on first paint; click summary reveals rules
- [ ] 2.3 In `popup.ts`, append muted `[data-active-project]` subtitle under group name using `activeProjectName` with id fallback; omit when both null
- [ ] 2.4 In `popup.css`, add chevron/marker for `summary` / `details[open]` (CSS-only; no DOM chevron node unless CSS proof fails); keep list-style overrides coherent
- [ ] 2.5 Extend forced-colors / prefers-reduced-motion rules for the chevron
- [ ] 2.6 Verify checkbox `stopPropagation` still prevents accidental details toggle
- [ ] 2.7 Run affected browser tests; fix until green

## Phase 3: Wire picker to `switch-project`

**Acceptance:** Enabled picker sends `switch-project`, refresh updates groups/subtitle/selected value; Open app href remains management page (storage-backed); no new switch-failure status UX.

**Proving tests:** `packages/extension/test/popup-model.test.ts`; `test/browser/design-system.spec.ts` (select switch).

- [ ] 3.1 Write failing unit test: `PopupModel.switchProject(projectId)` send shape `{ version: 1, command: "switch-project", projectId }` and ok/false — **public API change on `PopupModel`**
- [ ] 3.2 Implement `switchProject` returning `response?.ok === true` (same pattern as `createProject`)
- [ ] 3.3 Write failing browser test: select `project-b` → empty groups / subtitle “Project B” / selected value `project-b`; select `project-a` → restore
- [ ] 3.4 Enable picker when rendered; on `change`, `await switchProject` then `await refresh()` (sequential, like toggle)
- [ ] 3.5 Browser test: `[data-open-app]` href is management page (`index.html`); no management-page deep-link edits
- [ ] 3.6 Confirm SW / protocol untouched unless a real blocker (prefer none)
- [ ] 3.7 Run unit + browser tests for this surface; `pnpm validate` before phase done
