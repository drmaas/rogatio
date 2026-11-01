> Status: frozen 2026-09-27

# Editor identity surface — implementation plan

Audience: hybrid

Status: draft, awaiting approval to execute

Approved specification: `docs/decisions/editor-identity-surface/spec.md`
revision 3. Every task below maps to at least one `AC-*` in that document.

## Ground rules for this worktree

- Work happens only in `/home/drmaas/Projects/github/drmaas/rogatio-editor-identity-surface`
  on `feature/editor-identity-surface`, base `e8b1410`.
- The canonical gate is `pnpm validate` (`node scripts/validate.ts`), which runs
  format:check, lint, typecheck, build, unit + integration vitest, artifact,
  module, and boundary checks, three negative typecheck fixtures, and then the
  full Selenium browser suite (`scripts/validate.ts:421-442`).
- The worktree does **not** build a graph. `AGENTS.md` forbids it; queries read
  the main checkout's `graphify-out/graph.json` with `--graph`. The Stage 5
  orientation query was run that way.
- Tests are written before the code they cover, per task. A test that must be
  red first is recorded as such.
- No new editor source file. `scripts/validate.ts:394` audits the editor bundle
  by scanning an exact filename list (`index`, `types`, `url`, `editor`), so a
  new file under `packages/editor/src/` would escape the browser-safety scan.
  New logic lives in `packages/schema/src/identity.ts`, which is in a package
  that is not subject to that scan.
- No new build artifact. `scripts/validate.ts:55-79` asserts an exact 18-entry
  `build-manifest.json`; `packages/editor/src/editor.css` is edited in place and
  still ships as `dist/browser/index.css`.

## Ordering constraints

```
T1 identity module  ──┬─> T2 semantic uniqueName ──> T4 compiler code
                      ├─> T5 MV3 mirror + re-export
                      └─> T9..T12 editor
T3 required path (independent of T1)
T8 popup version (independent)
T9 field removal ──> T10 inline rename ──> T11 id wiring
T9 ──> T13 css
T14 extension presentation (independent of the editor, shares T1)
T15 cli output (independent)
T17 browser journeys (depends on T9..T14 landing)
```

T1 gates every identity-dependent task. T3, T8, T14, and T15 have no ordering
constraints beyond their own packages and can be interleaved.

---

## Phase 0 — foundational: identity and diagnostics

### T1. Identity module in `@rogatio/schema`

File: `packages/schema/src/identity.ts` (new), exported from
`packages/schema/src/index.ts` and `packages/schema/src/browser-index.ts`.

Behavior, all pure and total:

- `normalizeNameKey(name: string): string` — trim, collapse internal whitespace
  runs to one space, lowercase (D8, REQ-024).
- `deriveEntityId(name: unknown, kind: "group" | "rule", reserved: Set<string>): string`
  — lowercase, split on runs of non-ASCII-alphanumerics, capitalize each token's
  first character, join (REQ-023). Empty result falls back to `Group` or `Rule`.
  While the candidate is in `reserved`, append `2`, `3`, … Truncate so the id
  plus suffix fits `LIMITS.maxIdLength` (REQ-027). Adds the result to `reserved`.
- `uniqueName(base: string, reserved: Set<string>): string` — `base`, then
  `base 2`, `base 3`, … comparing with `normalizeNameKey` (REQ-029). Adds the
  result to `reserved`.

`kind` selects the fallback token only; it does not namespace the id, because
group and rule ids share one project-wide namespace
(`browser-schema.ts:633-675`).

Ordering: nothing may start that mints an id or compares names.

Tests first: `packages/schema/test/identity.test.ts` (new). Cover names that are
empty, whitespace only, only symbols, only non-ASCII letters, emoji
(AC-026), leading digits, 200 characters (AC-027), already ending in digits, and
two distinct names reducing to one token sequence (AC-025, AC-028). Assert
purity by calling twice with the same reserved set and reading the same result
from two independent sets. Assert every returned id matches
`/^[A-Za-z0-9][A-Za-z0-9._-]*$/u` and is at most 64 characters.

Covers AC-024, AC-025, AC-026, AC-027, AC-033.

### T2. Per-project name uniqueness in the semantic pass

File: `packages/schema/src/validation.ts`, function `semanticIssues`
(`:175`).

