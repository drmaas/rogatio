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
