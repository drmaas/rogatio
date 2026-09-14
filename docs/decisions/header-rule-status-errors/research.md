# Research — Header rule status errors

Feature: `header-rule-status-errors`
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/header-rule-status-errors`
Branch: `feature/header-rule-status-errors`

## Problem restatement

> Header rules still show status `error` when the Sample Rules Group is active; once a group is active those rules should say `active` (unless there is a real install failure). Users currently have no idea why the error status appears. Need a way to surface rule errors to the user — for example make the `error` status text a link that navigates to the rule, and show a distinct error card with the error message. Screenshot attached shows: group "Sample Rules Group" checked/active; mustard alert "Attention needed: some rules failed to install..."; rule list with `grp-sample/rule-header-set: error` and `grp-sample/rule-header-remove: error` (red); other rules active; runtime running; workspace banner also says attention needed.

## Codebase findings

### 1. How a rule status becomes `error`

`computeRuleStatuses(input: RuleStatusInput): readonly RuleStatus[]` in `packages/browser-core/src/status.ts:36` evaluates each operation in a fixed order:

- group not enabled → `disabled` (`packages/browser-core/src/status.ts:45-52`)
- some declared origin not granted → `needs permission` (`packages/browser-core/src/status.ts:54-61`)
- `ruleId` not present in `input.installedRuleIds` → `error` with a `core.rule-not-installed` diagnostic (`packages/browser-core/src/status.ts:62-74`)
- otherwise → `active` (`packages/browser-core/src/status.ts:76-80`)

So `error` has exactly one meaning in browser-core: *the rule is enabled and permitted, but its id is not in the installed set.* The diagnostic message is "The rule is enabled with granted site access but is not installed." (`packages/browser-core/src/diagnostics.ts:41-42`).

`RuleStatus` carries an optional `diagnostics` array (`packages/browser-core/src/types.ts:70-75`), and `computeBadge` flips `attention` for any status that is neither `active` nor `disabled` (`packages/browser-core/src/status.ts:85-96`).

### 2. Header rules travel a separate install path from redirect/query

The service worker deliberately splits the two paths:

- `dnrManagedOps(operations, enabledGroupIds, granted)` (`packages/extension/src/service-worker.ts:242-260`) returns only `redirect` and `query` operations; the header case falls through to `return false` with the comment "Header rules handled separately by installHeaderRules." (`packages/extension/src/service-worker.ts:257-258`).
- The injected `RuleInstallerAdapter` implementation `createDnrInstaller(api)` (`packages/extension/src/dnr.ts:103-165`) translates only `operation.kind === "redirect"` (`packages/extension/src/dnr.ts:132-138`) and `operation.kind === "query"` (`packages/extension/src/dnr.ts:139-146`). Header operations are silently skipped, so they never enter the `tracked` map and therefore never appear in `current()` (`packages/extension/src/dnr.ts:107-122`).

`projectState` builds `installedRuleIds` in two steps (`packages/extension/src/service-worker.ts:262-357`):

1. From `options.installer.current()` — redirect/query only (`packages/extension/src/service-worker.ts:298-304`).
2. By running `installHeaderRules(...)` on every state computation and mapping the returned numeric DNR ids back to project rule ids (`packages/extension/src/service-worker.ts:305-334`).

Consequence: a header rule can only reach `active` if `installHeaderRules` reports its numeric id in `result.installed`. There is no other source for header rule ids.

### 3. `installHeaderRules` treats the batch as all-or-nothing and emits an empty modify-header list

`installHeaderRules(projections, removeRuleIds)` (`packages/extension/src/installer.ts:132-192`):

- If `chrome.declarativeNetRequest` is absent, every rule gets an `extension.dnr-error` and `installed` stays empty (`packages/extension/src/installer.ts:152-161`).
- It reconciles removals against `getDynamicRules()` before adding (`packages/extension/src/installer.ts:162-172`).
- A single `updateDynamicRules` call adds all rules; on throw, the catch block pushes one `extension.dnr-error` per rule with `error.message` as the reason and leaves `installed` empty (`packages/extension/src/installer.ts:173-190`).

Failure to read existing rules is swallowed and the add is still attempted without removals (`packages/extension/src/installer.ts:162-172`). A non-`Error` rejection uses the fallback message `"Failed to install header rule"` (`packages/extension/src/installer.ts:180-188`). Result handling is batch-wide: any rejection marks every submitted header rule failed with the same message. The code does not identify which rule caused Chrome to reject the call.

`toDnrRule(projection)` (`packages/extension/src/installer.ts:94-130`) always emits **both** modify-header lists, one of which is necessarily empty:

```94:110:packages/extension/src/installer.ts
export function toDnrRule(projection: HeaderProjection): DnrHeaderRule {
  const { allowed: initiatorDomains, excluded: excludedInitiatorDomains } =
    toDnrDomains(projection.matcher.origins);
  return {
    id: projection.id,
    priority: projection.matcher.priority,
    action: {
      type: "modifyHeaders",
      requestHeaders:
        projection.action.direction === "request"
          ? [toDnrHeaderAction(projection.action)]
          : [],
      responseHeaders:
        projection.action.direction === "response"
          ? [toDnrHeaderAction(projection.action)]
          : [],
    },
```

For the sample project this means `rule-header-set` (`headerDirection: "request"`, `samples/basic/.rogatio.json:36-49`) is sent with `responseHeaders: []`, and `rule-header-remove` (`headerDirection: "response"`, `samples/basic/.rogatio.json:50-61`) is sent with `requestHeaders: []`. The redirect/query translator emits only redirect actions (`packages/extension/src/dnr.ts:53-92`).

`toDnrRule` also writes `condition` keys whose values may be the literal `undefined` (`packages/extension/src/installer.ts:112-128`), rather than omitting the keys.

A prior fix in this path omits `value` for `remove` operations — `toDnrHeaderAction` only sets `value` when defined (`packages/extension/src/installer.ts:84-92`), and the regression test records Chrome's rejection of an undefined value as its rationale (`packages/extension/test/permission-grant.test.ts:305-314`). This supports validating the exact emitted object shape, but does not prove empty arrays are the current rejection cause.

### 4. Why the unit tests do not catch this

`packages/extension/test/permission-grant.test.ts:212-329` asserts that `rule-header` and `rule-header-remove` reach `status: "active"` after permissions are granted. The test installs a `chrome.declarativeNetRequest` mock whose `updateDynamicRules` never throws, so any rule shape is accepted. `packages/extension/test/installer.test.ts:59-118` likewise covers only "mock resolves", "mock throws", and API absence. Existing assertions inspect populated header entries but do not assert that the opposite-direction property is omitted (`packages/extension/test/permission-grant.test.ts:299-313`). No test exercises Chrome's real validation of the emitted header action.

### 5. Error messages already exist in the payload and are discarded by the view

`operationStatuses` (`packages/extension/src/service-worker.ts:113-208`) already enriches the error case:

- When a header install error matches the rule and the status is `error`, the `core.rule-not-installed` diagnostic is replaced with `extension.dnr-error` carrying `params: { ruleId, reason }`, where `reason` is Chrome's own message (`packages/extension/src/service-worker.ts:133-146`). Its message text is "The declarativeNetRequest operation failed." (`packages/extension/src/diagnostics.ts:49`).
- The `header` branch returns `{ ...status }` unchanged when the status is not `active`, so the diagnostics survive (`packages/extension/src/service-worker.ts:188-197`).
- The `redirect`/`query` branch rewrites both `active` **and** `error` to `active`, constructing a fresh object that drops `diagnostics` entirely (`packages/extension/src/service-worker.ts:198-205`). This is why redirect/query rules never show `error` in the screenshot even if their install failed.

The enriched statuses are returned to the page as `ruleStatuses` (`packages/extension/src/service-worker.ts:380-388`), and the page state type retains each status as `Record<string, unknown>` (`packages/extension/src/extension-page-entry.ts:24-30`).

The management page then throws the information away:

```438:448:packages/extension/src/extension-page-entry.ts
  const ruleStatuses = document.createElement("ul");
  ruleStatuses.dataset.ruleStatuses = "true";
  for (const ruleStatus of state.ruleStatuses ?? []) {
    const item = document.createElement("li");
    const groupId = text(ruleStatus.groupId, "unknown group");
    const ruleId = text(ruleStatus.ruleId, "unknown rule");
    const statusValue = text(ruleStatus.status, "error");
    item.textContent = `${groupId}/${ruleId}: ${statusValue}`;
    ruleStatuses.append(item);
  }
```

There is no per-status class, no diagnostic rendering, and no link. `.rogatio-sidebar ul` styles every item with the same muted colour (`packages/extension/src/extension.css:239-244`). The popup is equally lossy: it renders only `statusLabel(row.status)` (`packages/extension/src/popup.ts:45-61`, `packages/extension/src/popup.ts:313`).

So the answer to "do error messages already exist but are not surfaced?" is **yes** — both `core.rule-not-installed` and `extension.dnr-error` (with Chrome's concrete reason) reach the page and are dropped by the renderer.

The UI cannot read that reason through a declared status type today. It must narrow `diagnostics`, each diagnostic object, and `params.reason` from `unknown` before rendering. The stable user-facing identity is `diagnostic.code`; Chrome's message is variable detail in `params.reason` (`packages/extension/src/service-worker.ts:133-145`, `packages/extension/src/diagnostics.ts:24-29`). Not every `error` is guaranteed to have a `reason`: the browser-core fallback carries only its stable `message` and rule/group params (`packages/browser-core/src/status.ts:62-73`). Rendering therefore needs a deterministic fallback when `params.reason` is absent.

### 6. Existing alert/banner seams

- **Attention note.** `attentionFromStatuses(): AttentionExplanation | null` (`packages/extension/src/extension-page-entry.ts:192-226`) picks the highest-precedence blocking status from `ATTENTION_PRECEDENCE` (`packages/extension/src/extension-page-entry.ts:185-190`) and returns canned `blocking` / `explanation` / `fix` strings. The `error` case hardcodes "some rules failed to install." and "Re-activate the group, or restart the native runtime." (`packages/extension/src/extension-page-entry.ts:197-204`) — the mustard alert in the screenshot. It is rendered as a single `<p class="rogatio-attention-note">` in `renderSidebar` (`packages/extension/src/extension-page-entry.ts:427-436`), styled at `packages/extension/src/extension.css:704-712`.
- **Badge pill.** The same explanation is appended to the workspace badge text (`packages/extension/src/extension-page-entry.ts:276-284`) — the "attention needed" banner in the screenshot.
- **Card precedent.** The runtime guidance block is the existing pattern for a distinct, styled card with an error line: `.rogatio-runtime-guidance` (`packages/extension/src/extension.css:309-317`) and `.rogatio-runtime-guidance-error` (`packages/extension/src/extension.css:325-328`), used by the "Runtime needs attention" panel (`packages/extension/src/extension-page-entry.ts:734-746`).

### 7. Existing seams for "link to the rule"

- The editor's public boundary already exposes navigation: `EditorController.navigateToGroup(groupId: string | null | undefined): void` (`packages/editor/src/types.ts:188-195`), implemented at `packages/editor/src/editor.ts:1733`.
- The management page already holds the controller instance and already calls it for deep links: `editor.navigateToGroup(deepLinkGroup)` (`packages/extension/src/extension-page-entry.ts:931`).
- A deep-link precedent exists end to end: the popup builds `groupUrl(groupId)` as `<management page>?group=<id>` (`packages/extension/src/popup-model.ts:87-90`), and the page reads the `group` query parameter and switches to the workspace tab (`packages/extension/src/extension-page-entry.ts:1518-1519`). The parameter is group-scoped only; there is no rule-scoped deep link today.
- Every rule card in the editor already has a stable DOM anchor and is focusable: `card.dataset.ruleCard`, `card.dataset.ruleId`, `card.id = \`rogatio-rule-${groupId}-${ruleId}\``, and `card.tabIndex = -1` (`packages/editor/src/editor.ts:2264-2268`). The containing list carries `data-rule-list = groupId` (`packages/editor/src/editor.ts:2116`).
- The editor renders one route at a time; rule cards only exist when the route is a group (`packages/editor/src/editor.ts:1839-1844`, `packages/editor/src/editor.ts:2065`, `packages/editor/src/editor.ts:2117-2120`). Reaching a rule therefore requires navigating to its group first.
- The editor is mounted only when `activeTab === "workspace"` and at least one project exists (`packages/extension/src/extension-page-entry.ts:886-932`); `activeTab` is module-level page state (`packages/extension/src/extension-page-entry.ts:67`).
- Rule cards are rendered for every rule regardless of type (`packages/editor/src/editor.ts:2115-2121`). A header field extension exists (`packages/editor/src/rule-types/header.ts:111-218`) but is neither built in (`packages/editor/src/rule-types/index.ts:11-16`) nor supplied by the management page, which supplies redirect, mock, and response-body only (`packages/extension/src/extension-page-entry.ts:888-896`). The card and common matcher fields therefore exist, but header-specific controls do not.
- `navigateToGroup` renders synchronously (`packages/editor/src/editor.ts:1733-1747`), so host code can navigate and then query/focus the rule card. A selector built from raw ids would require escaping; using `[data-rule-list]` / `[data-rule-id]` comparisons or `document.getElementById` avoids selector injection.

### 8. Plan-facing test seams

- Installer unit tests should pin omission of the unused `requestHeaders` / `responseHeaders` property and condition properties currently emitted with `undefined` values; current tests cover domain-property omission but not those shapes (`packages/extension/test/installer.test.ts:30-57`).
- Service-worker coverage should prove a thrown header install reason becomes `extension.dnr-error` with `params.reason`; current header status coverage exercises only successful installation (`packages/extension/test/permission-grant.test.ts:212-329`).
- Management-page browser coverage should prove error text is rendered as text, the status control is keyboard-accessible, activation navigates to the group, and focus lands on the intended rule card. Existing attention tests assert only canned summary text (`test/browser/extension.spec.ts:421-433`, `test/browser/extension.spec.ts:497-504`), while the real-extension test asserts only list status text (`test/browser/extension-real.spec.ts:68-72`).

## Constraints and invariants

- **Package boundaries.** `packages/browser-core` owns rule statuses and badge math and must stay platform-neutral; all Chrome work enters through injected `StorageAdapter` / `RuleInstallerAdapter` ports (`packages/browser-core/src/types.ts:30-44`). Any Chrome-specific error text must be attached in `packages/extension`, not in browser-core.
- **`error` has one definition.** `computeRuleStatuses` returns `error` only for an enabled, permitted rule missing from `installedRuleIds` (`packages/browser-core/src/status.ts:62-74`). Making header rules read `active` means making their ids actually appear in `installedRuleIds`, not special-casing the status.
- **Header error attribution is batch-wide.** `updateDynamicRules` is a single call for all header rules (`packages/extension/src/installer.ts:173-190`), so per-rule error attribution is not available from the current call shape; every rule in a rejected batch receives the same message.
- **Diagnostic stability.** Public diagnostic codes must stay stable and independent of third-party wording (`AGENTS.md`, "Repository Rules"). `extension.dnr-error` already separates the stable code from the variable `reason` param (`packages/extension/src/service-worker.ts:140-143`, `packages/extension/src/diagnostics.ts:49`).
- **Untrusted error detail.** Chrome's error message is third-party text. Preserve the page's current `textContent` construction style (`packages/extension/src/extension-page-entry.ts:105-107`, `packages/extension/src/extension-page-entry.ts:441-446`) and do not interpolate it into HTML.
- **Preserve tested hooks.** Existing browser coverage depends on `.rogatio-attention-note`, `[data-badge-state]`, and `[data-rule-statuses]` (`test/browser/extension.spec.ts:421-433`, `test/browser/extension.spec.ts:497-504`, `test/browser/extension-real.spec.ts:68-72`).
- **Editor boundary.** The editor must remain framework-free and browser-safe with host-supplied validate/save ports (`AGENTS.md`, "Repository Rules"); navigation must go through `EditorController.navigateToGroup` rather than reaching into editor internals (`packages/editor/src/types.ts:194`).

## Open questions

1. What is Chrome's actual rejection message from `updateDynamicRules` for the sample header rules? The always-present empty opposite-direction array in `toDnrRule` (`packages/extension/src/installer.ts:100-110`) is an unverified candidate, not an established root cause. The message is captured at `packages/extension/src/installer.ts:180-188`; obtaining it from the reported environment is required before claiming a fix.
2. Should the redirect/query masking at `packages/extension/src/service-worker.ts:198-205` be removed as part of this work? It currently reports a failed redirect/query install as `active` and discards its diagnostics, which is the inverse of the reported bug.
3. Should the error surface appear in the popup as well, or only on the management page? The popup drops diagnostics today (`packages/extension/src/popup.ts:313`).
4. Given the current batch call, should the UI attribute one shared error message to every header rule, or install header rules individually so each failure is attributable?
5. Where should a rule link land, given the management page does not supply the available header field extension (`packages/extension/src/extension-page-entry.ts:888-896`, `packages/editor/src/rule-types/header.ts:111-218`)? The rule card exists and is focusable (`packages/editor/src/editor.ts:2264-2268`), but this editor instance lacks header-specific controls.
6. Does `navigateToGroup` need a rule-scoped companion on `EditorController`, or is group navigation plus a host-side DOM lookup/focus sufficient without widening the editor's public boundary?
7. Should the distinct error card render once per failed rule, once for the selected status link, or once for the batch-wide failure? Current payload repeats the same batch message for every submitted header rule.
