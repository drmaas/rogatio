# 0009. Unified DNR reconciler and kind-scoped id bands

## Context

Redirect/query install uses in-memory `tracked` keys as the remove set. After restart that set is empty, so adds hit Chrome ids and fail. Header install already removes `getDynamicRules ∩` its ids and survives. Two authorities mean two notions of “installed.” Numeric bands already differ: redirect/query hash into 1–1_000_000; headers use `2_000_001 + index`. A unified remove that is not kind-scoped can wipe the other band. Body rules are not DNR.

## Decision

One extension reconciler owns remove, install, and installed reporting for redirect, query, and header. Chrome DNR stays in the extension adapter.

Keep existing bands. Do not redesign multi-project collision.

| Kind | Numeric ids |
| --- | --- |
| redirect, query | 1–1_000_000 |
| header | 2_000_001 and up (`2_000_001 +` projection index) |
| request-body, response-body | never installed via DNR |

Remove set = live `getDynamicRules()` ∩ Rogatio-owned ids for the kinds in that replace. Never trust only in-memory `tracked`. If `getDynamicRules` throws, fail closed: do not treat the live set as empty and add. Drop Rogatio-owned orphans that are no longer desired. Leave ids outside owned bands untouched.

## Consequences

- Restart no longer empty-removes then duplicate-id fails.
- Headers and redirect/query share one “installed” authority.
- Cross-band wipe is a testable invariant.
- Body status stays on the native-runtime overlay.
