# Popup UX Fix — Plan

## Implementation strategy

TDD

## Goal

Make the Chrome action popup match the management page’s visual language and fix the broken control grouping: hide the project picker unless there are at least two projects, show the active project name as a muted subtitle on each group card, restore a visible expand/collapse chevron on group `<details>`, regroup New project / Import project / Open app into one compact action row (picker on its own row above when visible), and wire the picker to the existing `switch-project` command so switching updates the active project before Open app lands on the management page for that project.

## Non-goals

- No new brand, palette, type stack, or design tokens beyond existing `--rogatio-*`.
- No management-page / dashboard redesign; no copying large Dashboard create tiles into the popup.
- No editor, search, permission, or runtime surfaces in the popup.
- No second JS expand/collapse model; keep native `<details>` / `<summary>` (collapsed by default).
- No envelope / protocol / service-worker command changes (`switch-project` already exists).
- No `?project=` deep-link on the management URL unless review proves storage-backed active project is insufficient (see Risks).
- No Playwright journey that opens the management page to re-prove it reads `activeProjectId` (pre-existing; out of scope).
- No popup-model fields on `PopupGroupRow` for project identity (use root `activeProjectName` / id fallback).
- No changes to create/import/toggle command shapes or success/failure status copy beyond layout.
- No new switch-failure status UX; fail closed like other model sends (`Promise<boolean>` / silent, matching `createProject` / `refresh()`).
- No architecture.md “420px” rewrite; CSS width remains source of truth.
- No shared toolbar component extraction or new helpers beyond a thin `switchProject` on `PopupModel`.

## Architecture

**Surface.** Prefer `packages/extension/src/popup.ts` + `popup.css`. Touch `popup-model.ts` only to add `switchProject(projectId: string): Promise<boolean>` that sends the existing `switch-project` message — same pattern as `createProject` / `importProject` (return `response?.ok === true`). Do not change the service worker unless a bug blocks that path (research: SW already implements `switch-project` at `service-worker.ts`).

**Picker visibility.** Render `[data-project-picker]` only when `current.projects.length >= 2`. Hide for 0 or 1 project (human-gate binding). After create/import from empty/single, `refresh()` → `render()` must keep the picker absent until a second project exists; when the count crosses to ≥2, the picker appears with the active option selected.

**Picker behavior.** Enable the select when rendered (remove `disabled = true`). On `change`, `await` model `switchProject` with the selected id, then `await refresh()` (same sequential pattern as group toggle). Do not queue concurrent switches. Browser mock in `design-system.spec.ts` already handles `switch-project` by mutating `activeProjectId`; after refresh, group list / subtitle / selected option must track that id.

**Open app → active project.** Keep `openAppUrl()` → `index.html` (`MANAGEMENT_PAGE`). The management page already loads `activeProjectId` from `get-state` / storage, so after a successful switch the next Open app visit shows that project. **No management-page URL or deep-link change in this plan.** Prove in popup tests: (1) switch refreshes popup to the new active project; (2) `[data-open-app]` href stays `index.html`. Do not add a management-page Playwright assertion for this feature.

**Public API / wire-format flags.**

| Change | Kind | Notes |
| --- | --- | --- |
| `PopupModel.switchProject(projectId: string): Promise<boolean>` | **Public TS API** of `popup-model` | Pin this name; send `{ version: 1, command: "switch-project", projectId }`; return `response?.ok === true`. |
| `switch-project` message | No wire change | Already in `protocol.ts` / SW. |
| Management URL / `?project=` | **Out of scope** | Avoid unless open-app acceptance fails without it. |
| Envelope / `PopupGroupRow` | No change | Subtitle uses `activeProjectName` with id fallback. |

**Toolbar layout.**

```
header: h1 "Rogatio"
[optional] picker row          // only if projects.length >= 2
[data-project-actions]: New | Import | Open app   // single flex row
create form / status (unchanged lifecycle)
[data-group-list]
hidden import input
```

Style action controls to section-actions density using shared tokens (neutral fill, border hover, compact padding). Open app moves from header pill-under-picker into the action row; restyle as a button-like control consistent with New/Import (keep `data-open-app` for tests). Preserve module UI state across re-renders: `createFormOpen`, `createDraft`, `statusMessage`.

**Group cards.** Under the group name span, append a muted `[data-active-project]` subtitle (reuse existing CSS hook; do not invent a second attribute): `activeProjectName ?? activeProjectId`. Omit the subtitle node when both are null — the empty / “No active project” list path already covers that case; do not render fake subtitles on empty-state `<li>` rows. Add CSS chevron on `summary` / `details[open]` (prefer CSS `::before` / marker restore over a DOM chevron element). Keep forced-colors and prefers-reduced-motion coverage. Do not set `open` by default.

**Visual consistency.** Match management page via token parity and control grouping density (`extension.css` section-actions), not new chrome. Reuse existing `[data-active-project]` muted styles.

**Tests.** Update `test/browser/design-system.spec.ts` for picker hide/show, toolbar regroup, project subtitle, chevron, and switch. Add `popup-model.test.ts` coverage for `switchProject` send shape and ok/false. Prefer fixture variants (0 / 1 / ≥2 projects) over new packages. Phase ordering is tests-first per checklist.

## Phases

### Phase 1 — Toolbar regroup + picker visibility (checklist 1.x)

