> Status: frozen 2026-09-27

# Editor identity surface — workflow log

Audience: agent

## Context

- Worktree: `/home/drmaas/Projects/github/drmaas/rogatio-editor-identity-surface`
- Branch: `feature/editor-identity-surface`
- Base: `e8b1410` (main)
- Graph: read from the main checkout `graphify-out/graph.json`; the worktree does
  not build a graph.

## Feature scope

One feature, two requirement groups, because both edit the same editor render
paths and group B depends on group A.

- Group A — inline rename. Replace the `Group name` and `Rule name` inputs with
  an inline editor on the group and rule headings.
- Group B — internal ids. Delete the `Group ID` and `Rule ID` inputs and stop
  printing raw ids to users in the extension sidebar, the install-error dialog,
  and the editor test console.

## Model selection

| Role | Choice | Rationale |
| --- | --- | --- |
| reasoning | parent / inherit | Primary brainstorm and specification in-session |
| adversarial | `general` subagent (fresh context, inherited model) | Independent pass; the host exposes one review-capable subagent type, so family separation is unavailable — recorded as a constraint, not a choice |
| plan | inherit | Same worktree and package set as the specification |
| coding | inherit | Same |
| verify | inherit | Canonical `pnpm validate` plus the browser suite |
| review | `general` subagent (fresh context, inherited model) | Same constraint as the adversarial pass |
| docs | inherit | Same |

## Approved decisions (human gate input, pre-spec)

- Inline rename commits on the save icon or Enter; Escape or the cancel icon
  reverts. No live apply on keystroke.
- A whitespace-only or empty commit is rejected; the editor stays in rename
  mode and reports through the status line.
- Id hiding reaches the editor fields, the management-page sidebar rule rows,
  and the install-error dialog. The DevTools `[rogatio]` console `ruleId=` and
  the dashboard project `ID:` line stay.
- One feature, one worktree, one pull request.

## Stage checklist

