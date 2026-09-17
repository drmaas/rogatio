# Checklist: console-match-logging

Companion to `plan.md`. Ephemeral — delete on release.

TDD each phase: write the tests below first; they must fail; then implement. Phase verify = that package's tests (existing suites must stay green). Full `pnpm validate` at P7. Contracts skipped.

## P0 — Schema, compiler, editor, browser-schema

Two TDD blocks, one human gate. No Chrome logging. Block A must typecheck before Block B.

### Block A — schema, compiler, browser-schema, fixture sweep

- [x] Schema rule object (`packages/schema/src/schema.ts`, `types.ts`): one optional boolean `redactSensitiveInLogs`. Project version stays 1. `additionalProperties: false` unchanged. Do **not** add JSON Schema `default` (AJV defaults mutate input). Compiler/editor treat absent as **false**. No `redactBodiesInLogs`. No new semantic-validation rule.
- [x] Compiler: every `RogatioOperation` carries `redactSensitiveInLogs` as a resolved boolean. Source absent → `false`. Explicit `false` / `true` preserved. Do not put the flag on the matcher-only nested object.
- [x] `packages/extension/src/browser-schema.ts` `RULE_KEYS` + type checks: boolean only; unknown keys (including `redactBodiesInLogs`) still fail.
- [x] Add the resolved boolean to every `RogatioOperation` object literal (compiler, extension, dry-run, cli, runtime, browser-core tests) so workspace `tsc` stays green. DNR/projection expected JSON must **not** grow that key.
- [x] Do not change `browser-core` behavior, dry-run matching, runtime, or samples (absent flag = do not redact).

**Acceptance:** AC14.
**Tests (write first):**
- Schema: valid with omitted, true, false; reject `"true"`, `1`, extra rule key, `redactBodiesInLogs`.
- Schema mutation: clone a project with the flag omitted, `validateProject`, assert the clone still has no key (no AJV default).
- Compiler: omit → `{ redactSensitiveInLogs: false }` on redirect, query, header, request-body, response-body, matcher ops; explicit `true` and `false` preserved; `operation.matcher` has neither key.
- `browser-schema.ts`: same allow/reject/omit-does-not-inject cases as schema.
- Existing DNR/projection expects: Chrome rule objects have no redact keys.

### Block B — editor checkbox

Env: existing `// @vitest-environment happy-dom` (not jsdom). Do not add testing-library.

- [x] Editor: one checkbox after Request constraints on **non-body** rule cards only (redirect, query, header, matcher). Accessible name **Redact sensitive fields in logs**. Body cards (`request-body`, `response-body`) do not render it. No body-redact checkbox.
- [x] Checked only when stored value is boolean `true`. Omitted/`false` unchecked. Uncheck writes `false`; check writes `true`. Add the key to `CREATABLE_RULE_FIELDS`. Do **not** add it to `ACTION_PAYLOAD_FIELDS` (type change must keep it). Wire `change` with `target.checked` (existing `input` handler skips checkboxes; `change` currently writes `target.value` `"on"`).
- [x] Type change does not strip the flag. Switching to a body kind hides the checkbox.

**Acceptance:** AC15.
**Tests (write first):**
- One checkbox found by walking `label` text (accessible name) on a redirect card and a matcher card. Do not add testing-library.
- Request-body and response-body cards: that accessible name is absent.
- Omitted key and stored `false` → unchecked. Only boolean `true` → checked.
- Dispatch `change` on uncheck → draft `false`; check → draft `true` (booleans, not `"on"`). Dispatch `input` → draft unchanged.
- Switch rule type; flag remains on the draft and on a save snapshot. Switching to a body kind hides the checkbox.

## P1 — Chrome surface

- [x] Add `"declarativeNetRequestFeedback"` and `"scripting"` to `permissions` in `packages/extension/public/manifest.json`. Do not touch `optional_host_permissions`.
- [x] Extend `ChromeApi` (`src/chrome.ts:47-61`): optional `declarativeNetRequest.onRuleMatchedDebug.addListener(...)` and optional `scripting.executeScript(...)`. Type the debug payload as `rule.ruleId`, `request.url`, `request.tabId`, `request.method`, `request.initiator`, `request.type` (`method` / `initiator` / `url` / `type` optional strings).
- [x] Update existing fakes so injected adapters still typecheck. Do not add `tabs`.
- [x] Leave `createStorageAdapter` reading/writing only `rogatio`.

