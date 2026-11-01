> Status: frozen 2026-09-27

# Editor identity surface — specification

Audience: hybrid

Status: **approved** by the human at revision 3, 2026-09-27. Frozen on release
per `docs/decisions/README.md`.

## 1. Problem statement and goals

The shared editor asks users to author two kinds of identifier by hand. A group
page renders a `Group details` fieldset with `Group ID` and `Group name`
(`packages/editor/src/editor.ts:2541-2569`); every rule card renders a
`Common rule matcher` fieldset with `Rule ID` and `Rule name`
(`editor.ts:2780-2796`). The ids are validated, globally unique, and
load-bearing internally, but no user task requires reading or writing one.

Four problems follow.

1. The name is authored twice — once in the heading, once in a field — so the
   heading can disagree with the field and the user has to hunt for the field.
2. Ids are exposed on surfaces where they are noise, and in one case they are
   the *only* label a user gets: the extension Workspace sidebar prints
   `groupId/ruleId` (`packages/extension/src/extension-page-entry.ts:378`), the
   install-error card prints the same (`:702`), the editor test console prints
   the same (`editor.ts:2030`), and `rogatio test` prints the same
   (`packages/cli/src/commands/test.ts:446`).
3. A user who never wants an id still has two id boxes per entity to ignore.
4. Nothing guarantees that two entities carry distinguishable names, so every
   label the product shows can be ambiguous.

Goals.

- G1. A group's or rule's name is authored in one place, on its heading.
- G2. No group id or rule id is authored, read, or required anywhere in the
  product's normal surfaces.
- G3. Every id the program mints is derived from the entity's name at creation,
  is valid against the schema's own id rules, and is unique in the project.
- G4. Names are unique per project, so every label the product shows identifies
  exactly one entity.
- G5. Ids are frozen at creation, so they keep every internal guarantee they
  carry today across any later rename.
- G6. Every project that is repairable today stays repairable. Removing a field
  must not create a document the user cannot fix and cannot save.
- G7. Two live defects found while planning are fixed in the same change, since
  both sit on the surfaces this work already touches.

## 2. Scope

In scope.

- A1. The shared editor package (`@rogatio/editor`), which serves both the CLI
  `rogatio edit` host and the extension Workspace host.
- A2. The editor's test-console result rows.
- A3. The extension management page's Workspace sidebar rule rows and
  install-error card.
- A4. The `rogatio test` human-readable output line.
- A5. Identity and name generation, in one browser-safe module shared by every
  consumer.
- A6. Per-project name uniqueness, enforced by the existing semantic validation
  layer and mirrored for the MV3 bundle.
- A7. The popup's project-creation version defect.
- A8. The parent-path defect in `required` validation issues.
- A9. Living documentation that describes this surface.

Out of scope, explicitly.

- N1. The project file format. `id` stays `required` on group and rule
  (`packages/schema/src/schema.ts:59,73`) with the same pattern and bound, and
  `name` stays required with the same bound. No migration, no version bump.
- N2. **The generation convention is not a validation rule.** Validation
  enforces the existing id pattern, length, and uniqueness — it does not
  require an id to equal `PascalCase(name)`. Enforcing that would reject every
  existing project and every fixture in the repository, all of which use ids
  like `group-one` and `rule-one`. The convention governs what the program
  *mints*; the schema governs what is *accepted*.
- N3. The compiler's operation types, the dry-run engine's public types
  (`packages/dry-run/src/types.ts`), and `rogatio test --json` output. Names are
  resolved at each presentation site from data already in hand.
- N4. The DevTools `[rogatio]` console line, which keeps `ruleId=`
  (`packages/extension/src/match-format.ts:157`).
- N5. Host-generated Chrome DNR reason text, which renders verbatim and contains
  Chrome's numeric id (`extension-page-entry.ts:703-708`;
  `test/browser/extension.test.ts:634` pins
  `"Rule with id 2000001 cannot have an empty list"`). Ids are therefore not
  fully absent from the management page; the guarantee is about *Rogatio's own*
  identifiers.
