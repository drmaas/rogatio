# Workflow — Header rule status errors

Feature: `header-rule-status-errors`
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/header-rule-status-errors`
Branch: `feature/header-rule-status-errors`

## Phase 1 — Real Chrome rejection evidence

**Date:** 2026-09-13  
**Harness:** `test/browser/header-dnr-probe.spec.ts`  
**Command:** `pnpm exec playwright test test/browser/header-dnr-probe.spec.ts` (extension pre-built via `pnpm build`). The outcomes are recorded as a `header-dnr-probe` test annotation rather than asserted, so re-read them with `--reporter=json`; the default `line` reporter does not print annotations.  
**Chromium:** Playwright bundled Chromium (`channel: "chromium"`, headless persistent context with loaded extension)

### Method

Loaded the built extension the same way as `test/browser/extension-real.spec.ts`, opened `chrome-extension://<id>/index.html`, and from that extension page called `chrome.declarativeNetRequest.updateDynamicRules` with the exact object literals `toDnrRule` currently emits for the sample header rules in `samples/basic/.rogatio.json`. Rule objects were constructed inside the page evaluate callback so `condition` keys with literal `undefined` values match the in-extension shape (Playwright argument serialization would otherwise omit them).

Both sample header rules declare `origins: []` and inherit the group origin `https://example.com`, so the emitted `condition.initiatorDomains` is `["example.com"]`, not `undefined`; the probe literals carry that value. The `condition` keys genuinely emitted as present-with-`undefined` are `excludedInitiatorDomains` (both rules) and `requestMethods` (`rule-header-remove` only, since `rule-header-set` declares `method: "GET"`).

Probe rule ids: `9_000_001` (`rule-header-set`), `9_000_002` (`rule-header-remove`), derived from `9_000_000 + parallelIndex * 100`. Each probe rule is removed via `removeRuleIds` in a `finally` block, so a throwing probe cannot leak a rule; the persistent profile is a fresh temp directory removed after the run, so nothing survives across reruns either.

### Outcomes

| Sample rule | Direction | Emitted defect under test | Outcome | Chrome message (verbatim) |
| --- | --- | --- | --- | --- |
| `rule-header-set` | request | `responseHeaders: []` plus `excludedInitiatorDomains: undefined` | **rejected** | `Rule with id 9000001 cannot have an empty list as the value for action.responseHeaders key.` |
| `rule-header-remove` | response | `requestHeaders: []` (remove action without `value`) plus `excludedInitiatorDomains: undefined` and `requestMethods: undefined` | **rejected** | `Rule with id 9000002 cannot have an empty list as the value for action.requestHeaders key.` |

Chrome rejects on the empty modify-header list before reaching any `undefined` `condition` key, so the probe establishes the empty-list defect only. Whether the present-with-`undefined` `condition` keys are independently rejected is unproven; Phase 2 fixes both but may claim evidence only for the empty list.

### Phase 1 gate

Chrome **rejected** both current shapes. The leading empty opposite-direction array hypothesis is confirmed for this environment. **Phase 2 may proceed** as planned (omit unused header lists and undefined condition keys); no re-scope required at this gate.

### Validation

- `pnpm build` — passed; `packages/extension/dist` present.
- `pnpm exec playwright test test/browser/header-dnr-probe.spec.ts` — 1 passed.
- `pnpm test:browser` — 26 passed, 3 skipped (request-body live E2E gated).

### Phase 1 review

Independent review corrected the probe's `condition.initiatorDomains` from `undefined` to the actually emitted `["example.com"]`, moved per-rule cleanup into a `finally`, and replaced a vacuous `typeof` assertion with one pinning which rules were probed. Re-running the probe produced byte-identical rejection messages, so the recorded evidence and the Phase 1 gate decision are unchanged. `tsc --noEmit`, `biome check`, and `pnpm test:browser` (26 passed, 3 skipped) all pass after the corrections.

Noted for Phase 2, not changed here: `extensionContext()` is now duplicated between this probe and `test/browser/extension-real.spec.ts`; consolidating it belongs with the Phase 2 rewrite of the probe into a regression assertion.

## Phase 2 — Fix emitted DNR shape and pin error payload

**Date:** 2026-09-13

### Red state (TDD)

Before production changes, four new/updated assertions in `packages/extension/test/installer.test.ts` failed against the pre-fix emitter: empty opposite-direction header arrays were still present, and `condition` keys were emitted with literal `undefined`. Service-worker payload tests in `packages/extension/test/permission-grant.test.ts` already passed (error plumbing was pre-existing).