**Acceptance:** AC11 (manifest + ports); no behavior change.
**Tests (write first):**
- Read source `manifest.json`: permissions include the two new names; `optional_host_permissions` equals today's list.
- Runtime: existing fake that omits both new ports still constructs and runs (`packages/extension/test/chrome.test.ts`). Optional-port assignability is `tsc` (a required port would fail typecheck).
- Existing storage tests: adapter `get`/`set` still only the `rogatio` key.

## P2 — Durable id index

- [x] New module (e.g. `src/match-index.ts`): read/write `rogatio.matchLogging.index` as numeric DNR id → `{ ruleId, kind, redactSensitiveInLogs, intent }`. `intent` is kind-discriminated only:
  - redirect: `{ destination }`
  - query: `{ params: [{ name, operation, value? }] }`
  - header (P6 only): `{ direction, operation, name, value? }`
- [x] Do **not** store matcher regex, origins, resourceTypes, groupId, event URL, body payloads, or `redactBodiesInLogs`.
- [x] At write: resolve the flag (absent/`false` → false; `true` → true); truncate every stored string to ≤200 with `...`; if `redactSensitiveInLogs`, apply the same deny-list the formatter uses (query keys on destination/query values; header-name deny-list on header values).
- [x] `createDnrInstaller.install` (`src/dnr.ts:124-163`) is the sole writer for now. After **successful** `updateDynamicRules`, replace the key wholesale with the post-collision-probe ids actually installed (empty install → `{}`).
- [x] On **failed** `updateDynamicRules`, do not write. Previous index stays (same as in-memory `tracked`).
- [x] Lookup reads storage (not `tracked`) so it survives a service-worker restart. Treat the value as untrusted: wrong types / inherited keys / accessors → skip that entry.
- [x] Existing `dnr.test.ts` fakes must grow `storage.local` with Chrome's `{ [key]: value }` `get` shape so current install tests keep passing.
- [x] Unknown or malformed id returns `undefined`; never recompute from `ruleIdHash`.
- [x] Do not write this key from popup, management page, or `installHeaderRules`.

**Acceptance:** AC10, AC12, AC18, K5, K9, K12. Index never lands inside the `rogatio` envelope. Header ids are not installed here — header write-time tests use the shared write helper with a synthetic intent object.
**Tests (write first):**
- Install writes `redactSensitiveInLogs` + redirect/query intent; collision-probed id is indexed under its final numeric id. Absent source flag stores `false`. Stored entries have no `redactBodiesInLogs`.
- Persist, then construct a **new** installer instance (simulated SW restart); lookup hits storage. Fake `get(key)` must return `{ [key]: value }` like Chrome, not the raw value.
- Round-trip through an object whose keys are strings (`JSON.parse(JSON.stringify(stored))`); lookup by number still works.
- Failed install keeps previous entries; successful empty install writes `{}`.
- Unknown id → `undefined`; `__proto__` / accessor / non-object / array storage → no throw, no guess.
- After a write: `rogatio` envelope key unchanged; no event URL; no regex/origins; no body payload. Destination/query strings truncated even when the flag is false.
- Sensitive flag true: deny-listed query keys in stored destination/query intent become `[redacted]`. Flag false: truncated plaintext (no deny-list).
- Write helper (not DNR install): synthetic header intent — deny-listed header **name** redacts the stored value iff sensitive is true; always truncate; no `body` field on the entry; no `redactBodiesInLogs`.

## P3 — Redaction + formatter (pure)

Do this phase first alongside P0 (no Chrome).

- [x] `redactUrl(url, { redactSensitive })`: drop userinfo and fragment; if `redactSensitive`, replace deny-listed query values with `[redacted]`; if longer than 200 characters, cut so the result is ≤200 and ends with ASCII `...`.
- [x] Query-key deny-list per research Q2 (case-insensitive **substring** on the key). Header-name deny-list: frozen forbidden lists plus `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token` (case-insensitive exact name). Import nothing from Node `schema` / Ajv; `browser-schema.ts` only if a shared helper is already there.
- [x] `truncateLogString(value)`: same 200/`...` bound for initiator, destination, header values, query values, method, resource type.
- [x] `formatMatchRecord(...)`: single line, `\x1B[1;34m[rogatio]\x1B[m`, unstyled `matched` + method + resource type + redacted request URL, `\x1B[2m` detail (`ruleId`, kind, intended action, initiator). Field order as in `plan.md`. Wording stays "matched / intended action" — never claims the network mutation succeeded.
- [x] Intended action from index intent, not from the Chrome event. Resource type from the event (`request.type`), not from rule config. No body argument, no body segment.
- [x] When `redactSensitiveInLogs` is false: still drop userinfo/fragment and truncate; do not deny-list.