- N6. The dashboard project `ID:` line (`extension-page-entry.ts:874`) and the
  project-id fallbacks used as display names (`:827,1035,542`). Project-level
  name uniqueness is already enforced by the repository
  (`core.duplicate-name`, `packages/browser-core/src/repository.ts:289-295`).
- N7. Popup behavior beyond A7. The popup already shows names
  (`packages/extension/src/popup.ts:341`, `popup-model.ts:156`).

## 3. Actors, entry points, environments

- A group author or rule author using the extension Workspace or the CLI
  `rogatio edit` page in a desktop browser.
- A reader of the Workspace sidebar who needs to identify which rule is in which
  state.
- A reader of `rogatio test` output in a terminal.
- An author of a `.rogatio.json` file by hand, who still writes ids because the
  format requires them.
- A support engineer reading a bug report. Ids remain reachable through the
  project file, the "Show diagnostics" copy, and the DevTools console line.

Both editor hosts run the same browser bundle, and the native AI host runs the
same identity module in Node. Nothing here is host-specific.

## 4. Functional requirements

### Group A — inline rename

- **REQ-001** The group page heading row exposes a rename control that opens an
  inline editor for the group's name.
- **REQ-002** Each rule card heading row exposes a rename control that opens an
  inline editor for that rule's name.
- **REQ-003** The inline editor commits only on an explicit save control or
  `Enter`, and reverts only on an explicit cancel control or `Escape`. Typing
  never writes to the draft.
- **REQ-004** A commit is rejected, leaving the draft unchanged, the inline
  editor open and focused, and a message in the status line, when the trimmed
  value is empty or entirely whitespace, or when it duplicates another name in
  the project. The message names the conflicting entity.
- **REQ-005** On commit, leading and trailing whitespace is trimmed from the
  stored value.
- **REQ-006** The inline editor is a registered editor control keyed by the
  entity's `/name` pointer, re-registered on every render, so that a pending
  focus request for that pointer resolves to the input. This covers the existing
  focus requests raised by add group, add rule, copy rule, copy group, move
  group, move rule, and AI proposal apply
  (`editor.ts:1386,1406,1440,1481,1494,1510,1733`).
- **REQ-007** While the inline editor is open, the heading element remains in the
  document, visually hidden and not removed, so the rule card's
  `aria-labelledby` target and the group heading's enable-control label keep
  resolving to the current name.
- **REQ-008** `Enter` inside the inline editor never triggers a project save,
  including on a group page with no rules where the inline editor is the form's
  only field.
- **REQ-009** `Enter` and `Escape` pressed during an IME composition do not
  commit or cancel. Composition state is reset on every render so a re-render
  during composition cannot leave the editor permanently non-rerendering.
- **REQ-010** The inline editor enforces the schema's label bound with
  `maxLength` of 100.
- **REQ-011** Rename mode closes when the route leaves the entity, when the
  entity is removed, and when the draft is discarded. A host remount discards an
  uncommitted rename, consistent with every other uncommitted input in the
  editor; no dirty flag is set for uncommitted text.
- **REQ-012** A diagnostic whose path is the entity's `/name` pointer opens
  rename mode focused on the inline editor and decorates it with the
  diagnostic's error text. A diagnostic whose path is the entity's own pointer
  also opens rename mode, because a host adapter is not required to point at the
  property.
- **REQ-013** A diagnostic whose path is a group or rule `/id` pointer is
  presented in the error summary with a repair action that assigns a fresh
  collision-free id to the offending entity and re-validates.

### Group B — identifiers leave the surface

- **REQ-014** The editor renders no control for a group id or a rule id.
- **REQ-015** The `Group details` fieldset is removed. The rule card's
  `Common rule matcher` fieldset is removed, and the `Source condition` fieldset
  it contained is attached directly to the card.