Add a second registry, `names: Map<string, string>`, alongside the existing `ids`
registry (`:177`). For each group and each rule, when `name` is a non-empty
string, key it with `normalizeNameKey(name)`; on a collision push
`{ instancePath: <entity>/name, keyword: "uniqueName", message: …, params: { previousPath } }`.

Only compare non-empty strings. An empty or missing name is already reported by
the structural pass as `schema.required` or `schema.out-of-range`; reporting a
duplicate for it as well would put two errors on one defect. Traversal order is
already deterministic (groups outer, rules inner), so the reported
`previousPath` is stable.

Tests first, in `packages/schema/test/schema.test.ts`: two groups with equal
names; two rules in one group with equal names; a group and a rule with equal
names; case-only and spacing-only differences; a name repeated after the
structural pass already failed for that entity (exactly one error, not two).

Covers AC-031, and the validation half of AC-032.

### T3. `required` issues report the missing property's path

File: `packages/schema/src/validation.ts`, `ajvIssues` (`:43-52`).

For `keyword === "required"` with a string `params.missingProperty`, set
`instancePath` to `` `${error.instancePath}/${missingProperty}` ``. This is the
single Ajv funnel, so the compiler, `rogatio verify`, and the editor all receive
the corrected path (REQ-034). `params` is already carried through
(`:50`) and `missingProperty` is already an allowed diagnostic param
(`packages/compiler/src/diagnostics.ts:29`), so nothing else changes.

Tests first:

- `packages/schema/test/schema.test.ts` — a project missing `name` yields
  `instancePath === "/name"`; a group missing `name` yields
  `"/groups/0/name"`; a rule missing `name` yields `"/groups/0/rules/0/name"`.
- `packages/compiler/test/compiler.test.ts:339` currently asserts `path: ""` for
  a `required` violation. Update it to the corrected property path, and add a
  case for a group missing `name` asserting the path and that the message is the
  compiler's stable text, not Ajv's (AC-037).

Covers AC-036, AC-037.

### T4. `schema.duplicate-name` in the compiler

Files: `packages/compiler/src/types.ts` (add to `CompilerDiagnosticCode`),
`packages/compiler/src/diagnostics.ts` (add `uniqueName: "schema.duplicate-name"`
to `ISSUE_CODES` and a stable entry to `MESSAGES`; `previousPath` is already in
`SAFE_PARAM_KEYS`).

The message must not quote Ajv wording and must not embed the other entity's
name unless that name is already validated. Follow the existing
`schema.duplicate-id` entry, whose message is
`"Project and rule IDs must be unique."` — the new one is
`"Group and rule names must be unique within a project."`

Tests first: `packages/compiler/test/compiler.test.ts` — a project with two
equal names reports `schema.duplicate-name` at the second entity's `/name` path,
with `params.previousPath` pointing at the first.

Covers AC-031, AC-032.

### T5. MV3 mirror and re-exports

File: `packages/extension/src/browser-schema.ts`.

- Add the same `uniqueName` check to the mirror's group and rule loops
  (`:620-682`), reusing `normalizeNameKey` and the same skip rule as T2. The
  mirror already reports a missing `name` at the property path (`:642-648`),
  so T3 needs no change here.
- Re-export `deriveEntityId`, `normalizeNameKey`, and `uniqueName` so the
  extension bundle, which resolves `@rogatio/schema` to this module
  (`scripts/build.ts:118-120,136-138,155-157,174-176`), can reach them without
  a new edge and without Ajv.

Import them from `../../schema/src/identity.js` directly, matching how the
module already imports `captures.js`, `utf16.js`, `clone.js`, and `migrate-v1.js`
(`:10-19`) rather than the package index.

Tests first: `packages/extension/test/browser-schema.test.ts` — the mirror
accepts a project the compiler accepts and rejects the same duplicate-name
document with the same code and path (AC-038).

Covers AC-031, AC-038.

### T6. AI prompt diagnostic list

File: `packages/runtime/src/ai-prompt.ts:128`.

Add `schema.duplicate-name` beside `schema.duplicate-id` so the model is never
asked to repair a rule it was never told about (REQ-026).

Test: assert the prompt text passed to the provider contains the new code, in
the same style as the existing diagnostic-list assertion in that package.

Covers AC-032.

---

## Phase 1 — the two defects