**Acceptance:** AC2, AC3, AC4, AC16, AC18.
**Tests (write first):**
- Deny-list on: each Q2 key; uppercase; substring (`token` redacts `tokenizer`, `key` redacts `api_key`, `code` redacts `encode`). Cover request URL, initiator, destination, and query-transform values.
- Deny-list off: those values stay truncated plaintext.
- Userinfo and fragment always removed from URL, initiator, and destination (flag on and off). Remaining query order stable (do not depend on engine iteration order).
- Header-value table: include one frozen-seed name (`cookie`) and one extra (`x-api-key`); `[redacted]` iff sensitive true; other names truncated only. Flag off: deny-listed header values truncated, not replaced.
- Always truncate: 199 → no `...`; 200 exact → no `...`; 201+ → ≤200 and ends with `...`, per field, **with the flag false**.
- Format-time re-apply: sensitive true + oversize/unredacted destination/query/header from a tampered index → still `[redacted]` and ≤200.
- Extra `body` / `requestBody` keys with unique sentinels do not appear in the string.
- Snapshots: redirect includes destination; query includes set and remove (remove has no `=value`); header-intent `direction`/`op`/`name`/`value` (formatter only; P6 still gates id lookup); method, resource type, and initiator when provided; omitted initiator/method/type add no placeholder; no body segment; SGR as in A5; `[rogatio]` not `[Rogatio]`; no `%c`; no `#`; mentions matched/intended, not "succeeded".
- Adversarial: malformed / relative / `data:` URLs; redirect destination with `\\1` backrefs (opaque, bounded, no throw); duplicated keys; `__proto__` / accessor inputs; very long values; non-string inputs; `%s` / `%c` in URL (must appear as data, not interpret as format).

## P4 — Listener + injection

- [x] New module imported from `background.ts` (Chrome boundary). Do not put the listener inside `createExtensionApplication` / protocol. Unit tests import the module, **not** `background.ts`.
- [x] Per match: toggle off/garbage → return; `tabId === -1` → return; index miss / malformed entry → return; otherwise format (event URL/method/initiator/type + index intent/flag) and `executeScript({ target: { tabId }, world: "ISOLATED", func, args })`. Do not set `allFrames`. `tabId` only from the Chrome event.
- [x] Export the injected `func`. It is closure-free. `console.log("%s", line)` only. All content arrives through JSON-serializable `args`. No `chrome.*` inside `func`.
- [x] Wrap injection in try/catch; a rejection is a silent no-op.
- [x] Toggle accessor reads `rogatio.matchLogging.enabled`; **default on** (missing → on). Boolean `false` or any non-boolean = off. Per-match read; no `onChanged` cache.
- [x] Absent `onRuleMatchedDebug` **or** absent `scripting.executeScript` → register nothing / never throw.
- [x] No batching, no dedupe cache, no queue, no keepalive. No webRequest. No native-host log path.

**Acceptance:** AC1, AC4, AC5, AC9, AC13, AC16, AC18.
**Tests (write first), fake `ChromeApi`:**
- Separate redirect vs query match → exactly one `executeScript` each: `world: "ISOLATED"`, no `allFrames`, `tabId` from the event. Redirect line has intended destination; query line has intended param ops; both include method, initiator, and resource type when the event supplied them. Absent method/initiator/type → no placeholder.
- Index `redactSensitiveInLogs: false` → injected line has truncated plaintext deny-listed query value, not `[redacted]`. Flag true → `[redacted]`.
- Extra `body` field (unique sentinel) on the index entry is ignored (no sentinel, no body segment).
- Two matches → two calls (no dedupe).
- Toggle `false` / `"true"` / `1` → zero calls. Toggle **missing** → one call (default on).
- `tabId -1` / unknown id / malformed index entry / header id `2_000_001` (pre-P6) → zero calls, no throw.
- `executeScript` rejection → no throw, no retry.
- Absent `onRuleMatchedDebug` → `addListener` never called. Absent `scripting` with event present → no throw, zero injections.
- After a successful match: storage keys are only envelope / enabled / index; index JSON has no event URL.
- Call exported `func` with the same `args` `executeScript` will pass. Spy `console.log`; calls are `[["%s", line]]`. `%s`/`%c` inside `line` stay data.

## P5 — Toggle UI

- [x] Popup action row (`src/popup.ts:228-254`): labeled checkbox reusing the existing toggle pattern (`:295-308`). Accessible name **Match logging**.
- [x] Management sidebar (`src/extension-page-entry.ts:397-435`): same control, same storage key, same accessible name, design-system tokens only.
- [x] Both read/write `rogatio.matchLogging.enabled` only. **No new protocol command**. Do not touch `rogatio` or `rogatio.matchLogging.index`.
- [x] Keyboard operability; no new tab, no layout redesign. Default **checked** when the key is missing.