- **REQ-016** Ids present in a loaded project are preserved exactly, including
  ids that do not follow the generation convention. The only operation that
  changes an existing id is the REQ-013 repair action.
- **REQ-017** The editor's test-console result rows identify a rule by group
  name and rule name, resolved from the draft the editor already handed to the
  dry-run host.
- **REQ-018** The Workspace sidebar's rule rows and the install-error card
  identify a rule by group name and rule name, resolved from the **committed**
  active project, never from the editor's unsaved draft. A rule absent from the
  committed project falls back to its id.
- **REQ-019** Where two entries in the same sidebar list would render identical
  text, the later entry carries a disambiguator derived from its rule id. With
  REQ-024 in force this is a rare path, reachable only through a status that
  refers to a rule whose name has since changed.
- **REQ-020** The `rogatio test` human-readable rule line identifies a rule by
  group name and rule name, resolved from the compiled operations already in
  hand. The `--json` payload is unchanged.
- **REQ-021** No public serialized output changes other than the REQ-034
  diagnostic path. `DryRunResult`, `RuleMatchResult`, `EditorDiagnostic`, the
  compiler operation types, and the project file format are all unchanged.

### Group C — generated identity and unique names

- **REQ-022** A single browser-safe module in `@rogatio/schema` owns id
  derivation, name comparison, and unique-name selection, so the editor, the
  native AI host, the compiler's semantic pass, and the extension's validation
  mirror cannot disagree. It is pure, imports nothing from Node, and adds no new
  package edge.
- **REQ-023** Id derivation lowercases the name, splits it on runs of characters
  that are not ASCII alphanumerics, capitalizes the first character of each
  token, and joins the tokens. The derivation is total: a name consisting only of
  symbols or non-ASCII characters yields the fixed fallback `Group` or `Rule`
  rather than an empty id.
- **REQ-024** Names are unique per project across groups and rules together,
  compared after trimming, collapsing internal whitespace runs to one space, and
  lowercasing. A group and a rule may therefore not share a name.
- **REQ-025** Name uniqueness is enforced as a semantic validation rule beside
  the existing global id uniqueness rule, reported through a new stable
  diagnostic code, and mirrored in the extension's browser-safe validator so the
  MV3 bundle enforces the same rule without Ajv.
- **REQ-026** The AI prompt's list of diagnostic codes includes the new code, so
  an AI-generated project is repaired rather than rejected for a rule the model
  was never told about.
- **REQ-027** The id assigned to a new group, a new rule, a copied group, a
  copied rule, and a repaired id is derived from that entity's name. When the
  derived candidate is already used in the project, an incrementing integer is
  appended — the first use is unsuffixed, then `2`, `3`, and so on — and the
  result is truncated so the id, including its suffix, fits the schema's
  64-character bound.
- **REQ-028** Because names are unique per project (REQ-024), an id collision can
  only arise between distinct names that reduce to the same token sequence, such
  as `ads-blocker` and `Ads Blocker`. The integer suffix of REQ-027 is what
  keeps those ids distinct.
- **REQ-029** Creating a group, creating a rule, applying an AI proposal, and
  duplicating an entity all select a name that is unique at that moment.
  Duplicating an entity derives its name from the copy label, and the copy's id
  is derived from that copied name, so a copy is never a duplicate of its source.
- **REQ-030** **Ids are frozen at creation.** A rename changes the name and never
  the id. A rename therefore does not change a Chrome DNR rule id, does not
  invalidate a deep link, and does not disturb group enablement.
- **REQ-031** After the REQ-013 repair action changes the open group's id, the
  route continues to address that group and the heading's enable control
  continues to name it. The enable control binds the draft group to its
  committed id by array index (`editor.ts:3403-3412`) and is therefore already
  insulated; the one place that still resolves a name through the committed id is
  `syncGroupEnablement` (`editor.ts:2119-2125`) and must not degrade.

