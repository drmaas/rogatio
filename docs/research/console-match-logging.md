# Research: console-match-logging

Phase: research. Inputs: `docs/decisions/console-match-logging/prd.md`. Graphify: present (`graphify-out/graph.json`); not used. Contracts: skipped.

## Problem restatement

Rogatio installs Chrome DNR rules but emits nothing to the matched page's DevTools Console, so a user debugging a redirect, query, or header rule can only infer a match from network behavior (`docs/architecture.md:90`). F7 deliberately deferred the `[Rogatio]` record so its Chrome event source and redaction contract would not be guessed (`docs/specs/f7-extension-shell.md:154`, `docs/workflows/f7-workflow.md:43`). This feature must name the authoritative Chrome signal, emit one bounded, redacted, live-only lowercase `[rogatio]` record per reported match into the matched page's console, and give the user an on/off control.

## Codebase findings

### What is actually installed into DNR

Two independent installers write dynamic rules, with two different numeric-id schemes.

- `createDnrInstaller` handles only `redirect` and `query` operations (`packages/extension/src/dnr.ts:131-146`). Numeric ids come from `ruleIdHash(ruleId)`, a 31-multiplier string hash folded into `1..1_000_000` (`packages/extension/src/dnr.ts:95-101`), with linear probing on collision (`packages/extension/src/dnr.ts:135`, `:142`). The reverse map lives only in a closure-local `Map<number, RogatioOperation>` (`packages/extension/src/dnr.ts:104`, `:161`).
- Header rules go through `projectHeaders` → `installHeaderRules`. Ids are positional, `2_000_001 + index` (`packages/extension/src/projection.ts:263`), carried straight into the DNR rule (`packages/extension/src/installer.ts:107`) and installed with `action.type: "modifyHeaders"` (`packages/extension/src/installer.ts:110-117`).
- `projectMatchers` also mints `1_000_001 + index` ids (`packages/extension/src/projection.ts:173`, `:217`, `:242`), but that projection is inspection-only and is not what `createDnrInstaller` installs. Do not use it as the id source for logging.

Edge cases that matter for a numeric-id → Rogatio-rule lookup:

- The `tracked` map is in-memory service-worker state. An MV3 service worker restart loses it, and `createDnrInstaller.current()` then returns `[]` even though the rules are still installed (`packages/extension/src/dnr.ts:107-121`).
- `ruleIdHash` is not injective and probing mutates the id, so the id cannot be recomputed from `ruleId` alone after a collision (`packages/extension/src/dnr.ts:135`).
- Header ids are positional over the compiled header operation list, so they shift if the project's rules are reordered (`packages/extension/src/projection.ts:257-263`). They are never stored in `tracked`; that map only covers redirect/query (`packages/extension/src/dnr.ts:104`, `:131-146`, `:160-161`).
- `createDnrInstaller.install` removes only its own tracked ids (`packages/extension/src/dnr.ts:127`), so header ids and redirect/query ids never collide in practice.

Rule kinds that never reach DNR: `matcher` is reported `unsupported` and never installed (`packages/extension/src/service-worker.ts:147-157`); `request-body` and `response-body` are served by the native runtime and report `needs runtime` until the phase is `started` (`packages/extension/src/service-worker.ts:158-185`, `docs/architecture.md:300`).

### Chrome API surface currently wired

- Manifest permissions are `["storage", "declarativeNetRequest", "nativeMessaging"]` with `optional_host_permissions: ["http://*/*", "https://*/*"]` (`packages/extension/public/manifest.json:14-15`). No `declarativeNetRequestFeedback`, no `scripting`, no `tabs`, no `content_scripts`.
- The typed Chrome adapter exposes only `getDynamicRules` / `updateDynamicRules` (`packages/extension/src/chrome.ts:47-53`) inside a narrow `ChromeApi` (`packages/extension/src/chrome.ts:55-61`). Any new API needs a typed port added here; tests inject a fake adapter (`packages/extension/test/chrome.test.ts`).
- Host permissions are requested per declared origin via `originMatchPattern` (`packages/extension/src/chrome.ts:117-120`, `:129-132`) and never as broad request patterns (`docs/architecture.md:86`).
- Installed redirect/query rules constrain `initiatorDomains` only (`packages/extension/src/dnr.ts:64-69`, `:87-92`), derived from the granted origins. So a matched request's initiator is normally a granted origin.

