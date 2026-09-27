# Sidebar cards — behavioral notes

Feature worktree: `~/Projects/github/drmaas/temp/rogatio-sidebar-cards`, branch
`feature/sidebar-cards`, base `850e5f4`.

## Requested outcome

Reorganize the extension management page left nav into separate cards for runtime, AI, and
rules. Each rule becomes an anchor link to its section. Match logging moves into the rules
card. The project name card at the top of the left nav must stop behaving like a link.

Affected users: operators managing a project in the Chrome extension management page.

## What the code does today

- `packages/extension/src/extension-page-entry.ts:363-560` — `createSidebar()` appends 11
  loose siblings to one `<aside class="rogatio-sidebar">`: project card, group activation
  fieldset, start/stop buttons, match logging toggle, runtime status, diagnostics button, AI
  status, extension ID row, runtime error, attention note, flat rule status list, rule error
  card.
- Sidebar project card is a `<div>` (`extension-page-entry.ts:371`). The shared
  `.rogatio-project-card` rule (`packages/extension/src/extension.css:472-488`) sets
  `cursor: pointer`, and `:502-505` adds a hover border. Dashboard project cards really are
  interactive buttons (`extension-page-entry.ts:996` handles `[data-project-card]`), so the
  shared class leaks a dead pointer affordance into the sidebar. No link exists to remove.
- Rule anchor logic already exists twice, separately:
  `packages/editor/src/editor.ts:2103-2129` (`navigateToSearchResult`, private) and
  `packages/extension/src/extension-page-entry.ts:921-928` (inline in the click handler).
  Both do: set route to group, render, `scrollIntoView`, `focus`.
- Editor renders one route at a time (`packages/editor/src/editor.ts:2192-2198`), so a rule
  card exists in the DOM only while its group is the active route. A plain `#fragment` jump
  cannot reach a rule in a non-rendered group.
- Rule card anchor id is `rogatio-rule-${groupId}-${ruleId}` (`packages/editor/src/editor.ts:2654`).
- AI provider/model is not reachable from the extension. `check-ai-support` is a ping probe
  returning a boolean (`packages/extension/src/native-session.ts:467-491`). Provider config
  is Node-side (`packages/runtime/src/ai-config.ts`). The wire protocol carries only
  `ai.complete | ai.stream.chunk | ai.error` (`packages/runtime/src/types.ts:315-317`).

## Constraints and invariants

- Editor stays framework-free and browser-safe: no `node:` imports, no Ajv in the browser
  bundle. Hosts supply validation through ports.
- `Match logging` accessible name and `chrome.storage.local` key are pinned by
  `docs/adrs/0004-match-logging-toggle-storage.md` and asserted in
  `test/browser/match-logging-toggle.test.ts`.
- F22 design system is the established visual language
  (`docs/specs/f22-design-system.md`): dark palette, mono uppercase micro-headers,
  `--rogatio-radius` cards. This change applies that system, it does not invent a new one.
- Package boundaries: extension owns Chrome API adapters; runtime owns the native host.

## Non-goals

- No new settings UI, no AI config editing in the page, no file pickers.
- No new navigation destinations, no History tab.
- No framework, dependency, telemetry, storage-key, or CSP change.
- No change to rule install, matching, or status computation.

## Acceptance checks

- **AC-001** Sidebar renders runtime, AI, and rules cards, in that order, after the project
  card and group activation.
- **AC-002** Runtime card holds Start runtime, Stop runtime, the runtime status line, the
  extension ID with its copy button, and — only when the phase is `failed` or `unsupported` —
  Show diagnostics and the runtime error line.
- **AC-003** AI card holds the AI status line only in part A.
- **AC-004** Rules card holds one entry per rule, each an anchor link to that rule's section,
  plus the Match logging checkbox.
- **AC-005** The sidebar project card is inert: no pointer cursor, no hover affordance, not
  focusable, no click behavior. Dashboard project cards stay interactive.
- **AC-006** Activating a rule link navigates the editor to the owning group, scrolls the rule
  card into view, and focuses it. Works for rules in groups that are not the active route.
- **AC-007** A rule whose status is `error` still selects that rule and shows the rule error
  card, through the same link affordance.
- **AC-008** Group activation, the attention note, and the rule error card keep working.
- **AC-009** The `Match logging` checkbox keeps its accessible name and its independent
  storage behavior.