### Group D — the two defects

- **REQ-032** The popup's project creation sends the current `PROJECT_VERSION`.
  It currently sends a hard-coded `1` against a schema that requires `2`
  (`packages/extension/src/popup-model.ts:209` against
  `packages/extension/src/browser-schema.ts:597`), so every popup-created
  project fails validation and is reported to the user as a storage failure.
- **REQ-033** The extension has exactly one source of truth for the project
  version. Both `popup-model.ts` and `extension-page-entry.ts:1434` use the
  constant already exported by the extension's browser-safe validator rather than
  repeating the literal.
- **REQ-034** A `required` validation issue reports the path of the **missing
  property**, not the path of its parent. Ajv reports `instancePath` as the
  parent with `params.missingProperty` naming the property
  (`packages/schema/src/validation.ts:43-52`), and the compiler copies the path
  through unchanged (`packages/compiler/src/diagnostics.ts:140`), so a group
  missing `name` is currently reported at `/groups/0` — a path no control owns.
  The correction happens in the single Ajv funnel so the compiler, `rogatio
  verify`, and the editor all receive the corrected path.

## 5. Acceptance criteria

Group A.

- **AC-001** On a group page, activating the heading's rename control replaces
  nothing structurally: the heading stays in the document, the inline editor
  receives focus, and the existing group controls remain present and operable.
- **AC-002** Typing into the inline editor and then activating the cancel control
  leaves the draft byte-identical to its pre-edit state and the heading text
  unchanged.
- **AC-003** Committing `  Ads blocker  ` stores `Ads blocker`.
- **AC-004** Committing an empty or whitespace-only value leaves the draft
  unchanged, keeps the inline editor open and focused, and writes a rejection
  message to the status line that a screen reader announces.
- **AC-005** Committing a name that another entity in the project already uses,
  ignoring case and internal spacing, leaves the draft unchanged, keeps the
  inline editor open, and reports a message naming the entity that holds the
  name.
- **AC-006** The inline editor rejects a 101st typed character rather than
  truncating silently at save time.
- **AC-007** `Enter` in the inline editor commits the name and does not call the
  host save adapter. Verified in a real browser journey on a group page whose
  only field is the inline editor.
- **AC-008** `Escape` in the inline editor reverts and returns focus to the
  heading's rename control.
- **AC-009** `Enter` pressed to accept an IME candidate neither commits nor
  reverts; the subsequent explicit commit uses the composed text.
- **AC-010** Immediately after add group, add rule, copy group, copy rule, move
  group, move rule, and an AI proposal apply, the inline editor for the affected
  entity is open and focused. Each case asserts `document.activeElement`.
- **AC-011** While a rule is being renamed, the rule card still exposes its
  current name as its accessible name, and its Move, Copy, and Remove controls
  still announce that name.
- **AC-012** A project containing a duplicate group id opens, reports the
  duplicate, and offers a repair action; activating the action yields a
  saveable project.
- **AC-013** A project whose group name is empty or missing opens, the error
  summary links to the group, following the link opens rename mode focused on
  the inline editor, and committing a valid name clears the error.

Group B.

- **AC-014** No element in the editor is labelled `Group ID`, `Group name`,
  `Rule ID`, or `Rule name`, and no `data-path` ending in `/id` exists for a
  group or rule.
- **AC-015** Loading a project, editing an unrelated field, and saving rewrites
  no group or rule id. The saved document's ids are identical to the loaded
  document's ids, entity for entity, including ids that do not follow the
  derivation convention.
- **AC-016** The test console identifies each result row by group name and rule
  name, including when two rules in different groups would share a name.
- **AC-017** The Workspace sidebar rule row shows the group name and rule name.
  After an unsaved rename in the editor, the row still shows the committed name.
