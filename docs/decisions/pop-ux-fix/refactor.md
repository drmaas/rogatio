# Popup UX Fix — Refactor candidates

Proposal only. No behavior change. Conservative: surface candidates that make the next popup change cheaper without new frameworks or shared toolbar extracted across surfaces (plan non-goals still hold).

Self-review discarded: `sendOk`-style helpers for three identical `response?.ok === true` returns; `PopupModel.activeProjectLabel` for a one-line fallback; shared token/`extension.css` extraction; shared toolbar component with the management page. Those are low benefit and/or fight plan non-goals.

---

## 1. Deduplicate Playwright chrome-mock fixtures

### Candidate

`test/browser/design-system.spec.ts` now defines module-level `MockProject` / `MockEnvelope` / `projectA`, but `installChromeMock` still embeds a near-identical default envelope (and a second inline `Envelope` shape) because the init-script body must be self-contained. One-project cases pass `projectA`; the default path duplicates it. Empty / empty-groups seeds are ad-hoc object literals.

Collapse to: module-level fixture builders (`emptyEnvelope`, `oneProjectEnvelope`, `twoProjectEnvelope` / `defaultEnvelope`) always passed as the `addInitScript` argument; keep the default *inside* the serialized fn only as a last-resort fallback or remove it once every call site passes a seed. Reuse one project/group/rule factory for variants instead of copy-paste.

### Expected benefit

Next picker / switch / empty-state case is a one-line seed, not another 40-line project blob. Single source of truth for “Project A” / “group-one” / “rule-one” ids that tests assert against.

### Risk

Low. Init-script serialization already requires plain JSON-serializable seeds; moving the default out is the same contract the 0/1 tests already use. Mistake would show as fixture drift in existing browser tests.

### Scope

`test/browser/design-system.spec.ts` only. No production code.

### Test plan

Re-run Playwright cases that touch the popup mock: dark Rogatio card, zero/one-project picker hide, empty-groups subtitle omit, switch-project, Open app href. No assertion changes intended.

---

## 2. Split kitchen-sink popup browser test; share toolbar assertions

### Candidate

`popup renders the dark Rogatio card` now stacks smoke (html/css), ≥2 picker, Phase 2 subtitle/chevron/stopPropagation, width, toolbar membership, create, and import. Zero- and one-project tests repeat the same “actions visible / Open app not in header” block.

Split into focused tests (e.g. smoke + toolbar, group card chrome, create/import flows stay separate or stay with smoke). Extract a tiny helper such as `expectProjectActions(page)` (and optionally `expectPickerAbsent(page)`) used by the 0/1 cases and the main toolbar case.

### Expected benefit

Failures name the broken seam. Next popup UX phase edits one short test instead of a 130-line monolith. Toolbar layout regressions are asserted once.

### Risk

Low–medium. Splitting can change ordering/parallelism and make create/import rely on a thinner setup; keep shared `addInitScript` + `goto` preamble. Do not weaken coverage when moving asserts.

### Scope

`test/browser/design-system.spec.ts` only.

### Test plan

Same popup browser coverage as today, just redistributed. `pnpm` Playwright filter for `design-system` green; spot-check that create/import and chevron cases still run.

---

## 3. Stable group identity hooks (`data-group-name`)

### Candidate

Production CSS uses brittle chains (`summary > span:first-child`, nested `> span:first-child`) for the identity column and name ellipsis. Browser tests locate the group name by scanning spans for text `"One"` and excluding `[data-active-project]`.

Add an explicit hook on the name node (e.g. `data-group-name`) and optionally `data-group-identity` on the wrapper; retarget CSS and tests to those attributes. Keep existing `[data-active-project]` / `[data-group]` / `[data-group-status]` contracts.

### Expected benefit

Next group-summary layout change does not break ellipsis or subtitle geometry tests. CSS no longer depends on accidental first-child order if status/toggle move.

### Risk

Low. Pure markup attribute + selector retarget. Visual risk only if specificity/selector rewrite drops a rule; caught by chevron/subtitle/ellipsis browser asserts.

### Scope

`packages/extension/src/popup.ts`, `packages/extension/src/popup.css`, `test/browser/design-system.spec.ts` (subtitle geometry evaluate + any name locators).

### Test plan

Existing Phase 2 browser asserts (subtitle under name, chevron, collapsed default, stopPropagation). Optionally simplify the geometry evaluate to use `[data-group-name]` vs `[data-active-project]` without changing the geometric check.

---

## 4. Local `render()` extractors in `popup.ts` (group card + hoist label)

### Candidate

`render()` still owns picker, toolbar, empty states, and the full group/rule DOM. The active project label (`activeProjectName ?? activeProjectId`) is recomputed inside the group loop. Extract file-local helpers only — e.g. `activeProjectLabel(model)`, `appendGroupCard(list, group, model)` — without new modules or frameworks.

### Expected benefit

Next group-card UX edit is localized; label fallback lives in one place. Slightly easier reading of toolbar vs list seams.

### Risk

Low. Pure move of existing DOM construction. Over-extraction into many tiny helpers would hurt; keep at most two helpers.

### Scope

`packages/extension/src/popup.ts` only.

### Test plan

No new tests. Re-run `design-system` popup cases + any extension unit tests that do not touch DOM (unchanged). Visual/behavior parity via existing browser suite.

---

## 5. Shared CSS class for toolbar action controls — *marginal*

### Candidate

`[data-project-actions] button` and `a[data-open-app]` are paired in base, hover, and forced-colors rules. Assign a single class (e.g. `rogatio-popup-action`) on New / Import / Open app and select that class once (still allow create-actions overlap as today).

### Expected benefit

Adding a fourth toolbar control is one class assignment, not another dual selector triple.

### Risk

Low visually, but plan preferred data-attribute styling and warned against extra chrome. Class + data-attrs can drift if only one is updated.

### Scope

`popup.ts` (className on three controls), `popup.css` (collapse paired selectors).

### Test plan

Toolbar membership + Open app href browser tests; forced-colors not re-proven beyond existing suite unless a dedicated case already exists.

**Recommendation lean:** only if candidate 2/3 already touch these files and the selector churn is free; otherwise defer.

---

## Skipped (self-review)

| Idea | Why skip |
| --- | --- |
| Private `ok`-response helper in `popup-model` | Three one-liners; abstraction cost > savings |
| `PopupModel.activeProjectLabel` | Single expression; public API churn for little gain |
| Shared `:root` tokens / toolbar with `extension.css` | Plan non-goal; cross-surface risk |
| Switch-failure status UX / deep-link | Behavior change, not refactor |
| Parameterize 0/1 picker tests only | Tiny duplication; covered if #1–#2 land |
