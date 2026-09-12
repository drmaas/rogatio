# RESEARCH: runtime-error-fixes

## Problem restatement

Two bugs in the Rogatio Chrome extension:

1. When runtime start fails (Native host has exited), the yellow banner says "Run the install command below once" but no actual command is displayed. The banner text reads: "Runtime needs attention / Error: Native host has exited. / Run the install command below once, reload Rogatio from chrome://extensions, then click Start runtime again." — but there is no install command shown below that text.

2. Header rules (rule-header-set, rule-header-remove) show "error" status even though other rule types (redirect, query) show "active". The sidebar shows:
   - grp-sample/rule-header-set: error
   - grp-sample/rule-header-remove: error

## Codebase findings

### Bug 1: Missing install command in runtime error banner

**The `installCommand` state is only populated for specific diagnostic codes.**

In `packages/extension/src/extension-page-entry.ts`:
- Line 67: `installCommand` is module-level state, initialized to `null`.
- Lines 1131-1146 (`nativeRuntimeCommand`): On every start/stop command, `installCommand` is set to `null` first (line 1131). It is only set to a value when the diagnostic code is `extension.native-host-missing` or `extension.request-body-needs-trust` (lines 1137-1150). For all other failure codes (including `extension.native-runtime-transition`), `installCommand` stays `null`.

**The recovery text always promises an install command regardless of error type.**

In `packages/extension/src/extension-page-entry.ts`:
- Lines 147-163 (`runtimeRecoveryText`): When the error contains "host" (line 149), it returns: "Run the install command below once, reload Rogatio from chrome://extensions, then click Start runtime again." This text is shown for `extension.native-host-missing` AND `extension.native-runtime-transition` errors.

**The banner renders the install command only when `installCommand` is truthy.**

In `packages/extension/src/extension-page-entry.ts`:
- Lines 722-749: The runtime guidance section is rendered when `runtimePhase === "failed" || runtimePhase === "unsupported"`. Inside this section (lines 740-748), the `<code>` element with `data-runtime-install-command` is only appended if `installCommand` is truthy.

**The mismatch: when the native host exits unexpectedly, the error code is `extension.native-runtime-transition`, not `extension.native-host-missing`.**

