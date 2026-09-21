# PRD: body-rule-match-logging

## Status

Approved (2026-09-20). Approach locked on GitHub issue #163 (single `onRuleMatchedDebug` pipeline; native-host match events rejected). Blocks #204. Q3/Q4 decided at PRD gate: body-rule cards get `redactSensitiveInLogs`; deliver console lines in this same RPI after research. Response-body match logging ships only after research proves the match event fires and marker headers do not leak upstream; research must also confirm request-body markers. Ready for research.

## Problem

Shipped console match logging covers `redirect`, `query`, and `header` only. When a `request-body` or `response-body` rule’s URL matcher hits a live request, DevTools shows nothing — even though the rule will at least attempt a body rewrite. Users debugging body rules cannot tell a match happened. Request match history (#204) is blocked until body kinds can share the same match feed.

## User

Chrome users who activate Rogatio projects with body rules and debug matches in the page DevTools Console (same audience as console match logging).

## Outcome

- **O1 — Body-match visibility:** When a body rule’s URL matcher matches a live request, users see one `[rogatio]` console line for that match in the page DevTools Console.
- **O2 — Honest meaning:** The line reports live match fields plus the **intended** body action from rule config. It means “matched + will attempt rewrite,” not proof the network rewrite succeeded. No live body bytes.
- **O3 — One pipeline:** Body-kind matches use the same Chrome match signal, toggle, fail-closed behavior, field style, and redaction path as existing DNR match lines — not a second native-host match source.
- **O4 — History-ready seam:** The same append path can feed #204’s matched-only history for DNR and body kinds (history UI stays out of this feature).
- **O5 — Decision recorded:** Docs/ADR record that body kinds use the DNR URL-match signal and that native-host match logging is rejected, so implement does not reopen that choice.

## Scope

- Emit one live-only `[rogatio]` console line when a `request-body` or `response-body` rule’s URL matcher matches, via the existing match-logging pipeline.
- Log live URL, method, initiator, and resource type from the Chrome match event.
- Log intended body action from rule config (mode + bounded rewrite summary). Reuse `redactSensitiveInLogs` and existing hard bounds. No live request/response body bytes.
- Request-body: reuse session DNR URL-match markers (architecture). Response-body: same URL-match pattern so Chrome fires the same event. Prefer matching the request-body marker pattern over a new mechanism.
- Prove (research/probe) that the response-body signal fires `onRuleMatchedDebug` and does not leak marker headers upstream before shipping that path.
- Record the single-pipeline decision in a short research/ADR note (amend ADR 0006 / related as needed).
- Leave a clear append seam for #204; do not build the history UI here.

## Non-goals

- Live body bytes in console lines or history rows.
- New observation permissions (`webRequest`, debugger) or Network-panel guessing.
- Native-host body observation or native-host “matched” events for logging or history.
- Fake DNR actions for actionless `matcher`-only rules.
- Shipping response-body match logging without the event-fire / no-upstream-leak design check.
- Implementing #204 request match history UI or persistence (only the shared append seam).
- Changing redirect/query/header match-logging behavior except as needed to share one body match signal.
- Firefox / non-Chrome browsers.

## Requirements

| ID | Requirement | Outcome trace |
| --- | --- | --- |
| R1 | When a `request-body` or `response-body` rule’s URL matcher matches a live request under an active project with match logging on, emit one `[rogatio]` console line on the matched page’s DevTools Console. | O1 |
| R2 | Body-kind lines use the same match signal, global Match logging toggle, fail-closed behavior, and field/style contract as shipped DNR match lines. Do not add a native-host match event for logging. | O3 |
| R3 | Each line includes live URL, method, initiator, and resource type from the Chrome match event, plus intended body action from rule config (mode + bounded rewrite summary). No live body bytes. | O2 |
| R4 | Apply `redactSensitiveInLogs` and existing hard bounds to sensitive fields on body-kind lines the same way as other logged kinds. | O2, O3 |
| R5 | Request-body match signal reuses session DNR markers keyed to the URL matcher so existing match logging can emit the line. | O1, O3 |
| R6 | Response-body match signal uses the same session-DNR URL-match pattern. Ship only after research proves the event fires and marker headers do not leak upstream. | O1, O3, O5 |
| R7 | Before or with implement, record in research/ADR: body kinds use the DNR URL-match signal; native-host match logging is rejected; contract is URL match ⇒ attempt-to-rewrite. | O5 |
| R8 | Match append path is usable as the single feed source for #204 (DNR + body kinds). This feature does not ship history UI. | O4 |

## Metrics

None sourced.

## Open questions

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| Q1 | Do request-body session DNR markers already exist in code, or does #170 still gate installability? | Research | Open — confirm against architecture + extension code. |
| Q2 | What exact response-body session DNR action keeps `onRuleMatchedDebug` firing without leaking marker headers upstream? | Research | Open — probe required before shipping R6. |
| Q3 | Should body-rule editor cards gain the `redactSensitiveInLogs` checkbox (console-match-logging excluded body kinds)? Issue requires reusing that flag for body lines. | Product | **Decided:** yes — same checkbox as other kinds. |
| Q4 | Ship spike/ADR-only first, or implement console lines in the same RPI after research? Issue acceptance is spike-level; body allows validation “before or as part of” implement. | Product | **Decided:** same RPI — research gates, then implement console lines. |

## Source

GitHub issue [#163](https://github.com/drmaas/rogatio/issues/163) — preferred approach and rejected alternatives locked on the issue (including decision comment). Blocks [#204](https://github.com/drmaas/rogatio/issues/204).