### Changes

- `packages/extension/src/installer.ts`: `DnrHeaderRule.action.requestHeaders` / `responseHeaders` optional; `toDnrRule` omits the unused direction list and omits unset `condition` keys via conditional spread.
- `test/browser/header-dnr-probe.spec.ts`: converted from evidence-only probe to regression asserting real Chromium accepts the corrected sample shapes (pre-fix rejection messages remain recorded above; not asserted).
- `packages/extension/test/installer.test.ts`: shape omission unit tests.
- `packages/extension/test/permission-grant.test.ts`: thrown `Error` and non-`Error` rejection payload tests.

### Validation

- Red: `pnpm exec vitest run packages/extension/test/installer.test.ts` — 4 failed / 4 passed (shape tests red, install tests green).
- Green: `pnpm exec vitest run packages/extension/test/installer.test.ts packages/extension/test/permission-grant.test.ts` — 15 passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm test:browser` — 26 passed, 3 skipped.
- `pnpm validate` — passed (full gate).

### Phase 2 gate

All checklist tasks 6–15 complete. Phase 3+ deferred (UI rendering, navigation, docs sync).

### Phase 2 review

Independent review re-derived the red state by restoring the pre-fix `toDnrRule` and re-running the extension unit suites: 4 failed / 11 passed, with the failures landing on the empty opposite-direction list and the present-with-`undefined` condition keys. The recorded TDD claim holds, as does the note that the service-worker payload tests were green before the fix because the error plumbing already existed. The probe literals were re-checked against `samples/basic/.rogatio.json`: priorities 300/310, `^https://example\.com/api/`, `xmlhttprequest`/`main_frame`, `initiatorDomains: ["example.com"]`, and `requestMethods: ["get"]` on the set rule only all match what `toDnrRule` now emits.

Corrected during review:

- Consolidated the duplicated `extensionContext()` helper (carried over from the Phase 1 review note) into `test/browser/extension-context.ts`, now imported by both `header-dnr-probe.spec.ts` and `extension-real.spec.ts`. Playwright's default `testMatch` does not collect the non-spec helper.
- `packages/extension/test/permission-grant.test.ts`: the DNR mock's parameter type still declared `requestHeaders`/`responseHeaders` as required, which no longer describes the emitted rules and would have produced a `TypeError` rather than an assertion failure on regression. Made both optional, switched the reads to optional chaining, and added assertions that each submitted rule omits the opposite direction's list, so the service-worker-level coverage now pins the shape too.

Known limitations, recorded rather than changed:

- The real-Chromium assertion is literal-driven: the rule objects live in the spec, not in `toDnrRule`, so it proves Chrome accepts the corrected shape but cannot go red if the emitter regresses. That regression guard is the Vitest shape tests plus the service-worker assertions above. The literal/emitter correspondence is maintained by hand.
- The red state for the browser assertion (checklist 6) was not captured in this log; only the Vitest red state was recorded.
- `toDnrRule` uses two independent conditional spreads for the header lists, so the type permits an action with neither list if `direction` ever gains a third member. The union is closed at two today, so this was left as-is.

Validation after the review edits: `pnpm validate` — passed end to end (format, lint, typecheck, build, Vitest, Playwright 26 passed / 3 skipped).

## Phase 3 — Error surface on management page

**Date:** 2026-09-13

### Changes

- `packages/extension/src/extension-page-entry.ts`: diagnostic narrowing reader, selected error state, error status button (`data-rule-error-link`), one `data-rule-error-card`.
- `packages/extension/src/extension.css`: `.rogatio-rule-error-card`.
- `test/browser/extension.spec.ts`: rendering, fallback, malformed payload, selection, and literal-markup cases.

### Validation

- `pnpm validate` — passed (after Biome format fixups and Phase 3 review hardening of `params` reads).

## Phase 4 — Activation, navigation, and focus

**Date:** 2026-09-13

### Changes

- Shell click handler recognizes `data-rule-error-link`, selects the rule, switches to workspace, calls `editor.navigateToGroup`, focuses `#rogatio-rule-<groupId>-<ruleId>` via `getElementById`.
- Browser tests for keyboard activation + missing-card negative path.
- Host-side focus works; `EditorController` not widened.
- Out-of-scope `vitest.config.ts` parallelism tweak from verify was reverted (pre-existing flake; not this feature).

### Validation