In `packages/extension/src/background.ts`:
- Lines 119-132 (`onDisconnect` handler): Chrome fires this when the native host disconnects. The error message is "Native host has exited" (from `runtime.lastError.message`).
- Lines 138-164 (`start()` method): When `ensurePort()` throws (lines 143-164), the `catch` block always returns `{ state: "failed", message: "extension.native-runtime-transition" }` (lines 160-163). It does NOT distinguish between "host never installed" (`NativeHostMissingError` with code `extension.native-host-missing`) and "host crashed after connecting" (same error class, but Chrome's disconnect message differs).

In `packages/extension/src/native-session.ts`:
- Lines 180-187 (`stableStartFailureReason`): Converts any error containing "native-host-missing" to the stable reason. Other errors map to `extension.native-runtime-transition`.

**The service worker sets the diagnostic code based on the failure reason.**

In `packages/extension/src/service-worker.ts`:
- Lines 631-661 (`start-native-runtime` handler): When `startNativeSession` throws or returns `ok: false`, the diagnostic code is set to `extension.native-host-missing` only if `sessionResult.reason === "extension.native-host-missing"` (line 650). Otherwise it's `extension.native-runtime-transition` (line 658).

**Flow for "Native host has exited" (host was installed but crashed):**
1. User clicks "Start runtime"
2. `startNativeSession` → `nativeRuntime.send()` → `ensurePort()` → `connectNative()` succeeds
3. Host crashes → `onDisconnect` fires → `lastConnectError = "Native host has exited"`
4. `send()` times out or rejects → `startNativeSession` returns `{ ok: false, reason: "extension.native-runtime-transition" }`
5. Service worker sets diagnostic code to `extension.native-runtime-transition`
6. `nativeRuntimeCommand` in extension-page: code is not `extension.native-host-missing` → `installCommand = null`
7. Banner renders recovery text "Run the install command below once" but no command is shown

**Flow for "Native host missing" (host never installed):**
1. User clicks "Start runtime"
2. `startNativeSession` → `nativeRuntime.send()` → `ensurePort()` → `connectNative()` throws synchronously
3. Chrome error: "Specified native messaging host not found" or similar
4. `NativeHostMissingError` thrown → `startNativeSession` returns `{ ok: false, reason: "extension.native-host-missing" }`
5. Service worker sets diagnostic code to `extension.native-host-missing`
6. `nativeRuntimeCommand`: code IS `extension.native-host-missing` → `installCommand` set to `rogatio runtime install --extension-id <id>`
7. Banner shows recovery text AND install command

### Bug 2: Header rules show "error" status

**Header rules are installed via a separate path from redirect/query rules.**

In `packages/extension/src/service-worker.ts`:
- Lines 242-260 (`dnrManagedOps`): Returns only `redirect` and `query` operations. Header rules are explicitly excluded with the comment "Header rules handled separately by installHeaderRules."
- Lines 291-334 (`projectState`): Header operations are extracted, projected via `projectHeaders()`, filtered by enabled groups and granted origins, and installed via `installHeaderRules()`.
- Lines 320-325: The installed DNR IDs are mapped back to project `ruleId` values and pushed to `installedRuleIds`.

**The `installHeaderRules` function constructs DNR rules with `requestDomains` for `modifyHeaders` rules.**

In `packages/extension/src/installer.ts`:
- Lines 94-136 (`toDnrRule`): Builds a DNR rule with:
  - `condition.initiatorDomains` (line 119)
  - `condition.requestDomains` (lines 125-128)
- Lines 125-128: `requestDomains` is set to the same value as `initiatorDomains`.

**Chrome's `modifyHeaders` rules DO support `requestDomains` as a condition field.**

Chrome's declarativeNetRequest API docs (Chrome 101+) list `requestDomains` as a general `RuleCondition` field valid for all action types including `modifyHeaders`. The initial hypothesis that `requestDomains` is unsupported for `modifyHeaders` is incorrect. The actual cause of the DNR rejection must be investigated — possible causes include invalid `regexFilter` patterns, invalid `resourceTypes` values, or conflicts between `initiatorDomains` and `requestDomains` being set to identical values. The `catch` block in `installHeaderRules` (lines 185-196) captures the error message, which should be checked to identify the real failure reason.

The redirect and query DNR rules in `packages/extension/src/dnr.ts` use `initiatorDomains` only (lines 67-68 for redirect, lines 90-91 for query). This difference does not explain why header rules fail while redirect/query succeed, since both use valid Chrome fields.

**When `installHeaderRules` fails, no IDs are added to `installedRuleIds`.**

In `packages/extension/src/installer.ts`:
- Lines 179-196: If `updateDynamicRules` throws, the `catch` block pushes errors for all rules but does NOT push any IDs to `installed`. The `installed` array remains empty.

In `packages/extension/src/service-worker.ts`:
- Lines 320-325: Since `result.installed` is empty, no header rule IDs are pushed to `installedRuleIds`.

**`computeRuleStatuses` marks uninstalled enabled rules as "error".**

In `packages/browser-core/src/status.ts`:
- Lines 62-74: If a rule's `ruleId` is not in the `installedRuleIds` set, the status is "error" with a `core.rule-not-installed` diagnostic.

**The `operationStatuses` function passes through "error" for header rules.**

In `packages/extension/src/service-worker.ts`:
- Lines 188-197: For `kind === "header"` operations, the status is returned as-is unless it's "active". If `computeRuleStatuses` returned "error", it stays "error".

**Contrast with redirect/query rules:**

In `packages/extension/src/service-worker.ts`:
- Lines 198-206: For redirect/query operations, if the status is "active" OR "error", it's overridden to "active". This means redirect/query rules that failed to install through DNR still show as "active" (a separate issue, but it explains why redirect/query show active while headers show error).

**Root cause summary for Bug 2:**

1. `installHeaderRules` in `installer.ts` calls `updateDynamicRules` which fails for some reason (not due to `requestDomains` — that field is valid per Chrome docs).
2. The `catch` block returns errors for all header rules and an empty `installed` list.
3. No header rule IDs are added to `installedRuleIds`.
4. `computeRuleStatuses` marks header rules as "error" (not installed).
5. `operationStatuses` passes through the "error" status for header rules.

**Additional issue: `projectState` pushes IDs unconditionally after `installHeaderRules`.**

In `packages/extension/src/service-worker.ts`:
- Lines 320-325: The loop pushes `projection.ruleId` to `installedRuleIds` for every `result.installed` entry. But `installHeaderRules` returns an empty `installed` array on failure, so no IDs are pushed. This is actually correct behavior for the failure case, but the comment suggests the intent was to always push.

## Constraints and invariants

- The extension must not depend on the runtime package (package boundary rule). Header rule installation uses a separate Chrome DNR API path from redirect/query rules.
- Chrome's declarativeNetRequest API (Chrome 101+) has `requestDomains` and `initiatorDomains` as general `RuleCondition` fields valid for all action types including `modifyHeaders`. Both redirect/query rules and header rules can use either field.
- The `computeRuleStatuses` function in browser-core is a pure function that returns "error" for any enabled, granted rule that is not in the `installedRuleIds` set.
- The `operationStatuses` function in service-worker overrides "error" to "active" for redirect/query rules but passes through "error" for header rules.

## Open questions

1. **What is the actual error message from `updateDynamicRules` when header rules fail?** The `catch` block in `installHeaderRules` (installer.ts:185-196) captures the error. Checking this message will reveal whether the failure is due to an invalid `regexFilter`, invalid `resourceTypes`, a conflict between identical `initiatorDomains`/`requestDomains`, or another cause. This is the primary investigation needed for Bug 2.

2. **Why does `operationStatuses` override "error" to "active" for redirect/query but not for headers?** Lines 198-206 show `if (status.status === "active" || status.status === "error") { ... status: "active" }` for redirect/query. This means redirect/query rules that fail DNR installation still show as "active" — a potential separate bug or intentional design choice.

3. **Should `runtimeRecoveryText()` be conditional on the error type?** The recovery text could vary: "install the host" for missing host, "check host logs" for crashed host, etc.

4. **Should the banner always show the install command when the runtime is in a failed state?** Currently it only shows when the specific diagnostic code matches. An alternative would be to always show the command with appropriate context text.