### T7. Popup and management page project version

Files: `packages/extension/src/popup-model.ts:209`,
`packages/extension/src/extension-page-entry.ts:1434`.

Both repeat the literal. Replace both with the constant the extension's
browser-safe validator already exports (`browser-schema.ts:84`), so the extension
has one source of truth (REQ-032, REQ-033).

Tests first: `packages/extension/test/popup-model.test.ts:157-161` **currently
asserts the bug** — it pins `data: { version: 1, … }`, which is why the defect
survived. Correct it to assert `PROJECT_VERSION` (AC-034). Leave the outer
message `version: 1` alone; that is the protocol envelope version, not the
project version, and it is correct.

Covers AC-034, AC-035.

---

## Phase 2 — editor: remove the fields

### T8. Delete the id and name fields, re-parent the source fieldset

File: `packages/editor/src/editor.ts`.

- Delete the `Group details` fieldset and both its inputs (`:2541-2569`).
- Delete `Rule ID` and `Rule name` from the rule card and the now-empty
  `Common rule matcher` wrapper (`:2780-2796`), and pass the card itself as
  `renderSource`'s parent so `Source condition` attaches directly to the card
  (REQ-015). `renderSource` (`:2896`) appends to whatever parent it is given, so
  this is a one-argument change.
- `COMMON_RULE_FIELDS` (`:94`) keeps `id` and `name`: those names are still
  schema fields the editor must not let a rule-type extension own.

Tests first:

- `packages/editor/test/editor.test.ts` — no element is labelled `Group ID`,
  `Group name`, `Rule ID`, or `Rule name`; no `[data-path$="/id"]` exists for a
  group or rule (AC-014); the `Source condition` fieldset is a direct child of
  the card and still carries its legend; the group page renders no empty
  fieldset (AC-021).
- `packages/editor/test/editor.test.ts:574-609` drives its scenario by writing
  `[data-path="/groups/0/id"]`. That scenario becomes unreachable. Its surviving
  intent — the heading enable control targets the committed id, not the draft id
  — is already covered by the adjacent copy-group test at `:615`. Rewrite this
  test to assert the invariant through a reachable route, or delete it; do not
  leave it vacuous.
- Browser: `test/browser/editor.test.ts:138-141` and
  `test/browser/sidebar-cards.test.ts:354-373` assert the removed labels. Rewrite
  them against the T9 affordance.

Covers AC-014, AC-021, and the rewritten half of AC-015.

### T9. Stylesheet for the heading-row inline editor

File: `packages/editor/src/editor.css`.

- Add a heading-row input rule. Without it the global
  `input:not([type="checkbox"]) { width: 100% }` (`:225-235`) blows the flex
  heading row (`:382-390`) apart and pushes Copy, Remove, and Enable off it.
  This is a requirement, not polish.
- Add an icon-button class following the `.rogatio-copy-icon` precedent
  (`packages/extension/src/extension.css:414-422`): fixed square, mono font,
  accessible name from `aria-label` plus `title`.
- Remove the `[data-group-card]` rule (`:419-422`), which styled only the deleted
  `Group details` fieldset and is now dead.
- Reuse `data-btn="secondary"` and `"primary"`. Do not introduce a `ghost`
  variant; `docs/architecture.md:151` names one but no CSS implements it.

Tests first: `test/browser/design-system.test.ts` — the heading row keeps its
controls on one row at 1280px and wraps at the existing 48rem breakpoint
(AC-021); the new icon control has a non-zero accessible name (AC-022);
forced-colors assertions still pass.

Covers AC-021, AC-022.

---

## Phase 3 — editor: inline rename

### T10. Inline rename control, buffer, and commit

File: `packages/editor/src/editor.ts`.

State: `renameTarget`, holding the entity kind, its id, its `/name` pointer, and
the uncommitted buffer. It lives on the controller, not the DOM, because every
render rebuilds the header (REQ-003).

- Pencil control in `[data-group-heading]` and `[data-rule-heading]`, opening the
  editor with the buffer seeded from the current name and the input focused
  (REQ-001, REQ-002, AC-001).
- Keep the heading element in the DOM, visually hidden through the existing
  `data-editor-visually-hidden` rule (`editor.css:519-527`), so the rule card's
  `aria-labelledby` (`:2747-2749`) and the enable label keep resolving
  (REQ-007, AC-011).
