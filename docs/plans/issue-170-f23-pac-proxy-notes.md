> Status: frozen 2026-09-24

# Issue #170 — F23 PAC/chrome.proxy live body rewrite: behavioral notes

Source: `gh issue view 170` (Complete F23 PAC/chrome.proxy path for live body-rule network rewrite). Related #169. Frozen F23 records: `docs/specs/f23-unified-native-host-runtime.md`, `docs/plans/f23-unified-native-host-runtime.md`. This change completes, not replaces, those decisions.

## Behavioral notes

- BN-1: Host starts a loopback forward proxy (127.0.0.1:0) owned by the runtime host process (spec REQ-5). The proxy endpoint is known only after listen, so PAC generation must happen after proxy start.
- BN-2: Extension installs the PAC script through `chrome.proxy.settings` (extension owns browser proxy state). Host cannot call Chrome APIs; PAC install/remove travel over native messaging as host-initiated envelopes (`runtime.pac.install`, `runtime.pac.remove`, requestId prefix `host-`).
- BN-3: PAC routes only body-rule origins (`pacOrigins` derived from compiled `response-body`/`request-body` matcher origins) to the host proxy; everything else DIRECT. `startNativeSession` must stop hardcoding `pacOrigins: []`.
- BN-4: Plain HTTP requests to matched origins: request-body rules rewrite bounded request bodies, response-body rules rewrite bounded response bodies (spec REQ-6 revalidate before body access, REQ-8 highest priority only, REQ-9/10 framing, REQ-11 no redirects/retries). Non-matching or unsupported traffic passes through untouched (REQ-7).
- BN-5: HTTPS (CONNECT) gets a blind TCP tunnel — no TLS MITM in this issue (`tls.ts` leaf stub stays a stub; scope guard in #170). HTTPS body rewrite remains future work.
- BN-6: Session start becomes real: extension `background.start(config)` sends `runtime.start` with `NativeRuntimeConfig` metadata and awaits the host response; host `runtime.start` calls `controller.start(sessionConfig)` and reports `interception: {active, reasons}`. `runtime.stop` maps to `controller.stop()` (today it falls into `runtime.request-malformed`).
- BN-7: Interception failure is visible: stable reasons (`no-interception-provider`, `device-local-ca-untrusted`, `controlling-proxy`, `controlling-pac`, `controlling-extension`, `enterprise-policy`, `provider-start-failed`, ...) surface through the start response; extension start fails instead of silently reporting started.
- BN-8: CA gate stays capability-based file verification (spec REQ-4): `provisionOrVerifyCa` verifies CA material created by `rogatio runtime install`; host never installs trust silently. Live test reaches the gate only after `spawnRuntimeInstall`.
- BN-9: Extension clears its PAC on stop and best-effort on native-port disconnect so host death cannot leave stale browser routing.
- BN-10: Collision check: if `chrome.proxy.settings` is controlled by admin/other extensions, PAC install fails with a stable error and start rolls back proxy + PAC (spec REQ-1/2).
- BN-11: `LIVE_E2E` body test assertions become hard failures (no `console.warn` skip branch) while keeping `LIVE_E2E=1 && SUDO_OK` gating and the `it.skip` fallback.
- BN-12: `samples/basic/README.md` §7b drops the "blocked by incomplete F23 PAC/proxy" caveat; `docs/architecture.md` F23 status updated to match shipped behavior.

## Acceptance checks

- AC-001: PAC/chrome.proxy configures Chrome to route body-rule origins through the native host loopback proxy (unit: PAC install bridge + pacOrigins derivation; live: rewrite observed).
- AC-002: Live response-body rewrite observable: navigation to `http://127.0.0.1:8080/data.json` returns rewritten body under `LIVE_E2E=1`.
- AC-003: Live request-body rewrite observable: POST to `http://127.0.0.1:8080/submit` arrives with `{"replaced":true}`.
- AC-004: `LIVE_E2E=1 pnpm test:browser -- test/browser/sample-basic-live.test.ts -t "body"` asserts rewrite (warn branch removed) when sudo/CA prerequisites hold.
- AC-005: `samples/basic/README.md` §7b caveat removed; `docs/architecture.md` F23 status synced.
- AC-006: Stop is idempotent and removes owned state only (PAC clear + proxy close); start failures roll back (no proxy left running, no PAC left installed).
- AC-007: Non-matching requests and CONNECT tunnels pass through untouched; no body bytes in native-messaging control envelopes (REQ-7/12).
- AC-008: Existing suites stay green via `pnpm validate`.

## Non-goals

- No TLS MITM / real X.509 leaf generation (out of scope per #170 guard).
- No redirect following, proxy recursion, retries, persistence in the proxy (REQ-11).
- No changes to DNR paths, editor, or schema; package boundaries unchanged (`docs/architecture.md`).
