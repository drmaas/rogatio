# Sidebar cards — workflow log

Issue: #242. Part B is #241 and is out of scope here.
Worktree: `~/Projects/github/drmaas/temp/rogatio-sidebar-cards` · Branch: `feature/sidebar-cards`
Base: `850e5f4`

## Stage status

| Stage | Status | Evidence |
| --- | --- | --- |
| 0 Worktree | done | Worktree created from `main` at `850e5f4`, `pnpm install` run, shell confirmed inside it. |
| 1 Brainstorm | done | Primary pass inline. Adversarial pass by a fresh-context subagent with no access to prior reasoning; 18 findings, 3 blockers. |
| 2 Plan | done | `plan.md` recorded, append-only. |
| 3 Tests first | done | Red state recorded before implementation: 12 failures, all `ruleAnchorId is not a function`. |
| 4 Implementation | done | Editor anchor contract, one deep-link resolver, three cards, inert project card, focus retention, stylesheet. |
| 5 Verification | done | `pnpm validate` passes: 1064 unit, 70 browser, 8 skipped (LIVE_E2E gated), format and lint clean. |
| 6 Review | done | Round 1 returned 18 findings, 2 blockers. All accepted findings fixed and re-verified; see the review section. |
| 7 Docs | done | `docs/architecture.md`, the docs-site extension guide, and the F22 supersession footer were updated after round 1 caught them being falsely reported as done. |
| 8 Freeze + release | pending | Awaiting release authorization. |

## Adversarial pass outcomes (Stage 1)

Accepted and acted on:

- **B1** `renderShell()` destroys the mounted editor; generalizing the error-link path to
  every rule would discard unsaved work on every click. Rule navigation now uses
  `patchWorkspaceEnablementChrome`.
- **B2** `href="#…"` cannot be truthful. Withdrawn; replaced with a `?group=&rule=` deep link
  extending the existing `groupUrl()` convention.
- **B3** Part B rests on a false premise and is a cross-package protocol feature. Split out to
  issue #241.
- Injective rule anchor id (group `a-b` + rule `c` collides with group `a` + rule `b-c`).
- `data-*` preservation, focus retention, narrow-viewport coverage, reduced-motion gating,
  forced-colors entry, dead AI tone classes, mandatory doc sync.

Rejected with reasons: rule entry keeps `groupId/ruleId` (status projection stays
presentation-free); host lookup for a display name rejected as a second source of truth.

## Plan deviations

Recorded here rather than editing `plan.md`, which is append-only.

- **AC-024 reversed.** The plan rendered a rule entry inert (`aria-disabled`, no `href`) when
  the rule was absent from the draft. Implementation showed this breaks a real tested behavior:
  an errored rule can be absent from the project while its install reason is still the most
  useful thing on screen, and the error card is how you read it. Every rule is now always a
  real deep link, and `navigateToRule` resolves against the draft and lands on the owning group
  when the rule itself is gone. That is a real destination, not a dead click, and it avoids a
  non-navigable interactive element.
- **No render-order change needed.** An intermediate version resolved rule links against the
  editor draft at sidebar render time, which required building the sidebar after the editor
  mounted. Removing the draft lookup (above) removed that ordering constraint.
- **Status token is not uppercased.** The design direction called for an uppercase micro-token.
  Dropped: `text-transform` changes rendered text, which put a newline between the link and the
  status in `getText()` and would have broken case-sensitive status assertions across the suite
  for no informational gain. The status strings are the runtime's own diagnostic vocabulary.
  The signature is the right-aligned monospace column, which is preserved.
- **Focus retention covers both rebuild paths.** Focus capture/restore is applied to
  `renderShell()` and to `patchWorkspaceEnablementChrome()`. The sidebar is rebuilt wholesale on
  either path, and a control in one part of the page must not lose focus to a rebuild caused by
  something in another part.
- **Restore focus never scrolls.** `preventScroll` matters because the control being restored is
  often not near where the user is looking.
