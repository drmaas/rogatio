# Match history — specification

> Status: draft
> Issue: [#204](https://github.com/drmaas/rogatio/issues/204)

## Behavior

The service worker registers a consumer on the post-lookup append seam. A row is recorded only when console logging would run: unpacked `onRuleMatchedDebug`, Match logging on, a real tab id, a known index entry, and not the mock allow-guard. Coverage matches that pipeline: redirect, query, header, request-body, response-body, and mock. Matcher rules and unmatched requests are absent.

Each row stores id, time, rule id, name, kind, method, resource type, URL, initiator, and intended action. Redaction and field bounds match the console line. Live request and response bodies are not stored. Wire header values are not stored. Intended header and body actions come from rule config, already redacted.

The store is `chrome.storage.session` key `rogatio.matchHistory.entries`. The ring holds at most 100 rows. The oldest row drops. The service worker is the only writer. Writes are serialized. A toggle-off that lands during an append leaves the ring empty.

Turning Match logging off clears the ring. A worker that starts while the toggle is off clears it again. Clear on the Match history page sends `{ version: 1, command: "clear-match-history" }`. That message is not a project command.

The management page adds **Match history** between Dashboard and Workspace. The feed updates when the session key or the toggle changes. Newest row first. Empty states: logging off, and logging on with no rows. Clear is always available.

The row is not written to `.rogatio.json`, `storage.local`, `storage.sync`, project export, or the native host.

## Out of scope

Full network capture, `webRequest` or the debugger for unmatched traffic, history that survives the browser session, and a popup feed.
