# Checklist — Header rule status errors

Feature: `header-rule-status-errors`
Plan: `docs/decisions/header-rule-status-errors/plan.md`
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/header-rule-status-errors`

All edits happen in the worktree. Each phase ends at a human gate.

## Phase 1 — Establish the real Chrome rejection (evidence only)

- [x] 1. Build the extension in the worktree (`pnpm build`) and confirm `packages/extension/dist` exists so a real-Chromium context can load it.
- [x] 2. Add a real-extension Playwright spec under `test/browser/` that launches a persistent context with the built extension, following the harness at `test/browser/extension-real.spec.ts:7-25`; use test-unique numeric rule ids and remove probe rules in `finally`.
- [x] 3. In that spec, call `chrome.declarativeNetRequest.updateDynamicRules` from an extension page with the exact object literal `toDnrRule` currently produces for `rule-header-set` (request direction, `responseHeaders: []`) and record accept or reject.
- [x] 4. Repeat for `rule-header-remove` (response direction, `requestHeaders: []`, no `value` on the action), including the `condition` keys currently emitted with `undefined`; verify cleanup on acceptance and rejection paths.
- [x] 5. Record each outcome and any rejection message verbatim in `docs/decisions/header-rule-status-errors/workflow.md`; do not assert on the wording. **Gate:** if Chrome accepted the current shape, stop and re-scope Phase 2.

## Phase 2 — Fix the emitted DNR shape and pin the error payload

- [ ] 6. Convert the Phase 1 probe into a failing regression assertion that real Chromium accepts the corrected shape for both sample header rules, retaining `finally` cleanup.
- [ ] 7. Write a failing unit test: a request-direction projection yields a rule with no `responseHeaders` key and a populated `requestHeaders` entry.
- [ ] 8. Write a failing unit test: a response-direction `remove` projection yields no `requestHeaders` key, and its header action has no `value` key.
- [ ] 9. Write a failing unit test: a projection with no resource types, no origins, and no method yields a `condition` whose only key is `regexFilter`.
- [ ] 10. Write a service-worker test: a thrown `updateDynamicRules` error surfaces as `status: "error"` with `diagnostics[0].code === "extension.dnr-error"` and `params.reason` equal to the thrown message.
- [ ] 11. Write a service-worker test: a non-`Error` rejection yields the stable fallback message `Failed to install header rule` in `params.reason`.
- [ ] 12. Make `DnrHeaderRule.action.requestHeaders` and `action.responseHeaders` optional in `packages/extension/src/installer.ts`.
- [ ] 13. Emit only the direction-matching header list in `toDnrRule`, using the conditional-spread idiom already used at `packages/extension/src/installer.ts:90`.
- [ ] 14. Omit `resourceTypes`, `initiatorDomains`, `excludedInitiatorDomains`, and `requestMethods` from `condition` instead of assigning `undefined`.
- [ ] 15. Confirm the existing header-status coverage at `packages/extension/test/permission-grant.test.ts:212-329` still reports both header rules `active`; run `pnpm exec vitest run` and `pnpm test:browser`. **Gate.**

## Phase 3 — Render the error surface on the management page

- [ ] 16. Write browser tests in `test/browser/extension.spec.ts`: injected `params.reason`; stable-message fallback; page-constant fallback; literal markup; malformed diagnostics; inherited fields ignored; and throwing accessors contained without executing inherited behavior.
- [ ] 17. Write browser tests proving selection is keyed by group and rule id, equal reason strings do not merge statuses, stale selection falls back to the first current error after refresh, and no card remains when errors disappear.
- [ ] 18. Add a private narrowing reader in `packages/extension/src/extension-page-entry.ts` that returns code plus optional reason and message, prefers `extension.dnr-error`, and uses guarded own-property reads.
- [ ] 19. Implement reason resolution order: own string `params.reason`, then own string diagnostic `message`, then a page-owned constant fallback.
- [ ] 20. Add module-level page state for the selected `{ groupId, ruleId }`, reconciling it to the first current `error` status when absent or stale.
- [ ] 21. For `error` statuses only, render the status word as `<button type="button" data-rule-error-link>` carrying `data-group-id` and `data-rule-id`, with an accessible name naming group and rule; keep each list item's text exactly `groupId/ruleId: status`.
- [ ] 22. Render exactly one `data-rule-error-card` section with a heading, the selected group/rule identity, and the reason via `textContent`; render no card when no errors exist.
- [ ] 23. Add minimal `.rogatio-rule-error-card` styles in `packages/extension/src/extension.css` alongside the existing runtime-guidance card rules, without modifying `.rogatio-runtime-guidance*` or `.rogatio-attention-note`.
- [ ] 24. Confirm the existing assertions at `test/browser/extension.spec.ts:421-433` and `:497-504` and `test/browser/extension-real.spec.ts:68-72` still pass. **Gate.**

## Phase 4 — Wire activation to navigation and focus

- [ ] 25. Write browser tests: the native button is focusable and Enter-activatable; after activation the editor shows the failing group, `document.activeElement` is the expected rule card, and the error card shows that rule's message.
- [ ] 26. Write a browser test: activating a link whose group or rule card does not exist updates the card subject and logs no uncaught page error.
- [ ] 27. Extend the delegated shell `click` handler at `packages/extension/src/extension-page-entry.ts:783-820` to recognise `data-rule-error-link` via `closest`.
- [ ] 28. On activation, set the selected group/rule pair, set `activeTab = "workspace"`, and re-render.
- [ ] 29. After re-render, call `editor.navigateToGroup(groupId)` guarded on `editor` being defined.
- [ ] 30. Look up the card with `document.getElementById(\`rogatio-rule-${groupId}-${ruleId}\`)` — no CSS selector built from ids — then `scrollIntoView` and `focus({ preventScroll: true })`, matching `packages/editor/src/editor.ts:1770-1774`.
- [ ] 31. Handle missing-editor, missing-group, and missing-card cases by leaving the selection and card in place without throwing.
- [ ] 32. Run the focused browser cases. **Gate:** if host-side focus proves unreliable, stop and raise widening `EditorController`.

## Phase 5 — Documentation sync, evidence, and gate

- [ ] 33. Update `packages/extension/README.md` to describe the error link and the error card as current behaviour.
- [ ] 34. Record in `docs/decisions/header-rule-status-errors/workflow.md` the evidence for each of the 12 plan acceptance criteria, naming the test that proves each; retain the four deferred items there without creating external issues unless separately authorized.
- [ ] 35. Run `pnpm validate` and confirm typecheck, Vitest, and Playwright all pass.
- [ ] 36. Audit staged, unstaged, tracked, and untracked files for unrelated changes, generated output, local settings, and secrets; confirm `docs/architecture.md` and out-of-scope packages are unchanged.
- [ ] 37. Confirm or create the referenced issue number with the user, then propose the Conventional Commits message. **Gate.**