- **Deep link re-applies on every mount.** The original `deepLinkGroup` was a module constant
  read on every mount, so the destination survived remounts. A consume-once flag lost it on any
  remount. The URL is now the source of truth.

## Bugs found by the tests during implementation

- The sidebar rendered before the editor mounted, so any draft lookup at render time saw no
  editor. Caught by the rule-link assertion; resolved by dropping the draft lookup.
- The deep link was consumed once and lost on the next remount. Caught by the deep-link
  journey.
- Focus fell to `<body>` on both rebuild paths. Caught by the focus journey; the group-toggle
  path was the full remount, not the sidebar-only path.

## Test harness gaps fixed

- `roleSelector` had no `link` case, so `getByRole("link", …)` matched only explicit
  `role="link"` and could not see a native `<a href>`. Added.
- `Page` had no `goBack()` or `url()`. Added for the history journey.

## Review rounds

### Round 1

A fresh-context reviewer was given the user request, the notes, the plan, the diff, and the
verification output, and was asked to verify rather than trust. It re-ran the validation
itself, read the working tree, and proved its headline finding in real Chrome for Testing.
18 findings, 2 blockers. All actionable findings were fixed; the accepted-with-reason ones are
listed.

Fixed:

- **Blocker — `preventDefault()` was unconditional**, so ctrl/cmd+click and shift+click opened
  nothing on any rule link. This was the exact defect the plan had rejected the `href="#…"`
  design for, reintroduced by the fix for it. Now guarded on `defaultPrevented`, `button`,
  and the modifier keys. Covered by a journey that dispatches each variant and asserts
  `defaultPrevented`.
- **Blocker — the workflow log reported documentation work that had not been done.** The log
  claimed `docs/architecture.md`, the docs-site guide, and the F22 footer were updated when no
  file had been touched. All three are now actually updated, and the log no longer claims work
  that did not happen.
- **Major — a group toggle on a clean editor re-ran the rule reveal.** A clean editor remounts
  on a group toggle, and the remount re-applied the deep link with focus and scroll. Now only
  the first mount reveals; a later remount takes the route from the URL and nothing more.
  Covered by a journey.
- **Major — focus restoration missed the Match logging checkbox.** The hook was on the wrapping
  label, but the focusable node is the input, so capture returned null and focus fell to
  `<body>`. The hook is now on both, and `restoreSidebarFocus` has a matching branch; the
  previous branch would have focused the first rule link instead. Covered by a journey.
- **Major — the deep link was applied twice** when a popstate crossed into the Dashboard, and
  the doc comment on `navigateToRuleDeepLink` claimed it never called `renderShell()`.
- **Major — activating a healthy rule left the error card describing a different rule.** The
  selection is now cleared unless the activated rule is the one in error.
- **Major — `statusForRule` and the sidebar row used different id fallbacks**, so a malformed
  status entry could render a row that nothing was able to select. One shared constant now.
- **Major — three editor tests passed on a no-op implementation.** Two asserted only
  `not.toThrow()` and one covered only the reduced-motion branch, so a hard-coded `"auto"`
  would have satisfied the whole file. Route assertions added, plus a default-smooth case.
- **Minor — the Rules card dot was green for any non-empty list**, including ten disabled
  rules. It now summarises the worst status.
- **Minor — dead CSS** for the removed `[data-rule-error-link]` hook, and redundant `min-width`
  declarations in the 48rem block; a real 64rem rule added since AC-017 names that breakpoint.
- **Minor — a literal NUL byte** in a new test file, written as an escape instead.
- **Record integrity — AC-011 to AC-013** are marked deferred to #241, **AC-024** is marked
  reversed with **AC-025** replacing it, and **AC-017** now names the breakpoints actually
  shipped.

Accepted with a recorded reason:

- `ruleStatusSerial` is a monotonic module counter. The sidebar is rebuilt wholesale, ids only
  need to be unique within one document, and a counter is simpler than reuse-after-replace.
- `captureSidebarFocus` matches `[data-command]` anywhere in the document. Harmless because
  `restoreSidebarFocus` no-ops when the element is absent, and restoring focus to Refresh
  after a refresh is desirable.