### Message protocol and toggle surfaces

- Commands are a closed union plus a `Set` guard; a new command must be added in both places (`packages/extension/src/protocol.ts:7-25`, `:41-60`).
- Popup action row is the smallest place for a toggle (`packages/extension/src/popup.ts:228-254`); the popup already renders checkbox toggles for groups (`packages/extension/src/popup.ts:295-308`).
- Management page sidebar renders the Start/Stop runtime controls and status cards and is the other candidate (`packages/extension/src/extension-page-entry.ts:397-435`); tabs are only `dashboard` and `workspace` (`packages/extension/src/extension-page-entry.ts:361`).
- Persisting the toggle inside the existing `rogatio` envelope will not survive: `migrateEnvelope` rebuilds the envelope from `version`, `projects`, `activeProjectId` only, dropping any other key on the next write (`packages/browser-core/src/migrate.ts:204-211`, `packages/browser-core/src/types.ts:18-21`). Use a separate `chrome.storage.local` key (the adapter reads only `result.rogatio`, `packages/extension/src/chrome.ts:87-97`).

### Existing `[rogatio]` logging

Lowercase `[rogatio]` is already the de-facto prefix, but all of it is service-worker debug noise, not a user-facing record (`packages/extension/src/background.ts`, `packages/extension/src/service-worker.ts`, `packages/extension/src/native-session.ts`). These land in the service worker's own DevTools, never in the page console. The new user-facing record shares that prefix, so either the debug logs get a different marker or they get removed.

### Redaction material already in the repo

- `FORBIDDEN_REQUEST_HEADERS` / `FORBIDDEN_RESPONSE_HEADERS` and the `proxy-` / `sec-` prefix rule are frozen and shared (`packages/schema/src/headers.ts:4-45`), mirrored browser-side (`packages/extension/src/browser-schema.ts:17-70`).
- Native envelopes forbid body keys (`packages/runtime/src/envelope.ts:9`, `:47-59`). The request-body path rejects or strips a forbidden-header set (`packages/runtime/src/wire.ts:11-26`, `:100-103`, `:137-139`). That is a different boundary than the page console; `packages/runtime/test/policy.test.ts:97` is a placeholder `expect(true)` and is not evidence. The console record still must never emit bodies, credentials, or sensitive headers (R4).

### Docs that claim the behavior today

`rogatio-overview.md:38`, `packages/docs-site/src/content/docs/guides/extension.md:33-38`, and `packages/docs-site/src/content/docs/reference/extension.md:26` already describe the `[Rogatio]` record in the present tense with a capital R, while `docs/architecture.md:90` and `:735` say it is deferred. R2 fixes the case to lowercase and R7 removes the "deferred" language.

## External findings

### Q1 — the authoritative Chrome signal

**`chrome.declarativeNetRequest.onRuleMatchedDebug`** is the only Chrome event that reports "a rule of yours matched this request". It fires with `MatchedRuleInfoDebug` = `{ rule: { ruleId, rulesetId }, request: RequestDetails }` ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#event-onRuleMatchedDebug)). `RequestDetails` carries `url`, `initiator`, `method`, `type`, `tabId`, `frameId`, `documentId`, `requestId` ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/onRuleMatchedDebug)).

Hard constraints on it:

- Requires the `"declarativeNetRequestFeedback"` permission **and an unpacked extension**: "Enables debugging features for unpacked extensions, specifically `getMatchedRules()` and `onRuleMatchedDebug`" ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#permissions)). The event may be absent; fail closed.
- This is survivable for Rogatio specifically: the shipped artifact is a ZIP that users load unpacked (`docs/architecture.md:1227-1229`, `README.md:89-91`, `packages/docs-site/src/content/docs/getting-started/installation.md:44-45`, `samples/basic/README.md:50-58`). The feature must still degrade to a no-op, not a crash, when the event is absent.