- The input carries `data-editor-key` set to the entity's `/name` pointer and
  registers in `this.controls` under that pointer during the render pass, before
  `restoreFocus()` (`:2264`). It must **not** carry `data-path`, or
  `handleInput` (`:900-905`) and `handleCompositionEnd` (`:1004`) will apply
  every keystroke, which would break the no-live-apply rule, wipe the rejection
  message through `markChanged` (`:1341`), and leave Escape nothing to revert to.
- Commit on the save control or Enter. Revert on the cancel control or Escape,
  returning focus to the pencil (REQ-003, AC-008).
- Commit order is pinned: mutate the draft, call `markChanged()`, then set
  `statusMessage`, then render. Reversing the last two erases the message
  (REQ-004).
- Trim on commit (REQ-005, AC-003); `maxLength` 100 from `LIMITS.maxLabelLength`
  (REQ-010, AC-006).
- Reject an empty or whitespace-only trimmed value (AC-004) and a value whose
  `normalizeNameKey` matches another entity in the project, naming the conflict
  (REQ-004, AC-005).
- Focus the input on open via the existing `focusRequest` pointer, so the seven
  existing request sites (`:1386,1406,1440,1481,1494,1510,1733`) resolve to the
  input instead of a field that no longer exists (REQ-006).

Guards:

- `handleSubmit` (`:979`) returns early, committing the rename instead of
  dispatching `save`, when a rename is open. Every button in the editor is
  `type="button"`, so the form has no submit button and HTML implicit submission
  applies when the inline editor is the only field — a group page with no rules,
  which is exactly what `addGroup` produces (REQ-008).
- `preventDefault` on Enter in the input as well. The submit guard alone is not
  enough and the keydown alone is not enough.
- Enter and Escape return early when `this.composing` or `event.isComposing`
  (REQ-009). Reset `this.composing` at the top of `render()`, because a render
  during composition removes the composing element, `compositionend` never
  fires, and the flag otherwise latches, silently disabling re-render on
  keystroke for every other field in the editor.

Diagnostic wiring:

- A diagnostic at `<entity>/name`, or at `<entity>` when a host adapter does not
  point at the property, opens the inline editor focused and decorates it with
  `aria-invalid`, `aria-describedby`, and a `data-editor-field-error` element,
  mirroring `renderField` (`:3238-3250`) (REQ-012, AC-013).
- Rename mode closes on route change away from the entity, on removal of the
  entity, and on discard (REQ-011). A host remount discards an uncommitted
  rename and sets no dirty flag, matching every other uncommitted input.

Tests first, in `packages/editor/test/editor.test.ts` and a new
`packages/editor/test/rename.test.ts` (happy-dom pragma on line 1, per the
existing convention):

- AC-001 heading retained, input focused, other controls operable.
- AC-002 draft byte-identical after type-then-cancel.
- AC-003 trim on commit.
- AC-004 empty and whitespace-only rejection, input still open and focused.
- AC-005 duplicate rejection naming the conflict, case- and spacing-insensitive.
- AC-006 `maxLength`.
- AC-008 Escape reverts and restores focus to the pencil.
- AC-010 `document.activeElement` after add group, add rule, copy group, copy
  rule, move group, move rule, and AI apply. **No existing test asserts
  `activeElement` for any of these**; this is the coverage that makes REQ-006
  non-vacuous.
- AC-011 the card's accessible name while renaming.
- AC-013 a `/name` diagnostic opens the editor focused with the error associated.

Browser, because happy-dom does not implement implicit submission and cannot
observe REQ-008:

- AC-007 a group page whose only field is the inline editor: press Enter, assert
  the name committed **and** `window.editorTest.saveCalls` is still empty. On a
  new empty group created by Add group, so the trap state is reached naturally.

Covers AC-001 through AC-013, AC-022.

### T11. Id and name generation wiring

File: `packages/editor/src/editor.ts`.

- Replace the `allocateId` prefixes at the four creation sites — `addGroup`
  (`:1378`), `addRule` (`:1395`), `copyRule` (`:1417`), `copyGroup` (`:1451`) —
  and the AI branch (`applyAIProposal`, `:1669-1740`), with
  `deriveEntityId(name, kind, reserved)` against `allIds()`
  (`:1344-1353`).