- [x] 0 Worktree
- [x] 1 Brainstorm + adversarial
- [x] 2 Architecture (folded into the spec's boundary and interface sections)
- [x] 3 Specification (`docs/decisions/editor-identity-surface/spec.md`, revision 3)
- [x] 4 Human review gate — **approved at revision 3**, 2026-09-27
- [x] 5 Implementation plan (`docs/decisions/editor-identity-surface/plan.md`)
- [x] 6 Tests first
- [x] 7 Implementation
- [x] 8 Verification — `pnpm validate` exit 0
- [x] 9 Independent review — round 1, findings applied
- [x] 10 Documentation
- [ ] 11 Freeze, release gate, commit, push, pull request

## Stage 9 independent review (round 1)

A fresh-context reviewer with no access to the implementation conversation read
the spec, the plan, this log, and the full diff. It raised 2 blockers, 8 majors,
11 minors, and 4 nits. All blockers and majors are fixed; the contract section
came back clean and the "four bugs caught by tests-first" claim was re-verified
against the code rather than taken on trust.

### Blockers found by review that the tests had missed

- **A missing `name` could not be repaired at all.** `setValueAtPath` refuses to
  create a property that is not already present — its allowlist
  (`CREATABLE_RULE_FIELDS`, `editor.ts:350`) exists to stop a field input
  inventing arbitrary keys. So a group with `name` **deleted** opened, reported
  `schema.required`, opened the inline editor, and then committed nothing
  ("Name unchanged."). This is precisely the case REQ-034 exists for, and my
  own AC-013 test missed it by using a project whose name was *present* with a
  synthetic diagnostic. Fixed with `writeEntityName`, which writes the property
  onto a record resolved by id — which also removes the dependency on a stale
  index. Two tests added with the property genuinely deleted.
- **An uncommitted rename buffer could be committed into a different entity.**
  `renameTarget` was cleared on route change but not on removal or discard, and
  `commitRename` trusted a stored index path. A proven sequence renamed a group,
  removed it, then submitted the form and had the *other* group renamed from the
  dead buffer. Fixed: the target is cleared on removal and on discard, and the
  commit re-resolves by identity and refuses when the entity is gone.

### Majors fixed

- The inline input's accessible name was literally `Group name` / `Rule name` —
  the two labels AC-014 forbids — and my AC-014 test only collected `<label>`
  text so it could not see an `aria-label`, while a browser test I had added
  actively depended on the old label. The input is now `Rename group One` /
  `Rename rule First rule`; the unit test collects accessible names as well, and
  the browser locator was updated.
- An AI *fix* proposal that restated a rule's current name appended " 2" to it,
  because the reserved set included the very rule being repaired. It now uses the
  same exclusion the rename path uses.
- `copyGroup` skipped a copied rule's ID reassignment when the rule's name was
  not a string, leaving the copy sharing the source rule's ID — one click
  produced an unsaveable project. The ID is now reassigned unconditionally;
  `deriveEntityId` is total, so a hostile name still yields a valid ID.
- `rogatio test` printed only the rule name where REQ-020 says group and rule.
  It now prints `group / rule`, from the validated project and the compiled
  operation.
- The sidebar's collision disambiguator and the editor's test-console rows had
  **no test at all**. Both now have coverage, including the disambiguator case
  the plan had predicted would pass vacuously.
- AC-010 was missing copy-rule and AI-apply focus assertions. Added. Its
  "move group" clause is untestable as written — `move-group-up`/`-down` are
  handled in `dispatchCommand` but no control renders them, and
  `docs/architecture.md:224` states group reorder is not exposed. Recorded for the
  spec's successor rather than papered over.
- AC-021's layout half had no test. The CSS is correct by inspection
  (`flex-wrap: wrap` on the heading rows plus bounded `[data-rename-controls]`),
  but nothing pins it. **Left as a known gap** — a viewport-width assertion is
  browser work that the design-system suite does not currently have a pattern
  for; recorded rather than half-built.
- AC-035 was not met: project-version literals remained in
  `extension-page-entry.ts:114,117` and `service-worker.ts:695`. All now use the
  exported constant.

### Minors fixed

Lost creation announcements (`Group added.` and friends) restored; the
`handleSubmit` guard scoped to the rename input being focused rather than
swallowing every submit while a rename is open; the IME guard narrowed so Escape
still dismisses the confirmation dialog during a composition; a length guard on
commit; a focus request for a different entity now commits the open rename
instead of dropping it (with a re-entrancy guard, because committing renders and
rendering asks again); `repairEntityId` re-validates; `committedRuleLabels` uses
own-string reads and is built once per sidebar render instead of twice; the
`--json` payload pinned by SHA-256 rather than a shape check; the test console
uses the same `group / rule` separator as the other two surfaces.

### Recorded, not fixed

- `test/integration/cli-test-output.test.ts` imports the CLI from source, not
  from `dist/node/index.js`, so it is not an on-built-artifact journey. The real
  binary is covered by `packaged-cli.test.ts`; changing the import would mean
  re-plumbing the command's argument shape.
- A pre-existing robustness gap surfaced while writing tests: a rule with no
  `resourceTypes` crashes `renderResourceTypes` (`editor.ts:3190` assumes an
  array). It is outside this feature's scope and the review did not raise it.
- The `uniqueName` fallback token for a name yielding no tokens is documented in
  the spec but not in the module comment; the module comment now notes that all
  whitespace classes, including non-ASCII spaces, are collapsed.

## Stage 10 documentation

Living docs updated: `docs/architecture.md` (the semantic-validation sentence,
the editor data surface and ID-generation statement, the sidebar rule-row
identity, the entity-actions paragraph, and the in-place-repair guarantee),
`packages/docs-site/src/content/docs/guides/editor.md`, and
`.../guides/projects-rules.md`. `pnpm site:build` builds 19 pages.

Frozen records under `docs/specs/`, `docs/plans/`, and `docs/workflows/` were
not edited; they now describe superseded behavior, which is expected for
decision history.

## Stage 8 verification evidence (re-run after review fixes)

`pnpm validate` exit 0 after every review fix: format, lint, typecheck, build,
**1157 unit + integration tests**, artifact/module/boundary checks, three
negative typecheck fixtures, and **76 browser tests** (8 skipped, 0 failed).

## Stage 8 verification evidence

`pnpm validate` (`node scripts/validate.ts`) exit 0 on
`feature/editor-identity-surface` at `e8b1410` + this change.

| Step | Result |
| --- | --- |
| `format:check` | pass, 361 files |
| `lint` | pass |
| `typecheck` (`tsc --noEmit`) | pass |
| `build` | pass, 18 artifacts |
| `vitest` unit + integration | **1153 passed**, 0 failed, 128 files |
| `checkArtifacts` | pass |
| `checkEmittedModules` | pass after a fixture fix, see below |
| `checkBoundaries` | pass |
| 3 negative typecheck fixtures | pass |
| browser suite (`test:browser`) | **75 passed**, 8 skipped, 0 failed, 15 files |

Chrome for Testing 154.0.8037.57 was installed into the worktree with
`pnpm browser:install`; no browser cache existed in either checkout, so the
browser step could not have run without it.

### Fixture the new rule invalidated

`scripts/validate.ts:179-201` built its emitted-schema project with a group
named `Check` and a rule also named `Check`. Per-project name uniqueness
(REQ-024) correctly rejects that, and `checkEmittedModules` failed until the
rule was renamed to `Check rule`. The rule was not weakened; the fixture was
made valid.

### Bugs the tests-first order caught

Four defects were found by writing the tests before the code, not by review:

1. `decorateWithErrors` ran before the inline input was appended to the
   document, so `insertAdjacentElement("afterend", …)` was a no-op. The control
   advertised `aria-describedby` pointing at an element that did not exist.
2. `reservedNameKeys` skipped a renamed group with `continue`, which also
   skipped that group's rules — so a group could take a rule's name. Now only
   the group's own *name* is excluded; its rules are still reserved.
3. `copyGroup` stopped setting the route, so a copied group was no longer the
   open group and the copy's inline editor never rendered. `openRename` now
   navigates to the entity it edits.
4. The id repair action resolved its target with `groupById`, which is
   ambiguous precisely when it matters — two entities sharing the bad id. It
   now resolves by the diagnostic's path, and the open route is tracked by
   index across the repair so a changed draft id cannot bounce the user off the
   page.

### False-green check on the Enter guard (AC-007)

AC-007 can only be observed in a real browser: the unit suite's happy-dom does
not implement implicit submission. The Selenium journey asserts that Enter in a
heading's inline editor never reaches the host save adapter.

The journey was then run against deliberately broken builds. It **passed** with
the `handleSubmit` guard removed, and it **passed** with the keydown
`preventDefault` removed. Each mechanism is independently sufficient, so both are
kept and the behaviour is proven rather than the implementation. Recorded because
a single-mechanism test would have looked equally green while proving less.

## Tooling note

`biome check --write` reports `Lint: 1 errors` and applies no fixes in this
environment, including on a single file. Import and export ordering was
therefore applied by hand to Biome's documented order (package imports before
relative ones; module specifiers sorted within a group), and
`pnpm format:check` plus `pnpm lint` both pass. Worth knowing before reaching
for `--write` again.