The fallback, `chrome.declarativeNetRequest.getMatchedRules()`, needs the same feedback permission (or `activeTab` for a specific `tabId`), is capped at 20 calls per 10 minutes, and drops matches older than five minutes for non-active documents ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-getMatchedRules)). Polling is therefore not a per-match signal and is a poor fit for R1.

**Coverage by Rogatio rule kind** (answers PRD Q1):

| Rogatio kind | Installed as | Chrome can authoritatively report? |
| --- | --- | --- |
| `redirect` | DNR `redirect` (`dnr.ts:53-70`) | Yes — matched before the request, the classic `onRuleMatchedDebug` case. |
| `query` | DNR `redirect` with `redirect.transform.query` (`dnr.ts:72-93`) | Yes — same path; it is a redirect action to Chrome. |
| `header` | DNR `modifyHeaders` (`installer.ts:94-129`) | Unknown until probed. `modifyHeaders` is evaluated in a later stage than redirect ([Chrome docs, Rule evaluation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation)). Chrome docs do not say whether `onRuleMatchedDebug` fires for them. **Verify empirically before promising header coverage.** |
| `matcher` | Never installed (`service-worker.ts:147-157`) | No — nothing to match. Out of scope. |
| `request-body`, `response-body` | Native runtime, not DNR (`docs/architecture.md:300`) | **No.** Chrome has no DNR rule for them, so no Chrome-authoritative match signal exists. Out of scope per R6. |

A second honesty constraint behind O2: a `modifyHeaders` match reported by Chrome does not prove the header change is observable. Chrome DevTools has a long-standing bug showing original response headers even when DNR modified them ([crbug.com/1247400](https://crbug.com/1247400), [Stack Overflow](https://stackoverflow.com/questions/72252048/response-headers-update-with-declarativenetrequest-update-rules-not-visible-in-c)). The record wording must stay at "matched / intended action".

### Writing into the page's DevTools Console

The service worker's `console.log` goes to the service worker's own DevTools, not the page's ([Chrome debugging guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)). Content-script logs do appear in the inspected web page's console — the same guide debugs a content-script error by inspecting the page. So the record must be emitted from a script running in the tab.

Options:

1. `chrome.scripting.executeScript({ target: { tabId }, func, args })` from the service worker. Needs the `"scripting"` permission plus host permission for the target page ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/scripting)). `args` must be JSON-serializable and the `func` is serialized, losing its closure — pass the formatted strings in explicitly.
2. A declared `content_scripts` entry. Rejected: it needs broad `matches` at install time, which contradicts the "never broad host patterns" invariant (`docs/architecture.md:86`).
3. `chrome.scripting.registerContentScripts` — still needs `"scripting"`, adds lifecycle state, and buys nothing over (1) for a per-match event.

Option 1 aligns with the existing permission model: `optional_host_permissions` is already `http://*/*` + `https://*/*` (`packages/extension/public/manifest.json:15`) and grants are narrowed per declared origin, which is the same set where rules can match.

`world: "MAIN"` vs `"ISOLATED"` (default) ([ExecutionWorld](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld)): `ISOLATED` cannot be tampered with by page scripts and is the safer default; its logs still surface in the page console, attributed to the extension in the console's context dropdown. `MAIN` attributes cleanly to the page but runs in the page's JS world, where a site can have replaced `console` — a real failure mode Adswerve documents hitting ([Adswerve](https://adswerve.com/blog/datalayer-inspector-new-features)). Recommend `ISOLATED`.

Known gaps: `tabId` is `-1` when the request is not tied to a tab ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/onRuleMatchedDebug)) — no console to write to. Injection also fails when the tab's own URL is outside the granted origins even though a subresource on a granted origin matched.

### Styling (Q3 evidence)