- A copy derives its name through `copyLabel` (`:1367`) and then derives its id
  from that copied name, so a copy is never a duplicate of its source (REQ-029,
  AC-028).
- New entities select a unique name through `uniqueName`, so the second new rule
  is `New rule 2` and the third is `New rule 3` (REQ-029, AC-023). This is
  required, not cosmetic: with per-project name uniqueness, "New rule" twice
  would be an invalid project.
- `applyAIProposal` must also make the AI's proposed names unique before writing
  them, and must derive the id from the final name.
- **A rename never touches an id** (REQ-030). The commit path writes only the
  name.
- REQ-013 repair action: a diagnostic at `<entity>/id` renders, in the error
  summary, a control that assigns a derived id to that entity and re-validates
  (AC-012).

Tests first:

- AC-023 two and three `New rule`s.
- AC-024 `ads blocker` → `AdsBlocker`; `Ad blocker` → `AdBlocker`.
- AC-025 `ads-blocker` then `Ads Blocker` → `AdsBlocker2`, project valid.
- AC-028 a copy's id is derived from its copied name and differs from the source.
- AC-029 a rename changes the name and leaves the id, asserted by comparing the
  saved document against the loaded one.
- AC-030 after repairing the open group's id, the route still addresses that
  group and the enable control still names it.
- T16 below.

Covers AC-012, AC-023, AC-024, AC-025, AC-028, AC-029, AC-030.

### T12. `syncGroupEnablement` name resolution

File: `packages/editor/src/editor.ts:2119-2125`.

`syncGroupEnablement` reads `button.dataset.groupId`, which is the **committed**
id, then resolves the name with `groupById(...)`, which looks in the **draft**.
The `savedGroupIds` map already binds the two by array index (`:3403-3412`), so
the fix is to resolve the name through that binding instead of by id. Without it,
the enable label degrades to "Unnamed group" after the T11 repair action changes
a draft id (REQ-031).