## Stage 3 revision 2 — human directives

The human added three directives after the first draft: the program generates
and validates unique ids; ids are PascalCase derivations of the lower-cased name
with an incrementing integer for uniqueness; the user is never asked for an id on
create or copy; and rule and group names are unique per project. Q1 through Q4
were answered with the recommendations.

Requirement group C was added for identity generation and name uniqueness, and
the scope grew by one browser-safe module in `@rogatio/schema` plus one
diagnostic code mirrored for the MV3 bundle.

The revision-2 draft regenerated the id on rename. That was reversed at
revision 3; see the revision-3 section below.

## Stage 3 revision 3 — approved

The human approved the specification with three changes.

- **Ids are frozen at creation (D7).** The revision-2 proposal regenerated the
  id on every rename. Reversed. A rename now touches no id, so Chrome DNR rule
  identity, `?group=`/`?rule=` deep links, and group enablement are all
  unaffected by the editor's most common action. The accepted cost is recorded
  in the spec: an entity's id is the derivation of the name it had when the id
  was minted, so a group created as `New group` keeps `NewGroup` after being
  renamed, and the derivation's legibility is realized only for copied entities
  (`Two (copy)` becomes `TwoCopy`) and AI-created entities.
- **The two defects are in scope (D10).** Requirement group D was added:
  REQ-032 and REQ-033 for the popup's project-creation version, and REQ-034 for
  the `required` issue path.
