# 0009. Unified DNR reconciler and kind-scoped id bands

## Context

Redirect/query install uses in-memory `tracked` keys as the remove set. After restart that set is empty, so adds hit Chrome ids and fail. Header install already removes `getDynamicRules ∩` its ids and survives. Two authorities mean two notions of “installed.” Numeric bands already differ: redirect/query hash into 1–1_000_000; headers use `2_000_001 + index`. A unified remove that is not kind-scoped can wipe the other band. Body rules are not DNR.

## Decision

One extension reconciler owns remove, install, and installed reporting for redirect, query, and header. Chrome DNR stays in the extension adapter.

Keep existing bands. Do not redesign multi-project collision.

| Kind | Numeric ids |
| --- | --- |
| redirect, query | 1–1_000_000 (dynamic store) |
| header | 2_000_001 and up (`2_000_001 +` projection index, dynamic store) |
| request-body, response-body | never installed via the **dynamic** reconciler |

Remove set = live `getDynamicRules()` ∩ Rogatio-owned ids for the kinds in that replace. Never trust only in-memory `tracked`. If `getDynamicRules` throws, fail closed: do not treat the live set as empty and add. Drop Rogatio-owned orphans that are no longer desired. Leave ids outside owned bands untouched.

Amended (2026-09-20, #163 body-rule-match-logging): Body URL-match markers may install as **session** DNR rules for match logging, owned by a session-rules helper tied to native-session start/stop — not by `createDnrInstaller`. Rogatio body-marker band is locked at `3_000_001+` inside the **session** rule store (session and dynamic id spaces are separate in Chrome). Session helper removes only `getSessionRules() ∩` body band. Dynamic reconciler must not clear session body markers; session helper must not wipe dynamic redirect/query/header bands. Cross-band / cross-store wipe remains a testable invariant. Body rewrite status still comes from the native-runtime overlay; markers here are for URL-match signal (+ strip), not rewrite capability minting (#170) and not a second install authority for redirects/headers.

## Consequences

- Restart no longer empty-removes then duplicate-id fails.
- Headers and redirect/query share one “installed” authority in the dynamic store.
- Cross-band wipe is a testable invariant (dynamic bands + session body band).
- Body rewrite status stays on the native-runtime overlay; body match-logging markers are session-scoped and lifecycle-bound.