Test first: repair the open group's id, call `syncGroupEnablement`, assert the
label still reads the group's name (AC-030). `test/browser/design-system.test.ts:
639` pins the exact string `"Disable group One"` and must stay green.

Covers AC-030.

### T13. Test-console result rows

File: `packages/editor/src/editor.ts:2029-2030`.

`renderTestResults` prints `` `${rule.groupId}/${rule.ruleId}` ``.
`DryRunRuleMatchResult` (`packages/editor/src/types.ts`) carries only ids, but
the editor already handed the host the draft (`:1955`), so resolve the names from
`this.draft` by id. Do **not** add a field to `RuleMatchResult` or change
`rogatio test --json` (N3, REQ-021).

Test first: a project where two rules in different groups would share a name, run
the test, assert both rows render by name (AC-016).

Covers AC-016.

---

## Phase 4 — presentation outside the editor

### T14. Sidebar rows and install-error card

File: `packages/extension/src/extension-page-entry.ts`.

- `createRuleEntry` (`:364-390`) currently prints
  `` `${groupId}/${ruleId}` ``. Resolve group and rule names from the
  **committed** active project, which is already in scope at `:529-548`, using
  the `storedProject.data` defensive reader — `data` is typed `unknown` (`:19`).
  Fall back to the id when the rule is absent, which is the orphan case the
  existing deep-link tests already cover (REQ-018).
- The error card identity (`:702`) resolves the same way.
- Disambiguation: after building the row list, any entry whose rendered text
  duplicates an earlier one gets its rule id appended (REQ-019). Compute it once
  per list rather than per row.
- Do **not** read `editor.getDraft()`. `docs/architecture.md:156` records that
  Workspace controls always target the committed active project, and
  `patchWorkspaceEnablementChrome` (`:776-786`) exists to protect a dirty draft.

Tests first:

- `test/browser/sidebar-cards.test.ts:461-463`,
  `test/browser/design-system.test.ts:684-686`,
  `test/browser/extension.test.ts:632,637,642,928-936,1120,1128-1130,1172-1183`,
  `test/browser/dnr-install-reconcile.test.ts:72-76,177,183-197` — all assert id
  text. Rewrite them against names.
- `test/browser/extension.test.ts:893-940` is titled "keys the error card by
  group and rule id instead of merging equal reasons" and currently proves
  disambiguation **by id**. Rewritten naively to assert name text it would pass
  even if two rows rendered identically. Assert the two rows are textually
  distinct (AC-019).
- New: rename in the editor without saving, assert the sidebar still shows the
  committed name (AC-017).
- New: an install error for a rule absent from the committed project falls back
  to `groupId/ruleId` (AC-018).

Covers AC-017, AC-018, AC-019.

### T15. `rogatio test` human output

File: `packages/cli/src/commands/test.ts:446`.

The CLI already holds `compileResult.operations` (`:429`), and every operation
carries `name` (`packages/compiler/src/types.ts:22-27`). Resolve the name from
the operation keyed by `groupId`/`ruleId`; do not touch `RuleMatchResult` or the
`--json` payload (N3, REQ-020, REQ-021).

Test first, in the CLI's existing `test` command coverage: assert the
human-readable line carries names, and assert `--json` output is byte-identical
to a recorded pre-change expectation for the same input (AC-020).

Covers AC-020.

---

## Phase 5 — full verification

### T16. `pnpm validate`

Run the canonical command and record exact output and exit code. It includes the
browser suite, which needs Chrome for Testing. Check for a resolved binary via
`.browser-cache/chrome-path.txt` or `ROGATIO_CHROME_PATH`
(`test/browser/driver.ts:53-134`) **before** running, and run
`pnpm browser:install` if absent. Do not accept a false green: a browser suite
that silently skipped is not a pass.

Covers AC-039.

---

## Phase 6 — documentation

### T17. Living docs only

- `docs/architecture.md:210` — the statement that the editor's data surface
  includes group id, group name, rule id, and rule name as fields is now wrong.
  Rewrite to describe heading rename and internal ids.
- `docs/architecture.md:224` — entity actions now sit beside an editable
  heading.
- `docs/architecture.md:156` — a sidebar rule row carries a name, with the id as
  a fallback and a collision disambiguator.
- `docs/architecture.md:180` — the in-place-repair guarantee is preserved; say
  how, for both a name diagnostic and an id diagnostic.
- `docs/architecture.md:61` — the semantic validation layer now covers unique
  names as well as unique ids.
- `packages/docs-site/src/content/docs/guides/editor.md` and
  `.../guides/projects-rules.md:30` — the id bullet describes the data model,
  which is unchanged, but the editor guide should describe heading rename.
- `packages/extension/README.md` and `packages/editor/README.md` if they
  enumerate editor fields.

Do **not** edit `docs/specs/`, `docs/plans/`, `docs/workflows/`, or
`docs/research/`. `docs/specs/f5-editor.md:33-34` and
`docs/plans/editor-button-label-names.md:14,21` describe the old fields and are
frozen decision history.

### T18. Freeze

Move `docs/decisions/editor-identity-surface/spec.md` to
`docs/specs/editor-identity-surface.md`, `plan.md` to
`docs/plans/editor-identity-surface.md`, and `workflow.md` to
`docs/workflows/editor-identity-surface-workflow.md`, each gaining
`> Status: frozen 2026-09-27`, then delete the empty
`docs/decisions/editor-identity-surface/` directory. Stage the moves with the
feature changes in one commit.

## Rollback

No migration, no persisted-state change, no feature flag. Reverting the commit
returns the editor to the four-field layout and the id-printing surfaces. The
one persistent consequence is the new `schema.duplicate-name` code: a project that
previously saved with two equal names is rejected after this change. Reverting
the commit restores acceptance. No stored data is rewritten by this change.

## Task-to-AC coverage check

| AC | Task |
| --- | --- |
| AC-001 … AC-013 | T10 |
| AC-014 | T8 |
| AC-015 | T8, T11 |
| AC-016 | T13 |
| AC-017, AC-018 | T14 |
| AC-019 | T14 |
| AC-020 | T15 |
| AC-021 | T8, T9 |
| AC-022 | T9, T10 |
| AC-023 … AC-025, AC-028 | T11 |
| AC-026, AC-027, AC-033 | T1 |
| AC-029 | T11 |
| AC-030 | T11, T12 |
| AC-031, AC-032 | T2, T4, T5, T6 |
| AC-034, AC-035 | T7 |
| AC-036, AC-037 | T3 |
| AC-038 | T5 |
| AC-039 | T16 |

No AC is unmapped. No task maps to an AC outside the approved specification.