**Acceptance:** AC8; both surfaces reflect the same persisted value.
**Tests (write first):**
- Do **not** add jsdom. Extension unit env is `node`.
- Playwright fake-chrome (same pattern as `test/browser/extension.spec.ts`, including `runtime.sendMessage` for popup `get-state`):
  - Management: `/extension/index.html` — checkbox "Match logging" writes `rogatio.matchLogging.enabled` true then false; missing key renders checked; re-render still shows the stored value; `rogatio` and index keys untouched.
  - Popup: `/extension/popup.html` — same assertions. `extension.spec.ts` is the management page, not the popup; add a popup test (same file or a sibling spec).
- Unit: if a tiny enabled-key helper is extracted, cover missing (= on) / non-boolean (= off) / `true` / `false`. Do not import `popup.ts` in Vitest (it requires `#rogatio-popup-root` at load).
- Editor redact checkbox stays P0 unit tests. Do not add a Playwright editor journey for it.

## P6 — Header coverage probe (gate)

Two steps. Stop after step 1 and record the result before any header-index code.

- [x] **Step 1a — header event.** Real-Chromium probe alongside `test/browser/header-dnr-probe.spec.ts`. Install a `modifyHeaders` rule that matches the Playwright smoke origin (`http://127.0.0.1:4173`), not `example.com` (that origin was only for rule-shape acceptance). Navigate or fetch a matching URL, then assert whether `onRuleMatchedDebug` fired. Do not use a wall-clock idle wait. Do not add a production test hook. **Result: pass** — xhr probe fired; redirect positive control confirmed harness. Host permission seeded via profile prefs (`extensionContext({ grantOrigins })`).
- [x] **Step 1b — Q4 wake.** Install a `redirect` or `query` rule for the smoke origin first. Stop the extension service worker via CDP (not a 30s sleep). Do not open an extension page after the stop (that would wake the worker itself). Only navigate the matching smoke URL. Pass = worker is alive again. If CDP stop is unavailable, record **inconclusive** and ship without keepalive. **Result: pass** — CDP `ServiceWorker.stopWorker` terminated worker; smoke-origin navigation revived it.
- [x] **Step 2 — only if 1a passed.** Extend the **same** index snapshot (still one wholesale write) with header ids (positional `2_000_001 + index`, `src/projection.ts:263`) **including header intent** `{ direction, operation, name, value? }` plus the sensitive flag. Do not add a second writer in `src/installer.ts`. Then a header match in the P4 fake must inject a line that includes intended header name/value. **Done:** `match-index.ts` + `dnr.ts` `syncHeaderMatchIndex`; `match-listener.test.ts` header id `2_000_001` injects intended fields.
- [x] **If 1a failed or inconclusive.** Stop. Ship `redirect` + `query`; record the result in `plan.md` and the docs. P4 header-id no-op test stays. **N/A** — 1a passed.

**Acceptance:** AC6, AC17; documented coverage matches the probe result exactly.
**Tests:** the probe file is the evidence — assert pass/fail/inconclusive, not an assumption. No 30s `waitForTimeout` for idle.
**If 1a passed (write first, then code):** P4 fake header id `2_000_001` injects a line with intended `direction`/`op`/`name`/`value`. Sensitive true + deny-listed header name → `[redacted]` value. Sensitive false → truncated plaintext value. Extra body field still adds no body segment.

## P7 — Docs + validation

- [ ] `docs/architecture.md:90`, `:735` — replace "deferred" with shipped behavior, permissions, unpacked requirement, coverage, live vs intended fields (including resource type), **no live bodies**, toggle-key + index-key exception to envelope-only storage, per-rule redact flag (default off, non-body cards only).
- [ ] `rogatio-overview.md:38`, `packages/docs-site/src/content/docs/guides/extension.md:33-38`, `.../reference/extension.md:26` — lowercase `[rogatio]`, **Match logging** default on, editor redact checkbox, coverage, "matched ≠ succeeded", bodies not logged, body-rule logging **tracked in GitHub issue #163**.
- [ ] State the `declarativeNetRequestFeedback` unpacked-only constraint and the `tabId -1` / out-of-origin-tab / iframe-top-frame limitations. Include Q4 result if measured.
- [ ] Run `pnpm validate`; record evidence against AC1–AC18.

**Acceptance:** AC7, AC11.
**Tests:** `pnpm validate` green; browser suites unchanged except the P5/P6 additions. Grep the listed docs: no "deferred", no `[Rogatio]`, no `redactBodiesInLogs`; bodies not logged / live vs intended stated; one redact checkbox, not two.