Chrome DevTools supports two styling mechanisms ([Format and style messages](https://developer.chrome.com/docs/devtools/console/format-style)):

- `%c` + a CSS string. Fully expressive, but any hex color is fixed and does **not** follow the DevTools/system theme. `url()` is restricted to `data:` URLs.
- ANSI SGR escape sequences. The same doc publishes a per-code palette with **separate Light theme and Dark theme hex values** (e.g. code `34` → `#0000AA` light / `#2774f0` dark), plus `1` bold, `2` lighter, `3` italic, `4` underline. This is the only documented mechanism where DevTools itself resolves the color per theme, which is exactly what R3 asks for.

Adswerve, as inspiration only: a fixed filterable prefix and distinct level colors ([Adswerve 2024 guide](https://adswerve.com/technical-insights/adswerve-datalayer-inspector-plus)). Rogatio's lowercase `[rogatio]` already serves the filter-token role. Do not copy brand colors.

## Constraints and invariants

- Package boundary: all Chrome API work stays in `packages/extension`; `compiler`, `schema`, `browser-core` stay browser-neutral (`docs/architecture.md:80-84`). Any new Chrome surface goes through the typed `ChromeApi` port (`packages/extension/src/chrome.ts:55-61`).
- No broad host patterns and no undeclared origins in permission requests (`docs/architecture.md:86`, `packages/extension/src/chrome.ts:117-120`, `:129-132`).
- Live-only (R5): no persistence of matches. The only thing persisted is the on/off flag, and it must live outside the `rogatio` envelope (`packages/browser-core/src/migrate.ts:204-211`).
- Fail closed and stay silent: a missing `onRuleMatchedDebug`, a missing `scripting` permission, a `tabId` of `-1`, or a failed injection must be a no-op, matching the extension's existing fail-closed posture (`docs/architecture.md:86`).
- Public diagnostics and serialized output stay stable and independent of third-party wording (repository rule; `packages/extension/src/diagnostics.ts:32-66`).
- Never emit bodies, credentials, or sensitive headers (R4). Reuse the schema forbidden-header lists as the seed (`packages/schema/src/headers.ts:4-45`); do not treat the native-envelope checks as a console redaction implementation.
- `scripts/validate.ts` only requires `permissions` to include `"storage"` and an exact `optional_host_permissions` list (`scripts/validate.ts:97-99`); adding `"declarativeNetRequestFeedback"` or `"scripting"` does not fail that check as written. MV3 artifact hygiene is still asserted (`docs/architecture.md:1229-1230`). Extension unit tests live in `packages/extension/test/`; real-Chromium journeys in `test/browser/` (`test/browser/extension.spec.ts`, `test/browser/header-dnr-probe.spec.ts`).
- Plan must extend `ChromeApi`: today `ChromeDeclarativeNetRequest` is only `getDynamicRules` / `updateDynamicRules` (`packages/extension/src/chrome.ts:47-61`). Add typed ports for `onRuleMatchedDebug` and `scripting.executeScript`. Header install uses `globalThis.chrome` directly, not that port (`packages/extension/src/installer.ts:138-150`). Tests inject fakes (`packages/extension/test/chrome.test.ts`, `packages/extension/test/dnr.test.ts`).
- Compiler operations expose `ruleId` and `kind`, not a display name (`packages/compiler/src/types.ts:29-56`).
- Popup talks to the service worker only through `chrome.runtime.sendMessage` and the closed protocol (`packages/extension/src/popup.ts:22-34`); a popup toggle needs a new command, or it can read/write the separate `chrome.storage.local` key itself.

## Open questions

### Q1 — answered, with one item to verify

Event: `chrome.declarativeNetRequest.onRuleMatchedDebug`, gated on `"declarativeNetRequestFeedback"` + unpacked load. Covers `redirect` and `query` fully; excludes `matcher` (never installed) and `request-body` / `response-body` (native runtime, no DNR rule). **Open:** whether `modifyHeaders` (Rogatio `header`) matches fire the event in the currently supported Chrome — docs are silent. Resolve with a real-Chromium probe alongside `test/browser/header-dnr-probe.spec.ts` before committing header coverage in R6.

Also open for planning, not for product: the numeric-id → Rogatio `ruleId` lookup must cover both installers and survive a service-worker restart. `createDnrInstaller`'s `tracked` map is in-memory, redirect/query only, and is lost on restart (`packages/extension/src/dnr.ts:104`). Header ids are positional and never enter that map.

### Q2 — redaction list and bounds — **decided**

Product accepted the proposal:

- Reuse the frozen forbidden-header lists as the header-name redaction seed (`packages/schema/src/headers.ts:4-45`), plus `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token`.
- Redact these URL query-parameter **values** (case-insensitive, substring match on the key): `token`, `access_token`, `id_token`, `refresh_token`, `code`, `api_key`, `apikey`, `key`, `secret`, `client_secret`, `password`, `passwd`, `pwd`, `auth`, `session`, `sid`, `sig`, `signature`, `jwt`, `assertion`, `otp`, `state`, `nonce`, `email`.
- Always drop URL userinfo (`user:pass@host`) and the URL fragment.
- Bounds: one record per reported match; URL truncated to ~200 characters with an explicit ellipsis; each redacted value replaced by a fixed literal (e.g. `[redacted]`) rather than a length-revealing mask; no header values, no bodies, no request/response payloads at all.

### Q3 — style tokens — **decided**

Product accepted ANSI SGR (not `%c`) and a **single flat line** (no `console.groupCollapsed`):

- Prefix `[rogatio]`: `\x1B[1;34m` — bold + blue (`#0000AA` light, `#2774f0` dark), reset with `\x1B[m`.
- Primary message: unstyled, so it inherits the console's own theme foreground.
- Secondary detail (`ruleId`, action kind): `\x1B[2m` (lighter weight), no explicit color.
- Attention variant only if the plan needs one: `\x1B[1;33m`.

### Q4 — planning (not product)

Does `onRuleMatchedDebug` wake a terminated MV3 service worker? If it does not, matches occurring after the worker idles out would be silently dropped, which would weaken R1. Needs a real-Chromium check; no documentation found either way.

### Q5 — toggle UI — **decided**

On/off control lives in **both** the popup action row (`packages/extension/src/popup.ts:228-254`) and the management-page sidebar (`packages/extension/src/extension-page-entry.ts:397-435`).

### Header coverage — **decided**

Ship console logging for `redirect` and `query` first. Add `header` only after a real-Chromium probe confirms `onRuleMatchedDebug` fires for `modifyHeaders`.

## Amendment (plan-review revise, 2026-09-16)

Product asked for richer records (header names/values, redirect destinations, query transforms, method, initiator, bodies) plus two per-rule redact checkboxes. That overturns research's "never emit header values or bodies" and the plan's A9 "schema untouched".

Honesty that still holds:

- `RequestDetails` has url, initiator, method, type, tabId — **not** live bodies, **not** wire header values.
- Intended redirect / query / header ops can be formatted from rule config if the durable index stores a log-intent subset. Full `RogatioOperation` is still too much (regex, origins); do not store it.
- Live bodies need webRequest / debugger / native-runtime observation. Out of scope. Intended body rewrite is also out until body kinds have a match signal.
- Query-key deny-list and 200/`...` truncation still apply; deny-list is gated on `redactSensitiveInLogs` (then: default true). Toggle default is **on**; checkbox name **Match logging**.

## Amendment (architecture-security + product lock, 2026-09-16)

Product re-approved R4/R9/non-goals with these locks:

- Richer logs stay; **no live bodies** in this feature.
- **One** per-rule checkbox: **Redact sensitive fields in logs**. Present on all rule kinds **except** `request-body` / `response-body`. Checked = redact; **unchecked by default** (absent/omitted → `false`). Deny-list only when true. Always truncate ≤200 + `...`.
- **No** `redactBodiesInLogs`. No body-redact checkbox.
- Body-rule match logging (payload + redact option) is **tracked in GitHub issue #163**.
- Also log **resource type** from the Chrome event (`request.type`).
- Toggle default remains **on**; name **Match logging**.
