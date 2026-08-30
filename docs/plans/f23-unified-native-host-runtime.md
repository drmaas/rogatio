# F23 — Unified Native-Host Runtime Implementation Plan

**Specification:** `docs/specs/f23-unified-native-host-runtime.md`
**Branch:** `feature/native-host-start-stop`

1. Inventory lifecycle, mock-connect, response-body, request-body, native-host, PAC, and related tests.
2. Make the existing native host the sole runtime owner; add unified lifecycle, transactional start rollback, idempotent stop, and operation cancellation.
3. Make extension Start establish native messaging and policy automatically; remove operational CLI connect dependency.
4. Keep proxy/TLS internal to the host and bind scoped PAC install/restore to the same lifecycle.
5. Connect bounded request-body validation/transformation and highest-priority selection to the unified host; preserve untouched pass-through.
6. Route mock and response-body behavior through the same session without a separate connection state.
7. Remove Check and connect command/UI/state from extension protocol, service worker, and management page.
8. Retain CLI only for installer/admin trust and diagnostics; remove user-facing proxy-server operation.
9. Synchronize architecture, README/docs runtime guidance, specification, plan, and workflow records.
10. Run focused tests, typecheck, build, browser tests, canonical validation, and fresh-context review.

Test mapping: runtime lifecycle and host tests prove Start/Stop/rollback; extension tests prove no Check/connect and automatic mock session; request-body integration proves revalidation, priority, pass-through, transformed forwarding, and cleanup; CLI tests prove admin-only behavior; browser E2E proves the unified lifecycle where platform prerequisites exist.
