# Match history — research

> Status: draft
> Issue: [#204](https://github.com/drmaas/rogatio/issues/204)
> Prerequisite: [#163](https://github.com/drmaas/rogatio/issues/163) (closed)

## Problem

Console match logging reports a Rogatio rule hit in the matched page's DevTools Console and then drops it. There is no management-page feed of recent matches. A general network log would conflict with the product rule of no retained traffic history.

## What shipped before this work

#163 closed the body-rule gap. `onRuleMatchedDebug` is the only match source. Redirect, query, and header rules log from dynamic DNR. Request-body and response-body rules log when session URL-match markers are installed and indexed. Mock redirects log. The mock allow-guard does not. Matcher rules have no DNR action and do not log.

`handleRuleMatchedDebug` checks the Match logging toggle, rejects `tabId === -1`, skips the allow-guard, looks up `rogatio.matchLogging.index`, notifies `registerMatchAppendConsumer`, then injects one console line. The seam was left for this feature. No consumer wrote a history store.

Redaction lives in `match-log-redaction.ts`: strip URL userinfo and fragment, truncate each field to 200 characters, and apply `redactSensitiveInLogs` to sensitive query values, sensitive header values, and intended body rewrite text. The console line does not include live body bytes or wire header values.

The management page destinations are Dashboard and Workspace. Match logging's toggle is in the popup and the Workspace Rules card. It writes `rogatio.matchLogging.enabled` in `chrome.storage.local` (default on).

Project export reads the repository envelope. `createStorageAdapter` reads and writes only the `rogatio` key.

## Decision

Daniel approved a session-scoped exception to "no retained traffic history."

Keep history matched-only and on the existing append seam. Store a ring of at most 100 redacted rows in `chrome.storage.session` under `rogatio.matchHistory.entries`. The service worker is the only writer. The Match logging toggle stays the master switch and clears the ring when turned off. The management page gains a Match history destination with a live feed and Clear.

Rejected: `storage.local` (survives restart), the project file, export, sync, the native host, a popup feed, unmatched traffic, and a second observation API.