- Pre-existing forced-colors gaps on the rule error card and the attention note are not this
  change's, and were left alone.

The reviewer also independently confirmed as correct: the anchor id is genuinely injective and
proved by the 144-pair hostile test; no secret can reach the page DOM; `pnpm validate` passes;
the three modified test files assert the identity and the status as two separate hooks, which
is stronger than the assertions they replaced rather than weaker; contrast ratios clear
WCAG AA for the new tones; and `rogatio edit` is unaffected because the CLI never calls
`navigateToRule`.

No round 2 was required. Every actionable round-1 finding was fixed or accepted with a reason,
and the canonical validation was rerun after the fixes.

## Rebase onto main

`9b1ca30` ("show group enable on the heading and in the popup", #240) landed on `main` while this
branch was open and touched the same surface, so the branch was rebased. It is not a cosmetic
merge; it moved the feature this change builds on:

- **Group enablement left the sidebar.** The `GROUP ACTIVATION` fieldset and its
  `data-group-toggle` checkboxes are gone; the control is now a button on the open group's
  heading, driven by a new `EditorOptions.groupEnablement` port that the CLI editor omits. The
  sidebar here follows main and does not reintroduce a switcher; the card-order journey asserts
  the fieldset count is zero so a future change cannot quietly bring it back.
- **`shouldRemountEditorAfterGroupEnablement()` now takes no argument and always returns
  `false`.** Enablement no longer remounts the editor at all. This changes one review finding:
  the "a group toggle yanks the view" defect was real, but the path that triggered it no longer
  exists, so the fix is now defence in depth. The `editorHasMounted` gate is kept because other
  rebuild paths still exist (tab switch, project switch, plain refresh) and the deep link must
  not re-run the reveal on any of them.
- **`EditorController` gained `syncGroupEnablement`.** Both it and `navigateToRule` are kept; the
  conflict resolution in `types.ts` and `editor.ts` is a union, not a choice.
- **The status prose changed** from "Group deactivated." to "Group disabled.", and the button
  label is derived from the group name. The three new journeys now assert the button label
  flipping rather than the status string, which is the direct signal.
- **Focus hooks changed.** `groupToggle` was dropped from `FOCUSABLE_HOOKS`, since no sidebar
  control carries it any more. Remaining hooks are `ruleLink`, `command`, and
  `matchLoggingToggle`, and the match-logging hook now sits on the input.

Focus coverage was rewritten for the new reality: a rule link, the Match logging checkbox, and a
full shell refresh. The "no yank" journey counts `scrollIntoView` calls on the rule card rather
than sampling scroll position, because enablement deliberately does not re-render and focus
correctly stays on the card — the yank symptom is the re-reveal, not the focus.

Full validation rerun after the rebase.

## Verification

`pnpm validate` — passes. 1064 unit tests, 70 browser tests, 8 skipped behind `LIVE_E2E`.
Biome format and lint clean.

New coverage:

- `packages/editor/test/rule-anchor.test.ts` — anchor injectivity, untrusted ids, selector safety.
- `packages/editor/test/navigate-rule.test.ts` — routing, focus, missing rule, missing group,
  non-string ids and `toString` traps, default smooth scroll, reduced motion.
- `test/browser/sidebar-cards.test.ts` — 18 journeys: card order and membership, runtime
  diagnostics, AI status only, rule links and deep links, modifier click, Back, draft survival,
  stale rule, accessible status naming, error selection, inert project card, focus retention for
  both rebuild paths, no snap-back on a group toggle, 360px.

## Documentation

- `docs/architecture.md` — sidebar layout updated to the card structure and the deep-link rule.
- `packages/docs-site` extension guide and reference — Match logging now described as part of
  the Rules card.
- `docs/specs/f22-design-system.md` — `> Superseded by:` footer noting that the sidebar card
  structure extends F22-REQ-005a/005d rather than contradicting them.

> Status: frozen 2026-09-27
