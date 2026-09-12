# PLAN: runtime-error-fixes

## Goal

Fix two Chrome extension bugs: (1) the yellow runtime-error banner promises "Run the install command below once" but displays no command when the native host crashes after being installed, and (2) header rules (rule-header-set, rule-header-remove) show "error" status while redirect/query rules show "active", due to header DNR installation failing from an invalid `requestDomains` condition field and status-pass-through asymmetry.

## Non-goals

- Changing the `operationStatuses` override behavior for redirect/query rules (the "error → active" override at service-worker.ts:198-206 is a separate concern; changing it would widen scope to redirect/query error visibility).
- Adding new user-facing diagnostics text beyond what the two bugs require.
- Refactoring the `installHeaderRules` or `createDnrInstaller` abstractions.
- Changing public APIs, wire formats, or storage schemas.
- Changing the `computeRuleStatuses` logic in browser-core.

## Architecture

### Bug 1: Missing install command in runtime error banner

**Root cause:** When the native host crashes after connecting, the diagnostic code is `extension.native-runtime-transition` (service-worker.ts:658), not `extension.native-host-missing`. The `installCommand` state in extension-page-entry.ts is only populated for `extension.native-host-missing` or `extension.request-body-needs-trust` (lines 1137-1146). But `runtimeRecoveryText()` (lines 147-163) unconditionally promises "Run the install command below once" for any error containing "host". The banner at lines 740-748 only renders the `<code>` element when `installCommand` is truthy.

**Design:** Always render the install command in the runtime guidance banner when the runtime is in a failed phase and the recovery text mentions an install command. Construct the command from the extension ID rather than gating on the diagnostic code. This is the smallest change that eliminates the "promise but no delivery" mismatch.

**Rationale:** The install command (`rogatio runtime install --extension-id <id>`) is useful whenever the native host may be missing or broken — it is idempotent and safe to re-run. Tying its visibility to specific diagnostic codes creates a gap when the host crashes rather than being missing.

### Bug 2: Header rules show "error" status

**Root cause:** `installHeaderRules` in installer.ts builds DNR `modifyHeaders` rules with both `initiatorDomains` and `requestDomains` set to the same hostname list (lines 124-125). The `catch` block (lines 185-196) returns an empty `installed` array. The exact Chrome rejection reason is not confirmed — the research notes `requestDomains` is documented as valid for `modifyHeaders` rules (Chrome 101+), so the failure may stem from another condition field (e.g., invalid `regexFilter`, `resourceTypes`, or a conflict with identical `initiatorDomains`/`requestDomains` values). Regardless of the exact rejection reason, `computeRuleStatuses` marks uninstalled header rules as "error" (status.ts:62-74), and `operationStatuses` passes that through for headers (service-worker.ts:188-196) while overriding it to "active" for redirect/query (service-worker.ts:198-206).

**Design:** Remove `requestDomains` and `excludedRequestDomains` from the header rule condition in `installer.ts:toDnrRule`. Redirect and query rules already use only `initiatorDomains` successfully. This aligns header rules with the working redirect/query pattern.

**Rationale:** `requestDomains` on a `modifyHeaders` rule is redundant when `initiatorDomains` already scopes the rule to the matching origins. Chrome DNR does not require both. Removing the redundant field eliminates the installation failure while preserving identical runtime behavior.

## Phases

### Phase 1: Fix Bug 1 — always show install command in failed-runtime banner

In `extension-page-entry.ts`, modify the runtime guidance section (lines 722-749) to always render the install command when the runtime phase is "failed" or "unsupported" and the recovery text mentions running an install command. Remove the `installCommand` truthiness guard from the `<code>` rendering block (lines 740-748). Instead, always construct the command string inline from `extensionId()` when the guidance section is visible and the recovery text matches the install-command pattern. Update `runtimeRecoveryText()` to conditionally vary the message: "install the host" for `native-host-missing`, "re-run the install command" for `native-runtime-transition`.

### Phase 2: Fix Bug 2 — remove requestDomains from header DNR rules

In `installer.ts`, modify `toDnrRule` (lines 94-136) to remove `requestDomains` and `excludedRequestDomains` from the condition object (lines 124-129). Keep `initiatorDomains` and `excludedInitiatorDomains` (lines 118-123). No other files change for this fix.

### Phase 3: Tests

Add targeted tests to verify:
1. Header DNR rules are built without `requestDomains` or `excludedRequestDomains` — assert `toDnrRule` output condition shape (new `installer.test.ts`).
2. `installHeaderRules` returns installed IDs when `updateDynamicRules` succeeds — mock the Chrome DNR API (new `installer.test.ts`).
3. `computeRuleStatuses` returns "active" for installed header rules — existing `status.test.ts` covers this pattern; verify no regression.

### Phase 4: Verification

Run `pnpm validate` to confirm format, lint, typecheck, unit tests, and integration tests pass.

## Risks

1. **Unknown Chrome DNR error cause:** The research notes that `requestDomains` is documented as valid for `modifyHeaders` rules, so the exact Chrome rejection reason is not confirmed. The fix removes the field, which aligns with the working redirect/query pattern. If Chrome rejects header rules for a different reason, the test will catch it. **Mitigation:** The test in Phase 3 verifies the rule shape; a real-Chromium test (if available) would confirm Chrome accepts the rule.

2. **Scope creep on `operationStatuses`:** The redirect/query override (error → active at lines 198-206) is a separate design choice. Changing it would affect redirect/query error visibility. **Mitigation:** Explicitly out of scope. If the user wants to address it later, a separate plan is needed.

3. **Install command redundancy:** Showing the install command for `native-runtime-transition` may confuse users whose host was never missing. **Mitigation:** The recovery text already varies between "install the host" and "re-run the install command". The diagnostic error line in the banner provides context.

4. **No public API changes:** The fix does not change diagnostic codes, wire formats, or storage schemas.

## Acceptance criteria

### Bug 1

- When runtime phase is "failed" and the error contains "host", the yellow guidance banner shows the install command text (`rogatio runtime install --extension-id <id>`) with a copy button.
- When runtime phase is "failed" and the error does not contain "host", the banner still shows the install command if the recovery text mentions running it.
- The recovery text varies by error type: "install the host" for `native-host-missing`, "re-run the install command" for `native-runtime-transition`.
- Existing tests for `extension.native-host-missing` and `extension.request-body-needs-trust` still pass.

### Bug 2

- Header DNR rules constructed by `toDnrRule` do not include `requestDomains` or `excludedRequestDomains`.
- Header DNR rules include `initiatorDomains` and `excludedInitiatorDomains` (unchanged).
- A header rule projection installs successfully through `installHeaderRules` (no error, IDs returned).
- `computeRuleStatuses` returns "active" for installed header rules.
- Existing redirect/query DNR tests continue to pass.

## Implementation strategy

**Code first with targeted tests.** The changes are small and isolated (two function bodies in two files, plus tests). TDD is unnecessary overhead for removing a field and widening a guard condition. Each phase will be verified by running the existing test suite plus the new targeted tests.