- **AC-018** The install-error card shows the group name and rule name for a rule
  present in the committed project, and falls back to `groupId/ruleId` for a
  rule that is not.
- **AC-019** A committed project containing two rules whose sidebar rows would
  render identical text renders two visually distinct rows, with the second
  carrying the disambiguator.
- **AC-020** `rogatio test` prints a name-based rule line, and `rogatio test
  --json` output is byte-identical to its pre-change output for the same input.
- **AC-021** The rule card's `Source condition` fieldset renders as a direct
  child of the card with its legend, and the group page renders no empty
  fieldset. The heading row keeps its controls on one row at desktop width and
  wraps at the existing mobile breakpoint.
- **AC-022** The rename controls are reachable and operable by keyboard alone,
  each with an accessible name that includes the entity name.

Group C.

- **AC-023** A new rule added to a project that already contains a rule named
  `New rule` is created as `New rule 2`, and a third as `New rule 3`. The
  project validates after each.
- **AC-024** A group created as `ads blocker` receives the id `AdsBlocker`. A
  second group created as `Ad blocker` — a distinct name under REQ-024 — receives
  `AdBlocker`, so no id collides.
- **AC-025** Two names that differ only by separator, `ads-blocker` and
  `Ads Blocker`, are distinct names under REQ-024; the second entity created
  receives the id `AdsBlocker2` and the project validates.
- **AC-026** An entity whose name is `🎉 🎉` receives the fallback id `Group` or
  `Rule` with the integer suffix needed for uniqueness, and the project
  validates.
- **AC-027** An entity name long enough that the derived id would exceed 64
  characters produces a valid id of at most 64 characters including its suffix,
  and the project validates.
- **AC-028** A copied group named `Two (copy)` receives an id derived from that
  copied name, distinct from the source group's id, and the project validates
  with both present.
- **AC-029** Renaming a group or a rule changes its name and leaves its id
  untouched; the project validates; and the rule's Chrome DNR rule id, its
  `?rule=<id>` deep link, and its group's enablement target are all unaffected.
- **AC-030** After the repair action assigns a new id to the open group, the
  editor stays on that group's page, its rule cards are still shown, and the
  heading's enable control still reads the group's name and still toggles the
  committed group.
- **AC-031** A group name and a rule name that differ only by case are rejected as
  duplicates, in the editor at commit and by the host validator for a
  hand-authored file. The CLI validator and the extension's browser validator
  both report the new diagnostic code for the same document, at the same path.
- **AC-032** `rogatio verify` rejects a project with two equal names using the new
  diagnostic code, and the AI prompt's diagnostic list contains that code.
- **AC-033** The id derivation, name comparison, and unique-name functions are
  pure and are unit-tested directly, including for names that are empty, only
  symbols, only non-ASCII letters, leading digits, 200 characters long, and
  already ending in digits.

Group D.

- **AC-034** A popup-created project carries the current `PROJECT_VERSION` in the
  outgoing command and is accepted by the repository, so the popup reports
  success instead of a storage failure.
- **AC-035** No project-version literal remains in the extension sources; the
  management page and the popup both reference the exported constant.
- **AC-036** For a project whose group is missing `name`, `rogatio verify` and
  the editor's host validator both report `schema.required` at `/groups/0/name`.
  The same holds for a rule missing `name` at `/groups/0/rules/0/name` and for a
  project missing `name` at `/name`.
- **AC-037** The message for a `required` violation is the compiler's stable
  message, not Ajv's wording, and no diagnostic the editor renders contains
  third-party message text.
- **AC-038** The extension's browser-safe validator reports the same paths as the
  compiler for the same document, so a project rejected by one host is rejected
  identically by the other.

Cross-cutting.

- **AC-039** `pnpm validate` exits 0, including the browser suite.

## 6. Interface changes

