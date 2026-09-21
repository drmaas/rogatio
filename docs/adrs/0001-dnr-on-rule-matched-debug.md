# 0001. Authoritative match source

## Context

Rogatio must log a console record only when Chrome reports that a Rogatio-installed DNR rule matched. Inferring matches from network activity, badges, or native-runtime events would be a guess. `getMatchedRules()` is rate-limited and not a per-match signal.

## Decision

Use `chrome.declarativeNetRequest.onRuleMatchedDebug` as the only match source. Add `"declarativeNetRequestFeedback"` to extension `permissions`. Do not poll `getMatchedRules()`, do not subscribe to webRequest, do not use the debugger API, and do not log native-runtime body-rule activity. If the event is missing (packed load, no permission, no API), register nothing and stay silent.

Amended: live request/response bodies and wire-applied header values are not on this event. This feature does not invent another API to obtain them.

Amended (2026-09-20, #163 body-rule-match-logging): Keep `onRuleMatchedDebug` as the only match source. Body kinds (`request-body`, `response-body`) become visible when the extension installs session DNR URL-match markers for their matchers; the console line means URL match ⇒ will attempt rewrite, not rewrite success. Do **not** add native-host “matched” events for logging or history. Do **not** log live body bytes. Logging markers must not mint rewrite capability / pending-auth (that stays #170). Drop the prior “body kinds stay silent” consequence for this path.

## Consequences

- Coverage is limited to DNR-installed rules (including body URL-match markers) and to unpacked loads, which is Rogatio's shipped install path.
- Manifest capability widens; `optional_host_permissions` stay unchanged.
- A terminated service worker that Chrome does not wake for this event drops matches. Document that limit. Do not add a keepalive.
- Native-runtime body activity is still never a match-logging source.
