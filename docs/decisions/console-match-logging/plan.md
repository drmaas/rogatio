# Plan: console-match-logging

**Base:** `c63d0b3` (main) · **Branch:** `feature/console-match-logging`
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/console-match-logging`
**Inputs:** `docs/decisions/console-match-logging/prd.md`, `docs/decisions/console-match-logging/research.md`
**Contracts:** `skipped`

Amended after architecture-security + product lock (2026-09-16): richer records, one per-rule redact checkbox (default off), live resource type, no `redactBodiesInLogs`, body-rule logging deferred to GitHub issue #163. A9 “schema untouched” remains overturned.

## Goal

When Chrome authoritatively reports that a Rogatio-installed DNR rule matched, emit exactly one bounded, live-only `[rogatio]` line into the matched page's DevTools Console, under a user-controlled **Match logging** toggle (**default on**). The line includes live method, initiator, URL, and resource type (`request.type`) from the event, plus **intended** redirect / query / header action from rule config. Ship `redirect` + `query`; add `header` only if a real-Chromium probe proves `onRuleMatchedDebug` fires for `modifyHeaders`. Body-kind matches are not logged; that desire is **tracked in GitHub issue #163**.

Traces PRD R1–R9.

## Non-goals

- No match history, persisted log, management-page feed, or badge integration (R5).
- No `matcher`, `request-body`, or `response-body` coverage — no DNR rule, so no Chrome-authoritative signal (R6). Body-rule match logging (payload + redact option) is **tracked in GitHub issue #163**.
- **No live request/response bodies** and **no intended body rewrite on the console line** this slice. Do not add `webRequest`, debugger, or native-host match logging.
- **No `redactBodiesInLogs` field** and no body-redact checkbox.
- No logging of wire-applied header values (the event does not include them). Intended header ops come from rule config after the header probe passes.
- No change to DNR projection semantics, dry-run matching, or CLI verify beyond compiling the one new optional rule boolean.
- No `content_scripts` entry, no `registerContentScripts`, no `MAIN` world, no `tabs` permission, no broad host patterns.
- No change to existing service-worker `[rogatio]` debug logs (different console; out of scope).
- No Firefox, no telemetry. Popup/management: only the **Match logging** control. Editor: only the one redact checkbox, and only on non-body rule cards.
- No batching, dedupe cache, match queue, keepalive, `onChanged` toggle cache, or protocol command.
- No whole-line 200-character cap (that would erase the extra fields). Bound is **per logged string**.

## Architecture (locked ADRs)

| # | Title | Choice | ADR |
| --- | --- | --- | --- |
| A1 | Authoritative match source | `chrome.declarativeNetRequest.onRuleMatchedDebug` only; no `getMatchedRules` polling; no `webRequest` / debugger / native-host body observation. | `docs/adrs/0001-dnr-on-rule-matched-debug.md` |
| A2 | Page emission | `chrome.scripting.executeScript` into event `tabId`, `world: "ISOLATED"`, `console.log` with `"%s"` for untrusted text. | `docs/adrs/0002-isolated-execute-script-console.md` |
| A3 | Numeric-id → log-intent lookup | SW-only `rogatio.matchLogging.index`: `numericId → { ruleId, kind, redactSensitiveInLogs, intent }`. Intent is a **kind-discriminated subset** of the compiled action (destination / query params / header op), not a full `RogatioOperation`. Wholesale rewrite on successful DNR install; failure leaves previous index. Lookup must work after a storage round-trip (object keys are strings). | `docs/adrs/0003-durable-dnr-match-index.md` |
| A4 | Toggle persistence | `rogatio.matchLogging.enabled` outside the envelope. Popup and management write that key only. No protocol command. Missing key = on; only boolean `false` or garbage is off. | `docs/adrs/0004-match-logging-toggle-storage.md` |
| A5 | Record shape | Single flat line, ANSI SGR (`\x1B[1;34m` prefix, unstyled message, `\x1B[2m` detail). No `groupCollapsed`, no `%c`. Live fields from the event; intended action from the index. | `docs/adrs/0005-console-match-record-redaction.md` |
| A6 | Redaction | Pure formatter in `packages/extension` (no Node `schema` / Ajv). Per logged string: drop URL userinfo/fragment; truncate so that string is ≤200 characters with trailing ASCII `...` when cut. When `redactSensitiveInLogs` is true: query-key deny-list → `[redacted]`; intended header values whose names are on the header deny-list → `[redacted]`. When the flag is absent or false: still truncate; do not apply the deny-list. Destination/`initiator` that fail URL parse are opaque strings: still truncate, never throw. | `docs/adrs/0005-console-match-record-redaction.md` |
| A7 | Rule-kind coverage | `redirect` + `query` now; `header` gated on the Chromium probe; `matcher` and body kinds out. Header **id lookup** (injected intended header fields) only after a header pass. Formatter may test header-intent anytime. | `docs/adrs/0006-match-logging-rule-kind-coverage.md` |
| A8 | Failure posture | Fail closed and silent: missing event, missing permission, toggle off/garbage, `tabId === -1`, unknown/malformed index entry, or injection rejection. | 0001, 0002, 0003 |
| A9 | Per-rule redact flag | One optional boolean on the source rule: `redactSensitiveInLogs`. Absent/omitted → `false` (do not redact). Present on all rule kinds except body rules (`request-body`, `response-body`). Schema + compiler + editor + `browser-schema.ts`. `browser-core` untouched. No `redactBodiesInLogs`. | `docs/adrs/0007-per-rule-log-redaction-flags.md` |

### What bodies can and cannot be logged

`onRuleMatchedDebug` `RequestDetails` = `url`, `initiator`, `method`, `type`, `tabId` (+ frame/document/request ids). **Not** live request/response bodies. **Not** header values from the wire.

| Source | Field | This feature |
| --- | --- | --- |
| Chrome event | URL, method, initiator, resource type (`request.type`) | Yes (live) |
| Chrome event | Request/response body | **No — API has none** |
| Chrome event | Applied header values | **No — API has none** |
| Rule config via index | Redirect destination, query transform | Yes (intended) |
| Rule config via index | Header name/value/direction/op | Yes (intended), after P6 header pass |
| Rule config | Intended body replace/rewrite | **No** — body kinds have no DNR match event; **tracked in GitHub issue #163** |
| Native runtime / webRequest / debugger | Live bodies | **No** — conflicts with non-goals; new spike if product insists |

No body-redact checkbox. Body-rule match logging (payload + redact option) is **tracked in GitHub issue #163**.

### Trust edges

```
Chrome DNR event (trusted)
  → service worker (only executeScript caller; only index writer)
  → chrome.storage.local
       rogatio                      SW envelope adapter only (already holds action strings)
       rogatio.matchLogging.enabled popup + management + SW (read); UI may write
       rogatio.matchLogging.index   SW write/read; treat as untrusted on read
                                    (log-intent duplicate of envelope action fields; bounded)
  → executeScript ISOLATED (extension func, preformatted args)
  → page DevTools console (visible; page JS cannot touch isolated `console`)
```

Page cannot enable logging or supply `tabId`. Injected func must not call `chrome.*`. Do not persist match URLs (event URL stays in memory for that format call only).

Index leak: `chrome.storage.local` is readable from extension pages. Envelope already holds destinations, header values, and bodies. The index is a second, **bounded** copy of the log-intent subset (not regex/origins/full operation, not live URLs). UI must not read or write the index. Write-time truncate (and deny-list when the sensitive flag is true) so a storage dump is not unbounded.

### Surface changes that need explicit sign-off

- **Schema (`packages/schema`)**: one optional boolean `redactSensitiveInLogs` on the rule object (`additionalProperties: false`). Project version stays 1. Reject `redactBodiesInLogs` as an unknown key.
- **Compiler**: pass `redactSensitiveInLogs` onto every `RogatioOperation`, resolving absent → `false`.
- **Editor**: one checkbox on non-body rule cards only (redirect, query, header, matcher — after Request constraints). Accessible name **Redact sensitive fields in logs**. Checked only when stored value is boolean `true`; omitted/`false` unchecked. Body cards (`request-body`, `response-body`) do not show it.
- **`packages/extension/src/browser-schema.ts`**: allow that one key; type-check boolean. Mirror, do not import Node Ajv.
- **Manifest (`packages/extension/public/manifest.json`)**: add `"declarativeNetRequestFeedback"` and `"scripting"` to `permissions`. Event remains unpacked-only. `optional_host_permissions` stays exactly as-is (`scripts/validate.ts:97-99`).
- **`ChromeApi` (`packages/extension/src/chrome.ts:47-61`)**: optional `declarativeNetRequest.onRuleMatchedDebug` and optional `scripting.executeScript`. Debug payload: `rule.ruleId`, `request.url`, `request.tabId`, `request.method`, `request.initiator`, `request.type`. All request fields except `ruleId`/`tabId` may be missing; types must allow that. Both ports optional so fakes and permission-less contexts stay valid.
- **Protocol (`packages/extension/src/protocol.ts`)**: no change. A new command is a scope flag.
- **Storage**: keys `rogatio.matchLogging.enabled` (boolean) and `rogatio.matchLogging.index` (id map). Neither goes inside the `rogatio` envelope. `createStorageAdapter` keeps `get("rogatio")` / `set({ rogatio })`.
- **Wire from `background.ts`**, not `createExtensionApplication` / `parseRequest`. Put the listener in a module `background.ts` imports so unit tests never load the native-host bootstrap.
- **`browser-core`**: no change (opaque project JSON).

### Record field order (locked)

One flat line:

1. SGR prefix `[rogatio]`
2. Unstyled: `matched` + method (if present) + resource type (if present) + redacted request URL
3. Dim: `ruleId`, kind
4. Dim: intended action — redirect `→ <destination>`; query compact `set name=value` / `remove name` list; header ` <direction> <op> <name>[=<value>]` (header only after P6 pass)
5. Dim: `initiator=<redacted initiator>` if the event supplied one

Wording stays “matched / intended”; never “succeeded”. Omit a segment when the source field is absent (no `initiator=` placeholder, no fake body, no fake type).

## Phases

| Phase | Scope | Depends on |
| --- | --- | --- |
| P0 | Two TDD blocks, one gate: (A) schema + compiler + `browser-schema.ts` + `RogatioOperation` fixture sweep; (B) editor checkbox on non-body cards. No Chrome logging yet. | — |
| P1 | Manifest permissions + typed `ChromeApi` ports (url, tabId, method, initiator, type). No behavior. | — |
| P2 | Durable id index for `redirect`/`query` with `redactSensitiveInLogs` + log-intent subset; written on successful install; read after SW restart. | P0, P1 |
| P3 | Pure URL/header/query redaction + ANSI record formatter. No Chrome APIs. | P0 |
| P4 | Extracted match-log listener (imported from `background.ts`) → toggle check → lookup → format → `executeScript`. Fail-closed paths. | P1–P3 |
| P5 | Toggle UI in popup action row and management sidebar. Default on. | P4 |
| P6 | Real-Chromium probe (header event, then Q4). Header intent in the **same** index snapshot only after a recorded header pass. | P4 |
| P7 | Docs sync (`rogatio-overview.md`, `docs/architecture.md`, docs-site extension guide + reference) and `pnpm validate`. | P5, P6 |

P0 block A and P3 are independent of P1 and should go first (pure TDD). P0 block B (editor) depends on A. P6 is a gate, not a guaranteed deliverable: a failed or inconclusive probe ships `redirect` + `query` and records the result in the docs. Do not write header-index code until the header probe result is recorded. The header match probe must hit the Playwright smoke origin (`http://127.0.0.1:4173`); `example.com` in `header-dnr-probe.spec.ts` only proves Chrome accepts the rule shape.

## Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| K1 | `onRuleMatchedDebug` may not wake a terminated MV3 service worker (research Q4), silently dropping matches and weakening R1. | P6 uses CDP to stop the worker, not a 30s idle sleep. Inconclusive → document; no keepalive. |
| K2 | `modifyHeaders` match reporting is undocumented. | P6 gates header coverage; no promise in docs until the probe passes. |
| K3 | Injection fails when the top-level tab URL is outside granted origins even though a granted-origin subresource matched. | A8 no-op; documented limitation. |
| K4 | `declarativeNetRequestFeedback` makes the event unpacked-only. | A8 no-op when the event is absent; docs state the unpacked requirement. |
| K5 | Id index drifts from installed rules (partial install failure, later header ids). | Success rewrites wholesale; failure keeps previous index; unknown id is a no-op. P6 must not add a second wholesale writer. |
| K6 | Redaction under-covers and a secret reaches the console. | Deny-list when the sensitive flag is on; always truncate; never emit live bodies or wire headers; adversarial unit tests. Path secrets and flag-off truncated secrets are accepted residual. |
| K7 | Scope creep into batching, dedupe caches, match queues, keepalive, a management-page feed, or live-body capture. | Explicit non-goals; reviewer rejects any such task. |
| K8 | Default toggle — **resolved: default on**. | Missing key enables logging; boolean `false` or non-boolean disables. |
| K9 | `chrome.storage.local` is writable from extension pages; index/toggle may be malformed or tampered. | Enable only on missing/`true`; ignore malformed index entries; never execute stored strings; re-truncate and re-apply deny-list at format time. |
| K10 | Untrusted URL/`ruleId`/initiator/destination with `%s`/`%c` if passed as the `console.log` format string. | Injected call is `console.log("%s", line)` only. |
| K11 | Broad rules flood the page console (one line per match). | Accepted. Toggle off is the control. No batching. |
| K12 | Index duplicates intended action strings (header values, destinations). | Subset only; write-time bound; SW sole writer; UI must not read it. Same class of secret already in the envelope. |
| K13 | Users expect a console line when a body rule matches. | Out of scope this slice; **tracked in GitHub issue #163**. No body checkbox. |
| K14 | Product or users expect live bodies / wire headers. | PRD Q6 closed; docs state the API limit. New spike required to change this. |

## Acceptance criteria

| ID | Criterion | Trace |
| --- | --- | --- |
| AC1 | A Chrome match event for a known `redirect`/`query` id (toggle on, real `tabId`) yields exactly one isolated `executeScript` whose args are the formatted line. | R1, P4 |
| AC2 | Every line's visible prefix is lowercase `[rogatio]`. | R2, P3 |
| AC3 | Formatted line uses ANSI SGR bold+blue prefix and dim detail; no `%c`, no hardcoded hex. | R3, P3 |
| AC4 | Each logged string is fragment-free and userinfo-free when it is a URL. Truncate always (≤200, trailing `...` when cut), including when `redactSensitiveInLogs` is absent or false. Deny-list on query keys (request URL, initiator, destination, query-transform values) and on header values by **name** runs **only** when `redactSensitiveInLogs` is true; flag false/absent keeps truncated plaintext. Re-apply truncate and (when flagged) deny-list at format time on untrusted index values. No live body, no wire header values. Live resource type from the event appears when present. | R4, P3 |
| AC5 | After a match, storage still has only the envelope, enabled flag, and index; index values have no event URL. | R5, P2+P4 |
| AC6 | Coverage is `redirect` + `query`, plus `header` iff P6 header probe passes; `matcher` and body kinds are absent; the formatted line has no body segment. | R6, P4+P6 |
| AC7 | Shipped docs describe the behavior, drop "deferred" and capital-`[Rogatio]`, and state live vs intended vs not-logged (bodies). Body-rule logging points at GitHub issue #163. | R7, P7 |
| AC8 | Popup and management sidebar both toggle logging (name **Match logging**); off means zero injections; missing key means on. | R8, P4+P5 |
| AC9 | Missing event, missing `scripting`/`onRuleMatchedDebug`, `tabId === -1`, unknown/malformed id, or a rejected injection is a silent no-op with no thrown error. | A8, P4 |
| AC10 | Lookup resolves correctly after a simulated service-worker restart and after a storage round-trip (string object keys), including intended destination/query fields. | A3, P2 |
| AC11 | `pnpm validate` passes; no new protocol command; `optional_host_permissions` unchanged. | repo rules, P1+P7 |
| AC12 | Failed DNR install leaves the previous index; successful empty install writes `{}`. | K5, P2 |
| AC13 | Injected `func` is invoked with `executeScript` `args`; a `console.log` spy shows `"%s"` for untrusted text and no `chrome.*`. | A2, K10, P4 |
| AC14 | Schema accepts optional boolean `redactSensitiveInLogs` and rejects non-booleans / unknown rule keys including `redactBodiesInLogs`; omitted flag stays omitted (no schema default). Compiler resolves absent → `false` on every operation kind. `browser-schema.ts` matches. | R9, P0 |
| AC15 | Editor shows one checkbox on non-body rule cards; accessible name **Redact sensitive fields in logs**; omitted/`false` unchecked; only boolean `true` is checked; `change` persists a boolean; type change does not strip the flag; body-kind cards have no redact checkbox. | R9, P0 |
| AC16 | Redirect line includes intended destination; query line includes intended param ops; method, initiator, and resource type from the event appear when present. | R4, P3+P4 |
| AC17 | Header **ids** resolve (and therefore intended name/value appear on an injected line) only after P6 pass. Pre-pass, a header numeric id is a no-op. P3 still unit-tests header-intent formatting. | A7, P3+P4+P6 |
| AC18 | Formatter and injected line never include a body segment, even if the index entry has an extra body field. Unknown key `redactBodiesInLogs` is not stored or compiled. This slice does not claim live bodies. | R6, P2+P3+P4 |

## How to verify

CI does not drive a live website match: the optional-host-permission prompt is not automated (`test/browser/extension-real.spec.ts`). AC1 is the listener call, not a Playwright `page.on("console")` on a granted origin.

| ID | Check |
| --- | --- |
| AC1 | P4 fake `ChromeApi`: one match → one `executeScript` (`world: "ISOLATED"`, `allFrames` unset, `tabId` from the event). |
| AC2 | P3: formatted string contains `[rogatio]`, not `[Rogatio]`. |
| AC3 | P3: prefix `\x1B[1;34m`, reset `\x1B[m`, detail `\x1B[2m`; no `%c`, no `#`. Theme mapping is Chrome's ANSI palette, not CI-asserted. |
| AC4 | P3 tables: (1) deny-list on — `[redacted]` for Q2 query keys on request URL, initiator, destination, and query-transform values; header values by name. (2) deny-list off — those values truncated, not replaced; userinfo/fragment still dropped. (3) flag false/absent — 201+ still ≤200 and ends with `...`. (4) tampered oversize/unredacted index input — format-time still bounds and deny-lists when sensitive is true. Resource type from the event appears when provided. No body key/segment; no wire header values. |
| AC5 | P4 after a match: storage keys are still `rogatio` / `rogatio.matchLogging.enabled` / `rogatio.matchLogging.index`; index JSON has no event URL. |
| AC6 | P4: header numeric ids are unknown until P6 pass. P6 records probe pass/fail; header index tests exist only on pass. Formatter fixture has no body segment. |
| AC7 | P7 grep: no "deferred" / `[Rogatio]` / `redactBodiesInLogs` in the listed docs; bodies/live-vs-intended stated; GitHub issue #163 mentioned once for body-rule logging. |
| AC8 | P4: enabled key `false` / `"true"` / `1` → zero injections; missing key → injects. P5: both UIs write that key; Playwright `getByRole("checkbox", { name: "Match logging" })`. |
| AC9 | P4: each fail-closed case → zero `executeScript`, no throw. |
| AC10 | P2: new module instance + string-key storage snapshot still resolves intent fields. |
| AC11 | P1: source manifest has the two new permissions; `optional_host_permissions` unchanged. P7: `pnpm validate`. Protocol file untouched. |
| AC12 | P2: failed `updateDynamicRules` keeps previous entries; empty success writes `{}`. |
| AC13 | P4: spy on `console.log`; call the exported `func` with the `args` `executeScript` will pass; calls are `["%s", line]` only. |
| AC14 | P0: omit the flag → valid and input keys unchanged (no AJV `default`). Compiler: omit → `redactSensitiveInLogs: false` on every kind; explicit `true` and `false` preserved; flag not copied onto `matcher`. Extra rule key and `redactBodiesInLogs` still fail. `browser-schema.ts` same allow/reject. |
| AC15 | P0 editor (`happy-dom`, not jsdom): one checkbox by accessible name on redirect and matcher cards; omitted/`false` unchecked; only boolean `true` checked; `change` writes boolean (`false`/`true`); `input` does not persist; type change keeps the flag; request-body and response-body cards have no redact checkbox. |
| AC16 | P3 snapshots: method, resource type, initiator, redirect destination, query set/remove ops. P4 separate redirect vs query matches pass those event+intent fields into format. Absent method/initiator/type add no placeholder. |
| AC17 | P3: header-intent snapshot exists regardless of P6. P4 pre-pass: header id `2_000_001` → zero injections. P6 pass: that id injects a line with intended header fields, redacted per flag. |
| AC18 | P2 does not store `redactBodiesInLogs`. P3: extra `body`/`requestBody` keys set to unique sentinels → those sentinels do not appear. P4: same extra field on a real index entry → injected line has no body segment and no sentinel. |

Each phase: failing tests first, then code, then that package's tests. P0 block A must typecheck before block B. Full `pnpm validate` at P7. Contracts skipped — no contract tests.

## Contracts note

`skipped` — no `docs/contracts.md` entry was requested or written for this feature.

## Implementation strategy

TDD. Schema, compiler, formatter, index, and fake-ported listener have deterministic seams — write the listed tests first; they must fail; then implement. P1 optional ports are proven by `tsc` plus a fake that omits them. P6 probe file *is* the header/Q4 test; do not write header-index code until it records pass. Not Code first: every phase has a failing test or typecheck before production code.