- **New module** `packages/schema/src/identity.ts`, exported through
  `packages/schema/src/index.ts` and through the extension's browser-safe
  validator:
  - `deriveEntityId(name, kind, reserved): string` — REQ-023, REQ-027.
  - `normalizeNameKey(name): string` — REQ-024 comparison key.
  - `uniqueName(base, reserved): string` — REQ-029 name selection.
  `kind` is `"group" | "rule"`. All three treat `reserved` as a mutable set and
  add what they return, so a caller can allocate repeatedly against one set.
- **New diagnostic code** `schema.duplicate-name` in
  `packages/compiler/src/types.ts` and `packages/compiler/src/diagnostics.ts`,
  mapped from a new `uniqueName` keyword in
  `packages/schema/src/validation.ts`, with a stable message. Mirrored in
  `packages/extension/src/browser-schema.ts`.
- **Corrected diagnostic path** for `required` issues, in
  `packages/schema/src/validation.ts:43-52`. The code and message are unchanged;
  only the path becomes the missing property's path.
- **Editor public DOM contract**: new hooks for the rename control, the inline
  editor, and the id repair action. Existing hooks `[data-group-heading]`,
  `[data-rule-heading]`, `[data-section-heading]`, `[data-rule-card]`,
  `[data-rule-id]`, and `ruleAnchorId` are unchanged, so existing host and test
  selectors keep working.
- `EditorController` public surface: unchanged. Rename state is internal.
- Extension management page and popup: text and one constant reference change.
  No message-protocol shape change, so the service worker is untouched.
- `rogatio test`: human-readable line format changes. `--json` does not.
- Project file: unchanged.

## 7. Security, privacy, performance, accessibility, operational

- Security: no new input reaches an HTML sink. The inline editor is a native
  input whose value is read once at commit and written through the existing
  `setValueAtPath`, which already rejects inherited, accessor, symbol, and cycle
  values. Id derivation and name normalization are pure string operations over
  ASCII alphanumerics, so a crafted name cannot produce a prototype-polluting
  key, a path separator, or an id that escapes the id pattern; a name whose
  tokens are all digits produces an id that still matches the pattern, which
  permits a leading digit. Names resolved for display come from the committed
  project and are inserted as text, never as HTML; that project's `data` is typed
  `unknown` (`extension-page-entry.ts:19-20`) and must be read defensively.
- Privacy: no new telemetry, storage key, or network call. The rename buffer
  lives in controller memory only.
- Performance: the rename editor adds one input per heading and re-renders no
  more often than today, because there is no live apply. Name resolution for the
  sidebar is a single pass over the committed project's rules per sidebar
  render, replacing per-row lookups. Name-uniqueness comparison builds one set
  per validation pass, the same shape as the existing id-uniqueness pass.
- Accessibility: the heading is retained for `aria-labelledby` (REQ-007); the
  inline editor has a programmatic label naming the entity; the error
  association reuses the existing `aria-describedby` pattern; the status line is
  the existing polite live region; icon-only controls carry `aria-label` and
  `title`; forced-colors and reduced-motion behavior is preserved because the
  new styles use existing tokens.
- Operational: no new dependency, no new build artifact. The canonical
  validation command remains `pnpm validate`.

## 8. Migration, rollout, backward compatibility

No migration. The file format is identical, ids are preserved for every entity,
and no committed document becomes unreadable. Because ids are frozen at
creation, renaming never invalidates a deep link or a Chrome DNR rule identity.

A project that contains two equal names becomes invalid under REQ-024. Such a
document can only exist if it was hand-authored, because the repository rejects
invalid data on create, import, and update
(`packages/browser-core/src/repository.ts:287,338,397`). A user who opens one in
the CLI editor sees the new diagnostic, follows the summary link, and renames the
offending entity in place through the inline editor.

Projects whose ids do not follow the derivation convention keep those ids, per
N2 and AC-015.

The REQ-034 path correction changes the `path` of `schema.required` diagnostics
for every Ajv-validated document. Two existing assertions expect the parent path
and must be updated: `packages/compiler/test/compiler.test.ts:339`. No code,
severity, or message changes.

