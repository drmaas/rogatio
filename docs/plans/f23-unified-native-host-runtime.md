# F23 — Unified Native-Host Runtime Implementation Plan

**Specification:** `docs/specs/f23-unified-native-host-runtime.md`
**Branch:** `feature/native-host-start-stop`
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/native-host-start-stop`
**Status:** Planned; implementation not started.

## Architecture note

- `@rogatio/runtime` remains the owner of the single native host, internal loopback proxy, TLS interception, policy validation, transformations, mock/response behavior, and upstream forwarding.
- `@rogatio/extension` owns only lifecycle commands, native messaging, project/policy preparation, scoped PAC/proxy ownership, and status presentation; bodies never enter extension messages.
- `@rogatio/cli` retains installer/admin and diagnostic entry points, but is not required to connect or operate an active browser session.
- Start is a transactional coordinator across native host, policy, proxy/TLS provider, and PAC state. Stop reverses only Rogatio-owned state and aborts active work.
- Existing F6/F13/F15/F17 primitives should be reused where behavior is already correct; the separate mock “check/connect” path is removed rather than duplicated.

## Ordered tasks

1. **Inventory and compatibility seam** — Map current lifecycle, mock connection, response-body, request-body, native-host, and PAC state paths. Identify tests asserting the old check/connect behavior. Keep this task read-only except for the durable workflow record.
2. **Runtime host coordinator** — Extend the existing native host/controller so one session owns mock, response-body, request-body, proxy, and TLS state. Add transactional startup, rollback, idempotent stop, active-operation cancellation, and unified states. Cover lifecycle races and no partial startup.
3. **Native messaging session** — Make extension Start establish the host session and send the active immutable policy automatically. Remove any operational dependency on CLI `runtime start`/`connect`. Keep admin install/trust commands available.
4. **Internal proxy/TLS routing** — Ensure proxy and TLS interception are host-owned internals, scoped by exact authorized origins, with PAC install/restore tied to the same session coordinator. Preserve one-time trust setup and refuse collisions.
5. **Request-body path** — Connect existing request-body validation/transformation to the unified host flow. Enforce revalidation before body access, highest-priority winner selection, fresh upstream connection, and untouched pass-through for non-matches/unsupported requests.
6. **Mock/response integration** — Route existing mock and response-body behavior through the same started session without adding a second connect state or changing their established semantics.
7. **Extension UX/state** — Remove Check and connect UI, mock connection status, and separate connect commands. Present one runtime state and Start/Stop controls. Update extension protocol/service-worker state and tests.
8. **CLI/admin boundary** — Clarify help and command behavior so CLI commands are installation/trust/admin diagnostics only. Ensure no CLI proxy server or user-facing connect operation remains.
9. **Documentation/workflow synchronization** — Update architecture, README/docs-site runtime guidance, affected specs/plans, and workflow evidence to describe one native host and Start/Stop operation.
10. **Verification and review** — Run focused runtime/extension tests, typecheck, build, browser tests, and canonical `pnpm validate`; perform an independent fresh-context review and fix findings within three rounds.

## Test-first mapping

- Runtime lifecycle tests: unified start, stop, rollback, idempotency, races, active-operation cancellation.
- Native-host tests: one host owns all runtime capabilities; bodies stay out of native messaging.
- Extension service-worker tests: Start automatically establishes the session; Stop tears it down; no Check/connect command is needed.
- Extension DOM tests: only Start/Stop controls and unified status appear.
- Request-body integration tests: highest-priority winner, untouched pass-through, TLS/upstream forwarding, transformed-body headers, and failure cleanup.
- Mock/response regression tests: existing behavior works after Start and does not require a second connection action.
- CLI tests: admin/install/trust commands remain, but no operational proxy/connect flow is exposed.
- Browser E2E: Start → use mock/response/request-body behavior → Stop, with capability-gated live tests where supported.
