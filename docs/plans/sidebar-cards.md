# Sidebar cards — architecture note and plan

Issue: #242. Closes the sidebar half of the original request.
Part B (AI provider and model in the card) is issue #241 and is deliberately out of scope here.

Feature worktree: `~/Projects/github/drmaas/temp/rogatio-sidebar-cards`
Branch: `feature/sidebar-cards` · Base: `850e5f4` · Issues: #242 (this work), #241 (deferred)

## Architecture note

Only the non-obvious parts.

**The editor owns its DOM id contract.** `ruleAnchorId(groupId, ruleId)` is exported from
`@rogatio/editor` so the extension never re-derives the format. This is the same shape as
`urlToExactRegex`, already exported for a host that needs an editor-internal contract. Today
the format is written out in three places and collides; centralizing it is the fix, not a
refactor.

The id becomes `rogatio-rule-${encodeURIComponent(groupId)}:${encodeURIComponent(ruleId)}`.
The schema id pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$` cannot contain `:`, and `encodeURIComponent`
never emits a raw `:`, so the join is injective for arbitrary strings. That matters because
the sidebar builds links from `state.ruleStatuses`, which is committed storage and not
guaranteed schema-valid, while the editor renders a validated draft. Both sides encode.

**One navigation mechanism.** The product already deep-links by URL: `groupUrl()` builds
`index.html?group=<id>`, read at load and consumed on the editor. Rule links extend that
mechanism rather than introducing a second, in-page-only one. As a result link semantics, the
Back button, ctrl-click into a new tab, and a future popup-to-rule link all fall out of the
same resolver instead of needing separate mechanisms.

**Draft ownership is a hard rule.** `renderShell()` is the only function permitted to destroy
the mounted editor. Every sidebar state change goes through `patchWorkspaceEnablementChrome`,
which replaces just the sidebar. Rule navigation is a sidebar state change, so it follows that
rule. This is the blocker the adversarial pass surfaced: today's rule-error handler calls
`renderShell()`, and generalizing that path to every rule would discard unsaved work on every
click.

**The status projection stays presentation-free.** Sidebar entries keep `groupId/ruleId`.
`ruleStatuses` is an install-status projection and is not widened for layout reasons.

**Rejected alternatives**

- `href="#…"` with `preventDefault` — the target does not exist until after navigation, so the
  fragment is a lie; `preventDefault` then breaks Back, copy-link, and ctrl-click, and nothing
  in the repo reads a hash.
- Button styled as a link — leaves the sidebar navigating by button while the popup navigates by
  URL. That split is what breaks later, and it contradicts the request for links.
- `aria-disabled` anchor that keeps a real `href` — still navigates when activated.
- Re-reading `project.data` for a rule display name — couples the projection to the project
  document, creates a second source of truth for rule identity, and needs a per-id fallback.
- Length-prefixed anchor ids — injective but opaque in devtools. The `:` join is equally
  injective and readable.
- Keeping `-` in the anchor id and relying on document order — already broken today.

**Security.** This change adds no secret to the management page. Provider metadata and its
never-cross-the-key rule belong to #241.

## Plan

Ordered. Each task names its files, the behavior it adds, and the proof.

1. **Editor: injective rule anchor id and a shared reveal helper.**
   `packages/editor/src/editor.ts`, `packages/editor/src/types.ts`,
   `packages/editor/src/index.ts`.
   Export `ruleAnchorId`; replace the two hand-written format strings at editor.ts:2122 and
   editor.ts:2655. Extract the scroll-plus-focus block out of `navigateToSearchResult` into a
   private `revealRuleCard` that skips `behavior: "smooth"` under
   `prefers-reduced-motion: reduce`. Add public `navigateToRule(groupId, ruleId)` to
   `EditorController`: resolve against the **draft**, navigate the route to the owning group,
   render, then reveal; fall back to group-only navigation when the rule is absent; never
   throw on a missing group or rule.
   Covers AC-006, AC-018, AC-020. Proof: editor unit tests for anchor injectivity, route and
   focus after `navigateToRule`, missing rule, missing group, reduced motion.

2. **Extension: one rule deep-link resolver.**
   `packages/extension/src/extension-page-entry.ts`.
   Read `rule` next to the existing `group` at :1604. A single `resolveRuleDeepLink()` serves
   initial load (:1095), a new `popstate` listener, and in-page activation. In-page activation
   calls `preventDefault()`, `history.pushState`, then `patchWorkspaceEnablementChrome()`
   followed by `editor.navigateToRule(...)`. It must never call `renderShell()`. `popstate`
   re-resolves and replaces only the sidebar, falling back to `renderShell()` when the active
   project changed.
   Covers AC-006, AC-014. Proof: browser journeys for click navigation, Back after navigation,
   and dirty-draft survival.

3. **Extension: sidebar card structure.**
   `packages/extension/src/extension-page-entry.ts`.
   Add a `createSidebarCard(heading, tone)` helper producing
   `section.rogatio-sidebar-card > h2.rogatio-sidebar-card-heading + div.rogatio-sidebar-card-body`
   with a status dot driven by one `data-tone` attribute instead of per-status class names.
   Runtime card takes start/stop, `data-native-runtime-state`, the `data-extension-id` row with
   its copy button, and the diagnostics button plus `data-runtime-error` only when the phase is
   `failed` or `unsupported`. AI card takes `data-ai-status` with its text unchanged. Rules card
   takes the `data-rule-statuses` list as anchors built with `ruleAnchorId`, each carrying
   `data-rule-link`, `data-group-id`, and `data-rule-id`, with the status as a right-aligned
   monospace token named by `aria-describedby`, plus `data-match-logging-toggle` moved in. The
   attention note and the rule error card stay where they are relative to the cards today. Group
   enablement is not in the sidebar; see the addendum.
   Covers AC-001 to AC-004, AC-007 to AC-009, AC-021, AC-024. Proof: browser journeys.

4. **Project card affordance.**
   `packages/extension/src/extension-page-entry.ts`, `packages/extension/src/extension.css`.
   The sidebar project card takes `rogatio-sidebar-project-card` instead of the shared
   `.rogatio-project-card`, keeping `data-active-project-card`. Dashboard cards keep the shared
   interactive class, so activating a project from the dashboard is unchanged.
   Covers AC-005, AC-022. Proof: browser journeys asserting the sidebar card is inert and the
   dashboard card still activates.

5. **Stylesheet.**
   `packages/extension/src/extension.css`.
   Card surface, heading, status dot, the two-column rule row with a right-aligned monospace
   status token, and list density. A forced-colors entry in the existing block at :755. Sidebar
   project card reset. Narrow-viewport rules at the 48rem and 64rem breakpoints so the rule row
   does not overflow at 360px — the sidebar has no narrow-viewport coverage today.
   Covers AC-019, and the styling half of AC-005 and AC-017. Proof: browser journey at a 360px
   viewport on the management page at both breakpoints.

6. **Focus retention across sidebar re-render.**
   `packages/extension/src/extension-page-entry.ts`.
   `patchWorkspaceEnablementChrome` records the focused element's identifying `data-*` hook
   before replacing the sidebar and restores focus afterwards, so a group toggle or soft refresh
   no longer drops focus to `<body>`. No accessibility harness exists in the repo, so the
   assertion is hand-written.
   Covers AC-016. Proof: browser journey asserting focus survives a soft refresh.

7. **Durable docs.**
   `docs/architecture.md` (sidebar layout description), the docs-site extension guide and
   reference (both currently say the Match logging checkbox is "in the management sidebar"),
   and a `> Superseded by:` footer on the frozen F22 record whose F22-REQ-005d this change
   extends.
   Covers AC-023. Proof: `pnpm validate` and the docs build.

## Plan addendum

Post-review corrections, appended rather than edited in place.

- **Task 3 reversed the inert rendering of unresolved rules.** Every rule row is now always a
  real deep link; `navigateToRule` resolves against the draft and lands on the owning group when
  the rule is gone. A non-navigable entry broke the existing, tested behavior where an errored
  rule absent from the project can still be selected to read its install reason. See AC-024 /
  AC-025 in `notes.md`.
- **Task 2 gained a modifier guard.** An unconditional `preventDefault()` is what made the
  rejected `href="#…"` design un-link-like, so the replacement must not repeat it. Only a plain
  primary click is intercepted; ctrl, cmd, shift, alt, and middle clicks keep their native
  meaning.
- **Task 2's mount behavior is navigation-aware.** Only the first mount reveals and focuses a
  rule. A rebuild re-applies the route from the URL but not the reveal, so a group toggle no
  longer scrolls the user back to a rule they had moved away from.
- **Task 6 covers both rebuild paths.** `shouldRemountEditorAfterGroupEnablement` returns true
  for a clean editor, so a group toggle takes the full `renderShell()` path. Focus capture and
  restore are applied to both, and restoration uses `preventScroll` so it cannot move the
  viewport.
- **Task 3 gained one shared id fallback constant** for malformed status entries, so the row,
  the error lookup, and the error card cannot disagree about an entry's identity.
- **Task 5 ships a 64rem rule** and a 26rem stack, which is what AC-017 now names.

Rebased onto #240, which moved group enablement out of the sidebar and into a button on the open
group's heading. Three consequences:

- Task 3 no longer creates a group activation fieldset. The sidebar shows status and navigation;
  enablement has a single home, and duplicating it in two places is the problem #240 was closing.
- Task 6's `FOCUSABLE_HOOKS` drops `groupToggle`, which no sidebar control carries. Focus capture
  still covers the rule links, command buttons, and the Match logging checkbox, and restore uses
  `preventScroll`.
- The "only the first mount reveals" rule is now defence in depth rather than a fix for a live
  path, since enablement no longer remounts the editor. It is kept because tab switches, project
  switches, and plain refresh all do, and none of those should re-run a reveal.

## Verification

`pnpm validate` after implementation and after any later fix. The browser journeys are the real
gate for this change; unit tests cover the anchor id and the navigation contract.

## Model selection

Single-model harness. The adversarial pass used a fresh-context subagent with no access to the
prior reasoning, which supplies the independence the role split intends. Recorded as a fallback
rather than a silent substitution.

> Status: frozen 2026-09-27