- **D11 corrects the record.** Revision 2 claimed the editor exposed raw Ajv
  wording for `required` violations. That was wrong.
  `mapValidationIssues` substitutes a stable message per code
  (`packages/compiler/src/diagnostics.ts:141`), so Ajv wording never reaches the
  editor. The real defect is the path: `ajvIssues`
  (`packages/schema/src/validation.ts:43-52`) copies Ajv's `instancePath`, which
  for a `required` violation is the **parent**, and
  `packages/compiler/src/diagnostics.ts:140` copies that through unchanged. A
  group missing `name` is therefore reported at `/groups/0`, a path no control
  owns. The correction belongs in the single Ajv funnel, which fixes the compiler,
  `rogatio verify`, and the editor at once.

Verification behind revision 3.

- The extension's browser-safe validator already defines its own
  `PROJECT_VERSION` (`packages/extension/src/browser-schema.ts:84`) and the
  extension bundle resolves `@rogatio/schema` to that module
  (`scripts/build.ts:118-120,136-138,155-157,174-176`), so REQ-033 introduces no
  new import edge and cannot pull Ajv into the MV3 bundle. The management page
  repeats the literal at `extension-page-entry.ts:1434`; both call sites move to
  the constant.
- The extension mirror already reports a missing `name` at the property path
  (`browser-schema.ts:642-648,676-682` uses `${groupPath}/name`), so the mirror
  needs no change for REQ-034. AC-038 pins the agreement between hosts.
- `packages/compiler/test/compiler.test.ts:339` asserts `path: ""` for a
  `required` violation and must be updated to the corrected property path.
  `packages/browser-core/test/repository.test.ts:257` asserts only the code and
  is unaffected.
- With ids frozen, REQ-031 narrows to the REQ-013 repair action. The
  `syncGroupEnablement` name-resolution hazard
  (`editor.ts:2119-2125`) is no longer reachable through a rename, because a
  rename no longer moves the draft id away from the committed id.

## Stage 1 adversarial outcome

The adversarial pass raised four blockers, two majors, and seven minors. Two of
its premises did not survive verification and were corrected before the
specification was written.

- **Corrected — invalid ids cannot reach the extension editor.** The pass claimed
  `packages/browser-core/src/repository.ts:94-140` stores project data
  unvalidated. It does not: `buildCreate` (`:287`), `buildImport` (`:338`), and
  `buildUpdate` (`:397`) all call `validateData`, which runs
  `validateProjectDetailed` and `compileProject` and fails closed. The reachable
  path for a project with a duplicate or malformed id is the CLI host, which
  reads a `.rogatio.json` file directly with no read-time validation. The
  requirement survives at reduced scope and became REQ-013.
- **Corrected — the repair path for a missing name is the entity pointer.** Ajv
  reports a `required` violation at the parent path with
  `params.missingProperty`, and `normalizeDiagnostics` (`editor.ts:426-451`)
  keeps only `code`/`path`/`message`, so the missing property never reaches the
  editor. REQ-012 therefore accepts either the entity's `/name` path or the
  entity's own pointer, which covers both hosts without changing the host
  diagnostic contract. The raw-wording exposure is recorded as out of scope
  (N7).
