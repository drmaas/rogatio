# 0001. Authoritative match source

## Context

Rogatio must log a console record only when Chrome reports that a Rogatio-installed DNR rule matched. Inferring matches from network activity, badges, or native-runtime events would be a guess. `getMatchedRules()` is rate-limited and not a per-match signal.

## Decision

Use `chrome.declarativeNetRequest.onRuleMatchedDebug` as the only match source. Add `"declarativeNetRequestFeedback"` to extension `permissions`. Do not poll `getMatchedRules()`, do not subscribe to webRequest, do not use the debugger API, and do not log native-runtime body-rule activity. If the event is missing (packed load, no permission, no API), register nothing and stay silent.

Amended: live request/response bodies and wire-applied header values are not on this event. This feature does not invent another API to obtain them.

## Consequences

- Coverage is limited to DNR-installed rules and to unpacked loads, which is Rogatio's shipped install path.
- Manifest capability widens; `optional_host_permissions` stay unchanged.
- A terminated service worker that Chrome does not wake for this event drops matches. Document that limit. Do not add a keepalive.
- Body-kind rules stay silent this feature. Logging when a body rule matches (payload + redact option) is **tracked in GitHub issue #163**. Live bodies need a new research spike.