- **AC-010** No API key or secret ever reaches the management page DOM.
- **AC-011** *(deferred to #241)* The native host reports AI provider URL and model when
  configured, and never the API key.
- **AC-012** *(deferred to #241)* The AI card shows provider and model when the host reports
  them, and falls back to status only when it does not.
- **AC-013** *(deferred to #241)* A host that does not report the new AI fields produces "not
  reported", not an error state and not a broken card.

AC-011 to AC-013 belong to issue #241 and are not satisfiable in this branch. This branch
delivers the AI card with status only, which is what the scope split agreed.

## Design direction

Subject: an operator console for a browser rule engine. The material world is an instrument
rack, not a settings dialog. The sidebar becomes three status modules with a status dot in each
card header, so the eye reads state before it reads controls.

Signature: in the rules card, the rule name is a link and the status is a right-aligned
monospace token. Status reads as a meter value rather than a sentence, so the odd one out is
scannable in one pass. Everything else stays quiet — no new typography, no new palette, no
icon set. The only real risk taken is that right-aligned status column.

## Open decisions

- **Q1** Rule entry shape. Original recommendation (`<a href="#rogatio-rule-…">` plus
  `preventDefault`) was **rejected by the adversarial pass and is withdrawn.** The editor
  renders one route at a time, so the fragment target does not exist until after navigation;
  `preventDefault` then breaks Back, copy-link, and ctrl-click, and nothing in `packages/` or
  `test/` reads a hash. Revised recommendation: extend the existing deep-link convention
  (`groupUrl()`, `popup-model.ts:86-88`; read at `extension-page-entry.ts:1604`; consumed at
  `:1095`) with a `rule` parameter, and add one shared resolver used by initial load,
  `popstate`, and in-page activation.
- **Q2** Rule entry label. Recommendation: keep `groupId/ruleId`. `ruleStatuses` is an
  install-status projection that deliberately carries no presentation data; reaching back
  into untrusted `project.data` for a display name couples the projection to the project
  document and creates a second source of truth for rule identity.

## Blockers found by the adversarial pass

- **B1** `renderShell()` (`extension-page-entry.ts:829-832`) calls `editor?.destroy()` and
  `root.replaceChildren()`. The rule-error click handler (`:913-931`) calls it, so today's
  destructive path is reachable only from error rules. Making every rule navigable exposes
  it to every click and destroys unsaved drafts. Rule navigation must replace only the
  sidebar, following `patchWorkspaceEnablementChrome` (`:567-574`).
- **B2** `href="#…"` cannot be truthful. Withdrawn, see Q1.
- **B3** Part B is a cross-package protocol feature, not a sidebar detail:
  `check-ai-support` is extension-internal (`protocol.ts:26,62`) and its response is
  synthesized by the service worker (`service-worker.ts:407-421`) from a boolean; the probe
  (`native-session.ts:467-491`) issues a real `ai.complete` with `model: "test"`, and
  `lifecycle.ts:686` prefers `meta.model`, so the configured model is never exercised.
  `aiProviderConfig` is read once at host launch (`cli/src/commands/runtime.ts:290,358`) and
  captured at `lifecycle.ts:155-157`, so "if configured" carries a host-restart precondition.

## Scope decision

Part A ships here. Part B moves to its own issue and its own `sdd` feature, because it changes
the extension-to-runtime wire protocol (three registries: `runtime/src/types.ts:294-317`,
`envelope.ts:33`, `native-framing.ts:17`) and carries an unanswered design question about
launch-time-only provider config. Sharing a revert unit with a sidebar DOM change is the wrong
coupling.

## Additional acceptance checks (added from the adversarial pass)

- **AC-014** Rule navigation never calls `renderShell()`. A dirty editor draft survives
  activating a rule link.
- **AC-015** The `data-*` attributes required by F22-REQ-005d are preserved:
  `data-active-project-card`, `data-group-activation`, `data-group-toggle`, `data-command`,
  `data-native-runtime-state`, `data-extension-id`, `data-ai-status`,
  `data-match-logging-toggle`, `data-rule-statuses`, `data-rule-error-card`,
  `data-runtime-error`.
- **AC-016** After a sidebar-only re-render (group toggle, soft refresh, rule navigation),
  focus returns to the equivalent control instead of falling to `<body>`.
- **AC-017** The sidebar stays usable at a 360px viewport. The sidebar has no narrow-viewport
  coverage today. The rules row is a two-column grid that stacks below 26rem, and the identity
  gets an explicit wrap budget between 64rem and 26rem.
- **AC-026** The sidebar does not reintroduce a group enablement switcher. Group enable/disable
  lives on the open group's heading via `EditorOptions.groupEnablement` (#240); the sidebar shows
  status and navigation, not a second enablement control.
- **AC-018** Smooth rule scrolling is skipped under `prefers-reduced-motion: reduce`. The
  CSS `scroll-behavior` rule does not cover an explicit JS `behavior` argument.
- **AC-019** The new sidebar card class has a forced-colors entry, alongside the existing
  blocks at `extension.css:669,728,755`.
- **AC-020** The rule anchor id is injective. `rogatio-rule-${groupId}-${ruleId}` is not:
  group `a-b` + rule `c` and group `a` + rule `b-c` both yield `rogatio-rule-a-b-c`, and
  `getElementById` returns the first. Join the two ids with a character the schema id
  pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$` cannot produce.
- **AC-021** The AI status tone classes (`rogatio-ai-ready`, `rogatio-ai-needs-runtime`,
  `rogatio-ai-not-configured`) drive a real status dot instead of being dead class names.
- **AC-022** The sidebar project card uses a sidebar-specific class so the interactive
  `.rogatio-project-card:hover` rule (specificity 0,3,0) cannot re-apply a hover affordance
  that a lower-specificity reset cannot remove.
- **AC-023** Durable docs match the shipped layout: `docs/architecture.md`,
  `packages/docs-site` extension guide and reference (which place the Match logging checkbox
  "in the management sidebar"), and a `> Superseded by:` footer on the frozen F22 record.
- **AC-024 — REVERSED, superseded by AC-025.** This check required a rule that is not in the
  draft to render "as a non-interactive entry with an explicit unsaved state, not a link that
  silently does nothing". Implementation showed that breaks a real, already-tested behavior: an
  errored rule can be absent from the project while its install reason is still the most useful
  thing on screen, and the error card is how you read it. A non-navigable element is also the
  wrong shape for a control advertised as a link. Replaced by AC-025.
- **AC-025** Every rule row is a real deep link, always, including a rule that is no longer in
  the draft. `navigateToRule` resolves against the draft and lands on the owning group when the
  rule itself is gone, so activating it reaches a real destination rather than failing.

> Status: frozen 2026-09-27