## 9. Decisions

- D1 (instruction). Ids are PascalCase derivations of the lower-cased name, with
  an incrementing integer appended for uniqueness. The user is never asked for an
  id on create or copy.
- D2 (instruction). Names are unique per project.
- D3 (recommendation, accepted). Leading and trailing whitespace is trimmed on
  commit.
- D4 (recommendation, accepted). An unrepairable id is fixed by an explicit
  "Assign a new ID" action in the error summary, using the derivation allocator.
- D5 (recommendation, accepted). A sidebar row shows `group name / rule name`,
  and an id disambiguator is appended only on a collision within the same list.
- D6 (recommendation, accepted). The `rogatio test` human-readable line changes
  to names; `--json` does not.
- D7 (instruction, revision 3). **Ids are frozen at creation.** The earlier draft
  regenerated the id on rename and that was reversed. Consequences accepted: an
  entity's id is the derivation of the name it had when the id was minted, so a
  group created as `New group` keeps the id `NewGroup` after being renamed to
  `Ads blocker`, and the derivation's legibility is realized only where the name
  is already final — copied entities (`Two (copy)` becomes `TwoCopy`) and
  AI-created entities. In exchange, a rename touches no id, so Chrome DNR rule
  identity, deep links, and group enablement are all untouched by the editor's
  most common action.
- D8 (judgment). Name comparison lowercases and collapses internal whitespace
  runs, so `Ads Blocker` and `ads  blocker` are the same name.
- D9 (judgment). The generation convention is a minting rule, not a validation
  rule (N2), because enforcing it would reject every existing project and
  fixture in the repository.
- D10 (instruction, revision 3). The two defects found while planning are fixed
  in this change: the popup's project-creation version (REQ-032) and the
  `required` issue path (REQ-034).
- D11 (correction, revision 3). An earlier draft described the second defect as
  the editor exposing raw Ajv wording. That was wrong.
  `mapValidationIssues` substitutes the stable message per code
  (`packages/compiler/src/diagnostics.ts:141`), so no Ajv wording ever reaches
  the editor. The defect is the path alone. The obligation at
  `docs/architecture.md:234` is retained as AC-037 so it cannot regress.

## 10. Assumptions

- A1. The rename control is an icon-only button, following the existing
  `.rogatio-copy-icon` precedent (`packages/extension/src/extension.css:
  414-422`): a glyph with `aria-label` and `title`. The editor has no icon
  precedent today, and `data-btn` has no `ghost` variant in CSS, so the control
  reuses `secondary` and the styles are added to `packages/editor/src/editor.css`
  in place. The glyph set in use is `+ ↥ ✦ × ✓ ✗ ⧉`; a pencil glyph is new.
- A2. The inline editor logic lives in `packages/editor/src/editor.ts`, not a new
  source file, because `scripts/validate.ts:394` audits the editor bundle by
  scanning an exact filename list and a new file would escape that scan. The
  identity module in `@rogatio/schema` is a new file in a package that is not
  subject to that filename scan.
- A3. The inline editor carries `data-editor-key` but not `data-path`, so
  `handleInput` (`editor.ts:900-905`) and `handleCompositionEnd` (`:1004`) do not
  wire it to live apply. It registers in the `controls` map directly, which is
  what `restoreFocus` reads (`:3469-3491`).
- A4. `Enter` is guarded in two places: `preventDefault` on the keydown, and an
  early return in `handleSubmit` (`:979-982`). The keydown alone is not
  sufficient, because implicit submission does not depend on it.
- A5. The extension's browser-safe validator already defines `PROJECT_VERSION`
  (`packages/extension/src/browser-schema.ts:84`) and the extension bundle
  resolves `@rogatio/schema` to that module, so REQ-033 needs no new import edge
  and cannot pull Ajv into the MV3 bundle.