- **Accepted — Enter submits the project.** Every button in the editor is
  `type="button"`, so the form has no submit button and HTML implicit submission
  applies when the inline editor is the only field — a group page with zero
  rules, which is exactly the state `addGroup` produces. Became REQ-008, guarded
  in `handleSubmit` as well as on keydown, with Selenium-only coverage (AC-006).
- **Accepted — all seven `/name` focus targets die.** `this.controls` is written
  only by `renderField` (`editor.ts:3251`) and cleared each render (`:2243`).
  Became REQ-006.
- **Accepted — the rule card loses its accessible name while renaming.** Resolved
  by keeping the heading in the document, visually hidden, which also keeps
  `syncGroupEnablement`'s heading lookup (`editor.ts:2119-2121`) correct.
  Became REQ-007 and AC-010.
- **Accepted — `data-path` on the inline input would silently reintroduce live
  apply** and make Escape unimplementable. Became assumption A3.
- **Accepted — `markChanged()` clears the status message** (`editor.ts:1341`),
  so commit ordering is pinned in REQ-004 and the plan.
- **Accepted — equal names are already produced by the product**, so REQ-019 adds
  a collision-only disambiguator.
- **Accepted — sidebar names must come from the committed project**, not the
  draft, preserving the contract at `docs/architecture.md:156`. REQ-018.
- **Corrected — the dry-run contract does not need to change.** The pass is right
  that `RuleMatchResult` and `--json` should stay untouched; the better answer is
  to resolve names at each presentation site from data already in hand, so no
  public type changes at all. REQ-017, REQ-020, REQ-021.
- **Accepted as a stated limit — ids are not fully absent from the management
  page**, because Chrome's own DNR reason text renders verbatim and contains
  Chrome's numeric id. Recorded as N4 rather than promised away.
- **Reported, not fixed — the popup's `createProject` sends
  `data: { version: 1 }`** (`packages/extension/src/popup-model.ts:209`) while
  `PROJECT_VERSION` is `2` and `browser-schema.ts:597` enforces it, so popup
  project creation fails validation. The management page sends `version: 2`
  correctly (`extension-page-entry.ts:1434`). No test covers the popup path.
  Recorded as N8 for a separate fix.

### False-green risks carried into the plan

1. No existing test asserts `document.activeElement` after add, copy, move, or
   AI apply. AC-009 adds those assertions.
2. No existing test covers a `/groups/N/name` or `/…/id` diagnostic; existing
   diagnostic coverage touches only the project name. AC-011 and AC-012 add it.
3. happy-dom does not implement implicit submission, so REQ-008 can only be
   proven in `test/browser/`. AC-006 is a Selenium journey.
4. No IME composition test exists anywhere in the repository. AC-008 adds one.
5. `test/browser/extension.test.ts:893-940` currently proves id-based
   disambiguation of two equal install reasons. Rewritten naively to assert name
   text, it would pass even if two rows rendered identically. AC-018 pins the
   distinctness explicitly.
- [ ] 5 Implementation plan
- [ ] 6 Tests first
- [ ] 7 Implementation
- [ ] 8 Verification
- [ ] 9 Independent review
- [ ] 10 Documentation
- [ ] 11 Freeze, release gate, commit, push, pull request

## Evidence collected in stage 1