Regroup New / Import / Open app into one action row; place the picker on its own row above that row only when `projects.length >= 2`; restyle with existing `--rogatio-*` tokens to management-page density. Update browser tests so the default two-project fixture still expects a visible picker, and add coverage that 0- and 1-project envelopes omit the picker while actions remain usable. Post-create/import absence is proven by the 0/1 fixtures + length gate (do not expand the chrome mock to mutate projects on create unless a later phase needs it).

**Acceptance:** Binding decisions 1 and 4 hold in the rendered popup; create/import/open-app still work; no picker at `< 2` projects; ≥2 shows the picker with the active option selected.

**Proving tests:** `test/browser/design-system.spec.ts` — extend “popup renders the dark Rogatio card” (toolbar membership, picker present for seeded two projects, Open app under `[data-project-actions]`); add cases (or parameterized fixtures) for zero- and one-project envelopes asserting `[data-project-picker]` absent and `[data-project-actions]` / create / import / open-app present.

**Review note:** Phase is dense (DOM + CSS + fixtures) but one cohesive toolbar seam — keep as a single review pass; do not split unless implementation balloons.

### Phase 2 — Group card subtitle + expand chevron (checklist 2.x)

Add muted project-name subtitle under each group name; add a visible expand/collapse chevron for `<details>`/`<summary>`; leave groups collapsed by default; keep a11y media-query coverage.

**Acceptance:** Binding decisions 3 and 5 hold; checkbox still does not toggle details; Edit group / toggle unchanged; empty-state rows have no subtitle node.

**Proving tests:** `design-system.spec.ts` — assert `[data-active-project]` text on the group card (e.g. “Project A” from fixture), assert a visible CSS chevron/marker affordance (no requirement for a DOM `[data-group-chevron]` unless CSS-only proof is impractical), assert `details[data-group]` lacks `open` on first paint; expand click still reveals rules.

### Phase 3 — Wire picker to `switch-project` (checklist 3.x)

Enable the picker when shown; on change send `switch-project` via the model, refresh, and confirm group list / subtitle / selected option track the new active project. Confirm Open app href remains the management page (storage-backed active project; no new deep-link).

**Acceptance:** Binding decision 2 holds; switching between fixture projects updates popup content; Open app href remains management page; create/import/toggle untouched; failed switch does not invent new status copy.

**Proving tests (TDD order):** `popup-model.test.ts` — failing unit for `switchProject` send shape + ok/false first; then implement. `design-system.spec.ts` — failing select-`project-b` case first, then wire `change`; expect empty groups copy / subtitle “Project B”, selected value `project-b`, then select back to `project-a`; assert `[data-open-app]` href is `index.html`. Mock already supports `switch-project`.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Over-engineering: `?project=` deep-link + management-page parser** | Out of scope; storage active project already satisfies “open active project.” Flag if implementer starts editing `extension-page-entry.ts` for this. |
| **Over-engineering: toolbar component framework / shared helpers** | Keep imperative DOM in `render()`; CSS-only layout. |
| **Over-engineering: custom expand state machine / DOM chevron node** | CSS chevron on native `<details>` only. |
| **Over-engineering: new tokens or brand accents** | Reuse `--rogatio-*` only. |
| **Over-engineering: new switch-failure status UX** | Return `false` / fail closed; no new status strings. |
| **Public API: `PopupModel.switchProject`** | Explicit addition; pin name and message shape; unit-test send payload and ok/false. No wire-format change. |
| **Picker hide threshold vs stale research (“show when > 0”)** | Human gate wins: show only when `>= 2`. |
| **Browser fixture always seeds two projects** | Phase 1 must add 0/1-project init scripts; do not weaken the ≥2 assertion without replacement. |
| **Over-engineering: expand chrome mock to mutate on create/import** | Unnecessary for picker-hide proof; 0/1 seeded envelopes suffice. |
| **Open app as `<a>` inside flex action row** | Style as sibling of buttons without breaking navigation or `data-open-app` selectors. |
| **Browser mock switch only mutates `activeProjectId`** | Sufficient for Project B empty-groups fixture; do not expand mock into a full repository. |
| **Proving “Open app lands on active project”** | Popup switch + storage-backed active id is enough; do not open management page in this feature’s tests. |
| **Forced-colors / reduced-motion** | Extend chevron rules under existing media queries in `popup.css`. |

## Acceptance criteria

1. Project picker is absent when there are 0 or 1 projects; present and enabled when there are ≥2 with the active option selected. The length gate keeps the picker absent after create/import until a second project exists (proven via 0/1 fixtures, not a mock that mutates on create).
2. Changing the picker sends `switch-project` for the selected id and refreshes the popup so groups, `[data-active-project]` subtitle, and the select’s selected value match the new active project (including empty-group copy when the target has no groups).
3. Open app href remains the management page (`index.html`); after a successful switch, the stored active project is the selected one (via existing storage / `get-state`, not a new deep-link). No management-page deep-link work in this feature.
4. Each group card shows the active project name as a muted `[data-active-project]` subtitle under the group name (`activeProjectName` with id fallback); omit when both null.
5. Group `<details>` stay collapsed by default and show a visible expand/collapse arrow/chevron; checkbox `stopPropagation` still prevents accidental details toggle.
6. Toolbar is one action row: New project | Import project | Open app; when the picker is visible it sits on its own row above that action row.
7. Layout and styling use shared `--rogatio-*` tokens and match full-page control density; no new brand.
8. Create, import, group toggle, Edit group, and prior status copy continue to work; forced-colors and reduced-motion coverage remain; switch failure does not add new status UX.
9. `design-system.spec.ts` and `popup-model.test.ts` (`switchProject`) prove the above; `pnpm validate` green before each phase is marked complete.
