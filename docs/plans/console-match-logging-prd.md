# PRD: console-match-logging

## Status

Locked after architecture-security + product answers (2026-09-16). **R4, R9, and Non-goals re-approved** with richer match records, one per-rule redact checkbox (default off), live resource type from the Chrome event, and **no live bodies** in this feature.

Q1–Q3 are decided in research. Live request/response bodies are **not** in this feature (see Non-goals and R6). Logging when a body rule matches (payload + redact option) is **tracked in GitHub issue #163**.

## Problem

When a Rogatio rule matches in Chrome, the user has no clear, filterable signal in the page DevTools Console. Architecture deferred the `[Rogatio]` console record so the event source and redaction contract would not be guessed. Users debugging redirects, query, headers, and other installed rules must infer matches from network behavior alone.

## User

Chrome users who import or activate a Rogatio project and debug live request/response rules in DevTools while browsing.

## Outcome

- **O1 — Match visibility:** Users can see and filter each authoritative Rogatio rule match that Chrome reports for the current session in the matched page’s DevTools Console.
- **O2 — Clear meaning:** Records are easy to spot and show intended match/action context without implying that the network operation succeeded.
- **O3 — Local, safe signal:** Records are bounded, redacted per the rule’s sensitive-fields flag plus hard bounds, and live-only, with no Rogatio-owned history or management-page feed.
- **O4 — Accurate guidance:** Shipped user and architecture docs describe the behavior, including what is live vs intended-from-config.
- **O5 — User control:** Users can turn match logging on or off in the extension, and per logged rule kind can redact sensitive fields in logs.

## Scope

- Emit a console record for each Chrome-authoritative Rogatio rule match identified by Q1.
- Prefix every record with lowercase `[rogatio]`.
- Give prefix and message distinct, readable styling that follows the system theme.
- Log **method**, **initiator**, and **resource type** (`request.type`) from the Chrome match event.
- Log **intended** redirect destination, query transform, and header name/value from the Rogatio rule config (not from the wire).
- Provide a global extension control **Match logging**, **default on**.
- Provide **one** per-rule editor checkbox, **Redact sensitive fields in logs**, on all rule kinds **except** body rules (`request-body`, `response-body`). Checked = redact; **unchecked by default** (absent/omitted → false / do not redact).
- When that flag is true, apply a known deny-list. Always keep hard bounds (truncate ≤200 with trailing `...` per logged string), even when the flag is false.
- Keep records live-only (no match history).
- Document the behavior, including that live bodies are not available from the match event and that body-rule matches are not logged in this feature.

## Non-goals

- No management-page match feed, badge-driven history, or persisted match log.
- No telemetry or retained traffic payloads.
- **No live request/response bodies.** `onRuleMatchedDebug` does not provide them. Do not add `webRequest`, the debugger API, or native-runtime observation to fill the gap.
- **No console lines for `request-body` / `response-body` / `matcher` rules** — Chrome has no DNR match signal for them. Desire to log when a body rule matches (payload + a redact option) is **tracked in GitHub issue #163**.
- **No body-redact checkbox** and no `redactBodiesInLogs` schema field.
- No change to rule matching, DNR projection semantics, or dry-run CLI output (beyond compiling the one new optional rule boolean).
- No Firefox / non-Chrome browsers in this feature.
- No redesign of popup or management UI beyond the **Match logging** control. Editor adds only the one redact checkbox on non-body rule cards (not a layout redesign).
- No explicit light, dark, or system selector for console-record styling.
- No guarantee that a logged match means the redirect/header/body mutation completed successfully.
- No logging of applied-from-the-wire header values (the event does not include them).

## Requirements

| ID | Requirement | Outcome trace |
| --- | --- | --- |
| R1 | When Chrome authoritatively reports a current Rogatio rule match, emit one Console record on the matched website’s DevTools Console. | O1 |
| R2 | Every record’s visible prefix is lowercase `[rogatio]`. | O1, O2 |
| R3 | Prefix and message have distinct styling that follows the system theme and remains readable in Chrome DevTools. Styling may draw on Adswerve dataLayer Inspector+ for clarity but does not copy its brand. | O2 |
| R4 | Record is bounded. When the rule’s sensitive-fields redact flag is **true**, apply the deny-list to URL/initiator/destination query values and to intended header/query-transform values. When the flag is absent or false, still truncate; never dump unbounded payloads. Describes **intended** match/action context plus live method/initiator/URL/**resource type** from the event. Does not dump live bodies or wire-applied headers (APIs do not provide them). | O2, O3 |
| R5 | Records are live-only: no Rogatio-owned history, storage, or management-page feed of matches. | O3 |
| R6 | Logging covers all rule kinds for which Chrome can authoritatively report a Rogatio match in the supported extension path (`redirect`, `query`, and `header` if the probe passes). Rule kinds without that signal (`matcher`, `request-body`, `response-body`) remain out of scope. Body-rule match logging is tracked in GitHub issue #163. | O1 |
| R7 | When the feature ships, user and architecture docs describe the shipped behavior and no longer call it deferred. Docs state live vs intended fields and that bodies are not logged. | O4 |
| R8 | The extension provides a user-facing **Match logging** control that turns match logging on or off. Default **on**. | O5 |
| R9 | Non-body rules have one optional boolean, edited as a checkbox: redact sensitive fields in logs. Checked = redact. **Unchecked by default** (absent/omitted → false / do not redact). Deny-list applies only when true. Truncate ≤200 with `...` always. No body-redact field. Body-rule cards do not show this checkbox. | O5 |

## Metrics

None sourced.

## Open questions

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| Q1 | Authoritative Chrome match signal and coverage. | Research | Decided: `onRuleMatchedDebug`. DNR `redirect`/`query` yes; `header` gated on probe; body kinds no. |
| Q2 | Redaction list and bounds. | Product | Decided: forbidden-header seed + extra names; query-key deny-list; userinfo/fragment drop; per-string ≤200 with trailing `...`; `[redacted]`. Deny-list only when `redactSensitiveInLogs` is true. |
| Q3 | Prefix/message styles. | Product | Decided: ANSI SGR, single flat line. |
| Q4 | Does the event wake a terminated MV3 worker? | Plan/P6 | Planning probe; not product. |
| Q5 | Toggle UI placement. | Product | Decided: popup and management sidebar; name **Match logging**; default on. |
| Q6 | Live request/response bodies in the console record? | Product | **Closed for this feature.** Event has no bodies. Live capture needs a new research spike (`webRequest` / debugger / native host) and would conflict with current non-goals. Logging when a body rule matches (payload + redact option) is tracked in GitHub issue #163. |

## Bodies — explicit

`chrome.declarativeNetRequest.onRuleMatchedDebug` `RequestDetails` has `url`, `initiator`, `method`, `type`, `tabId` (plus frame/document/request ids). It does **not** have request or response bodies, and it does **not** have header values applied on the wire.

This feature therefore:

- **Can** log live URL, method, initiator, and resource type (`request.type`) from the event.
- **Can** log intended redirect destination, query transform, and header ops from stored rule config.
- **Cannot** log live bodies.
- **Cannot** log intended body replacement/rewrite on a DNR match (those rules are not DNR). Body-kind matches have no Chrome-authoritative event. Follow-up: **tracked in GitHub issue #163**.

If product later wants live bodies, that is a new spike — not a silent API.

## Follow-up

Log when a body rule matches, including payload and a redact option — **tracked in GitHub issue #163**.
