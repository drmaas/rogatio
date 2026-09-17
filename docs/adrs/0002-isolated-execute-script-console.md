# 0002. Isolated executeScript console emission

## Context

Service-worker `console.log` lands in the worker DevTools, not the page console. A declared `content_scripts` entry would need broad `matches`, which Rogatio forbids. The page's `console` in the MAIN world can be replaced by site script.

## Decision

Emit each record with `chrome.scripting.executeScript` into `target: { tabId }` from the Chrome match event, `world: "ISOLATED"`, `allFrames` unset (top frame only). Add `"scripting"` to `permissions`. The injected `func` only calls `console.log` with `"%s"` for the whole formatted line so site-controlled text (URL, initiator, destination, header values, `ruleId`) is never the format string. SGR may live in extension-controlled arguments or inside the `%s` data. No `chrome.*` APIs, no eval, no MAIN world, no `tabs` permission, no caller-supplied tabId from messages.

Amended: the line now carries initiator, method, and intended action strings. They still travel as one `%s` argument.

## Consequences

- Injection needs host permission for the tab URL. Granted-origin subresource matches in an ungranted tab are a silent no-op.
- `tabId === -1` has no console. Iframe matches appear in the tab's top-frame console context.
- Untrusted URL / initiator / destination / `ruleId` text cannot act as a `console.log` format string.
- `"scripting"` plus existing host grants can inject into granted tabs. The match listener is the only caller.