- `packages/schema/src/schema.ts:59,73` — `id` is required on group and rule.
- `packages/schema/src/schema.ts:13-18` — id pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$`,
  `maxIdLength` 64.
- `packages/schema/src/schema.ts:6-11` — `name` is `minLength: 1`, `maxLength:
  100`, `pattern: \S`.
- `packages/extension/src/browser-schema.ts:633-675` — group and rule ids share
  one project-wide uniqueness set.
- `packages/editor/src/editor.ts:2541-2569` — `Group details` fieldset with
  `Group ID` and `Group name`.
- `packages/editor/src/editor.ts:2780-2796` — `Common rule matcher` fieldset
  with `Rule ID` and `Rule name`.
- `packages/editor/src/editor.ts:2029` — test console prints
  `${rule.groupId}/${rule.ruleId}`; a third id surface inside the editor.
- `packages/extension/src/extension-page-entry.ts:378` — sidebar rule row text
  is `${groupId}/${ruleId}`.
- `packages/extension/src/extension-page-entry.ts:702` — install-error dialog
  identity is `${selectedError.groupId}/${selectedError.ruleId}`.
- `packages/extension/src/dnr.ts:150` — `ruleIdHash` derives the Chrome DNR rule
  id from the rule id, so renaming an id churns installed DNR rules.
- `packages/editor/src/editor.ts:1355-1365` — `allocateId` / `nextId` already
  generate collision-free ids for add and copy.
- `packages/editor/src/editor.ts:979-982` — `handleSubmit` dispatches `save`; the
  rendered content lives inside `this.form`, so Enter in a heading input needs an
  explicit `preventDefault`.
- `packages/compiler/src/types.ts:22-27` — every operation already carries
  `name`, `groupId`, and `ruleId`, so the test console can show names without a
  new cross-package lookup.
- `packages/editor/src/editor.ts:2191-2206` — `navigateToPath` focuses by exact
  control path, so a `/name` diagnostic needs a new target once the field is
  gone.
- `docs/architecture.md:210` — living statement of the editor's data surface
  ("group ID, name, and rules; and rule ID, name, …") that this change revises.
- `docs/architecture.md:156` — living statement that a sidebar rule row carries
  the identity.

## Stage 1 evidence sweep

### Surfaces that print a group or rule id to a user

- `packages/editor/src/editor.ts:2030` — test console result row prints
  `${rule.groupId}/${rule.ruleId}`.
- `packages/extension/src/extension-page-entry.ts:378` — sidebar rule link.
- `packages/extension/src/extension-page-entry.ts:702` — install-error card
  identity.
- `packages/cli/src/commands/test.ts:446` — **fourth surface, found by the
  sweep and not in the approved scope**: `rogatio test` human output prints
  `  ${rule.groupId}/${rule.ruleId}: MATCHED`. The `--json` path serializes
  `RuleMatchResult`, which carries only `groupId`/`ruleId`
  (`packages/dry-run/src/types.ts:17-25`), while every compiler operation
  already carries `name` (`packages/compiler/src/types.ts:22-27`). One additive
  `name` field on `RuleMatchResult` serves the editor test console and the CLI
  human output together.
- Deliberately unchanged: `packages/extension/src/match-format.ts:157` (the
  DevTools `[rogatio]` line, snapshotted at
  `packages/extension/test/__snapshots__/match-format.test.ts.snap:3,5,7`), the
  dashboard project `ID:` line (`extension-page-entry.ts:874`), the Chrome
  numeric DNR id inside an install reason (Chrome's id, not the project's), and
  project-id fallbacks used as display names
  (`extension-page-entry.ts:827,1035,542`).

### Tests that break

- `test/browser/editor.test.ts:138-141` — `getByLabel("Group ID")`,
  `getByLabel("Rule ID")` on the copy-group journey.
- `test/browser/sidebar-cards.test.ts:354-373` — `getByLabel("Rule name")` for
  the unsaved-draft-preserved journey.
- `packages/editor/test/editor.test.ts:594` — drives the group by writing
  `[data-path="/groups/0/id"] = "renamed-group"`. Its surviving intent is that
  the heading enable button targets the committed id, not the draft id; the
  adjacent copy-group test at `:615` already covers the draft-only case, so this
  test is rewritten or dropped rather than preserved.
- Id-as-text assertions: `test/browser/extension.test.ts:632,637,642,928-936,
  1120,1128-1130,1172-1183`, `test/browser/sidebar-cards.test.ts:461-463`,
  `test/browser/design-system.test.ts:684-686`,
  `test/browser/dnr-install-reconcile.test.ts:72-76,177,183-197`.
- Attribute-based `[data-rule-id]` / `[data-group-id]` selectors and
  `ruleAnchorId` element ids stay valid; only their visible text changes.
- `test/browser/editor.test.ts:546-548` locates a rule card by `h3` text, so the
  inline editor must not change the non-editing heading text.

### Diagnostics gap

The browser fixture already emits `/groups/{i}/name` and
`/groups/{i}/rules/{j}/name` diagnostics
(`test/fixtures/editor-fixture.html:98-119`), but no test asserts what the
editor does with them: existing coverage touches only the project name
(`test/browser/editor.test.ts:175-213`, `packages/editor/test/editor.test.ts:
512-523`). After the fields are removed, `renderField` can no longer attach
`aria-invalid`/`aria-describedby` for those paths, and `navigateToPath`
(`editor.ts:2191`) can no longer focus them. New coverage is required.

### Styling and build constraints

- Heading rows are already flex rows with `justify-content: space-between`:
  `packages/editor/src/editor.css:382-400`; rule actions `:461-470`; mobile
  `:588-596`. The inline editor needs styles in that row, not a new file.
- Icon-only button precedent: `.rogatio-copy-icon`
  (`packages/extension/src/extension.css:414-422`) — fixed square, mono font,
  accessible name from `aria-label` plus `title`. Glyphs already in use: `+`,
  `↥`, `✦`, `×`, `✓`, `✗`, `⧉`. No pencil glyph exists yet.
- `data-btn` values in use are `primary`, `secondary`, `danger` only;
  `docs/architecture.md:151` names `inverted`/`outlined`/`ghost`, which have no
  CSS. Do not introduce a new variant for this change.
- `scripts/validate.ts:380-419` audits the editor browser bundle and scans
  `packages/editor/src/{index,types,url,editor}.ts` by exact filename. New
  editor source files escape that scan, so the inline rename logic stays in
  `editor.ts`.
- `scripts/validate.ts:55-79` asserts an exact 18-entry build manifest, so no new
  build artifact may be added; `editor.css` is edited in place.
- `pnpm validate` runs format:check, lint, typecheck, build, vitest
  (unit + integration), artifact/module/boundary checks, three negative
  typecheck fixtures, and then the full browser suite
  (`scripts/validate.ts:421-442`). The browser suite needs Chrome for Testing
  via `pnpm browser:install` or `ROGATIO_CHROME_PATH`.

### Documentation to update (living only)

`docs/architecture.md:210` (editor data surface), `:224` (entity actions beside
the group name), `:156` (sidebar rule row identity). Frozen records under
`docs/specs/`, `docs/plans/`, `docs/workflows/` — including
`docs/specs/f5-editor.md:33-34`,
`docs/plans/editor-button-label-names.md:14,21`, and
`docs/workflows/sidebar-cards-workflow.md:141-143` — are decision history and
are not edited. `docs/plans/editor-button-label-names.md:14` already records the
`aria-labelledby`-to-`h3` decision as deliberately independent of editable id
strings, which supports the inline rename design.

## Open questions for the human gate

1. Whitespace on commit: trim leading and trailing whitespace, or preserve it
   and only reject an all-whitespace value.
2. Where a `/name` diagnostic lands: open the inline rename editor on the
   offending entity, or only land on the owning group with the error announced
   in the status line.
3. Whether `rogatio test` human output is in scope for this feature, given that
   the sweep found it as a fourth id-printing surface outside the approved
   scope. Ids stay in `--json` either way, because that is a machine contract.
4. Whether the inline editor keeps the heading in the DOM (visually replaced,
   `aria-labelledby` preserved) or removes it and repoints the rule card's
   accessible name at the input.
5. Issue number for the release commit; no open issue currently matches.
