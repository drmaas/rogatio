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