- Focused Phase 4 browser tests + full `extension.spec.ts` + `pnpm validate` (when run) green for Phase 4 sources.

## Phase 5 — Documentation sync and acceptance evidence

**Date:** 2026-09-13

### Docs

- `packages/extension/README.md` does not exist. Root `README.md` updated instead to describe the error link and error card as current management-page behaviour (popup unchanged).

### Acceptance criteria → evidence

1. Header rules `active` with resolving DNR mock — `packages/extension/test/permission-grant.test.ts` header-status coverage.
2. Omitted opposite-direction lists / no `undefined` condition keys — `packages/extension/test/installer.test.ts` shape tests; also asserted at SW boundary in `permission-grant.test.ts`.
3. Real Chromium accepts corrected shape; pre-fix rejection recorded — Phase 1 table above; regression `test/browser/header-dnr-probe.spec.ts`.
4. Thrown / non-Error install → `extension.dnr-error` + `params.reason` — `packages/extension/test/permission-grant.test.ts` payload tests.
5. Error status as keyboard control; list text `groupId/ruleId: status` — `test/browser/extension.spec.ts` Phase 3/4 cases.
6. One error card; selection/fallback/clear; no merge by equal reason — `test/browser/extension.spec.ts` Phase 3 selection cases.
7. Reason fallbacks + literal markup — `test/browser/extension.spec.ts` Phase 3 reason/fallback/markup cases.
8. Activate → workspace + group + focus; missing card no throw — `test/browser/extension.spec.ts` Phase 4 keyboard + missing-card tests.
9. No CSS selector from ids — implementation uses `document.getElementById` in `extension-page-entry.ts`.
10. Out-of-scope packages / popup / redirect-query masking unchanged on this branch's commits — verified by `git log` / `git diff` of feature commits (cli drift vs advanced local `main` is unrelated base skew).
11. Malformed/inherited/throwing diagnostics contained; existing hooks — Phase 3 review tests + existing attention/badge/real-extension assertions.
12. `pnpm validate` — recorded in Phase 5 validation below.

### Deferred (retained; no external issues unless authorized)

1. Redirect/query masking still reports failed installs as `active` (`service-worker.ts` redirect/query branch).
2. Popup does not surface diagnostics.
3. Batch `updateDynamicRules` attribution remains batch-wide.
4. Management page still does not wire the header field extension into `createEditor`.

### Phase 5 validation

Recorded when `pnpm validate` completes in this phase.

### Phase 5 validation result

- `pnpm validate` — passed (format, lint, typecheck, build, Vitest 730/730, Playwright 36 passed / 3 skipped).
- Gate-only fix included: `vitest.config.ts` splits unit vs integration projects with `fileParallelism: false` on integration so concurrent `pnpm build` calls no longer corrupt dist during validate. Pre-existing flake; required for acceptance criterion 12.

## Final review

**Date:** 2026-09-13

Fresh-context review of the cumulative diff (15 files vs `457266d`, no untracked or generated files). Two defects found and fixed in the worktree; `pnpm validate` re-run green after each.

1. **`vitest.config.ts` silently dropped `resolve.alias`.** On Vitest 4 an inline project does not inherit the root config, so moving `include` into `projects` also stopped the `@rogatio/*` → `dist` aliases from applying. Proven by pointing the `@rogatio/compiler` alias at a nonexistent file: `packages/extension/test/dnr.test.ts` still passed without `extends`, and fails with it. The suite stayed green only because each package's `exports.import` happens to name the same dist file, so the aliases were dead config that would silently diverge if an exports map ever changed. Fixed by adding `extends: true` to both projects.
2. **The new error control inherited full button chrome.** `[data-rule-error-link]` is a `<button>` inside `.rogatio-shell`, so it picked up the shared border, background, and `0.45rem 0.7rem` padding, rendering the status word as a padded chip inside the compact muted sidebar list. Fixed with a scoped rule that strips the chrome and renders it as an underlined `--rogatio-danger` link, matching the plan's "dead red word" framing. No existing selector or test hook was touched; the global `.rogatio-shell :focus-visible` ring still applies.

Reviewed and left as-is (recorded, not changed): the two scope deviations from the plan's Phase 5 file list (root `README.md` because `packages/extension/README.md` does not exist, and the `vitest.config.ts` gate fix), the two independent conditional spreads in `toDnrRule`, and the literal-driven real-Chromium probe. The four deferred follow-ups above were not expanded into code.
