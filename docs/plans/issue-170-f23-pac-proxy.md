> Status: frozen 2026-09-24

# Issue #170 — plan: F23 PAC/chrome.proxy live body rewrite

Lightweight doit plan. Behavioral notes and acceptance checks: `notes.md` (same tree). F23 spec/plan remain the governing frozen records; this plan does not amend REQ-1..REQ-14.

## Architecture note (non-obvious decisions)

- **Proxy ownership split.** The host process owns the loopback forward-proxy listener (spec REQ-5); the extension owns browser proxy state (`chrome.proxy.settings` + manifest `proxy` permission). They meet over native messaging: host-initiated envelopes `runtime.pac.install` / `runtime.pac.remove` with requestId prefix `host-`. `host.ts` keeps a pending map and `processFrame` resolves those responses before touching `controller.handleEnvelope` (returns `null`, no reply). Extension `port.onMessage` first checks its own pending numeric ids, else treats the envelope as a host request and replies with the same `requestId`.
- **Order: proxy first, PAC second.** `PlatformInterceptionAdapter.startTlsProxy` now starts the loopback proxy and returns its bound `{host, port}`; the provider then generates the PAC with the real endpoint and installs it (previously PAC-then-proxy with placeholder `{host:"127.0.0.1",port:0}`). Failure after PAC install rolls back PAC; failure before install never touches PAC. `activation.proxy` carries the endpoint back to the lifecycle.
- **Provider interface change.** `InterceptionProvider.start(activation)` gains the session `pacOrigins` (or the full `SessionConfig`) because PAC generation needs them; `startInterception` outcome gains the proxy endpoint so `controller.start` can set `activation.proxy`. The local `getCurrentSession()` stub at the bottom of `lifecycle.ts` (always `null`, shadows the real import) is removed.
- **Policy retention.** `runtime.project.set` retains `{project, operations}` (compiled, validated) on the controller as the immutable active policy for the proxy and `revalidateAuthority`; today they are discarded after preset construction.
- **Session envelopes.** `runtime.start` (metadata = `NativeRuntimeConfig`) is handled by the host: `controller.start(sessionConfig)` → interception → `{ok, pacScript?, interception:{active, reasons}}`. `runtime.stop` maps to `controller.stop()`. `runtime.project.set` while running returns stable `runtime.already-started` (already tolerated by `startNativeSession`). `background.start` awaits the response instead of fire-and-forget and returns `unsupported`/`failed` with stable reason codes when `interception.active` is false.
- **Proxy data path.** New `packages/runtime/src/intercept-proxy.ts`: Node `http` server on 127.0.0.1:0. Absolute-URI `http` requests → match first compiled `request-body`/`response-body` op (urlRegex on full URL, origin, method; revalidate before body access) → bounded rewrite via existing `rewriteRequestBody`/`rewriteResponseBody` on a fresh upstream connection, else raw pipe-through. `CONNECT` → blind TCP tunnel (no MITM; `tls.ts` stub untouched). No redirect following, no recursion, HTTP/1.1 only (REQ-9/10/11).
- **CA gate unchanged.** `provisionOrVerifyCa` verifies CA material files from `rogatio runtime install` via the existing trust controller (`caTrusted`); never installs silently (REQ-4). Unsupported profiles produce sorted stable reasons through `unsupportedReasons`.
- **Rejected:** TLS MITM via `tls.ts` (stub X.509, out of #170 scope); host calling Chrome APIs directly (impossible across native messaging); keeping placeholder PAC endpoint `{127.0.0.1,0}` (points PAC at nothing); rewriting HTTPS bodies (needs real MITM CA).

## Plan (ordered)

1. **Tests: interception provider order/endpoint** — update `packages/runtime/test/interception.test.ts`: `startTlsProxy` returns endpoint, PAC generated with that endpoint and installed after proxy start, rollback removes PAC, stop order. (AC-001, AC-006; red first.)
2. **Tests: intercept proxy data path** — new `packages/runtime/test/intercept-proxy.test.ts`: response-body rewrite, request-body rewrite, non-match pass-through, CONNECT blind tunnel, bounded/oversize fallback, revalidate-before-body. (AC-002/003 unit side, AC-007.)
3. **Tests: lifecycle/host envelopes** — extend `packages/runtime/test/lifecycle.test.ts`: `runtime.start` with sessionConfig (interception result + `activation.proxy`), `runtime.stop`, `runtime.project.set` already-started while running, policy retention. New host-bridge test: `host-` pending resolution in `processFrame` (PAC install round trip). (AC-001, AC-006.)
4. **Tests: extension** — manifest `proxy` permission (`packages/extension/test/manifest.test.ts`); chrome proxy adapter set/clear/collision; `background.start` awaits response and surfaces interception reasons; `startNativeSession` computes `pacOrigins` from compiled body ops. (AC-001, AC-007.)
5. **Tests: live ungate** — `test/browser/sample-basic-live.test.ts`: replace the `console.warn` skip branch with hard assertions on response/request rewrite. (AC-002/003/004; red until wired.)
6. **Implement: runtime** — `intercept-proxy.ts`; `interception.ts` interface + order changes; `lifecycle.ts` (drop stub, retain policy, add `runtime.start`/`runtime.stop` cases, set `activation.proxy`); `host.ts` pending bridge + provider registration (real adapter: detect/CA verify/PAC via bridge/loopback proxy). (Steps 1–3 green.)
7. **Implement: extension** — `chrome.ts` proxy typing + adapter; manifest permission; background PAC request routing + awaited `runtime.start`; `native-session.ts` pacOrigins. (Step 4 green.)
8. **Verification** — `pnpm validate`; then `LIVE_E2E=1 pnpm test:browser -- test/browser/sample-basic-live.test.ts -t "body"` with sudo/CA prerequisites; record exact commands/exit codes in `workflow.md`. (AC-008, AC-004.)
9. **Docs** — `samples/basic/README.md` §7b caveat; `docs/architecture.md` F23 status; freeze `plan.md` → `docs/plans/issue-170-f23-pac-proxy.md`, `workflow.md` → `docs/workflows/issue-170-f23-pac-proxy-workflow.md` at release. (AC-005.)

## Plan addendum (2026-09-24 takeover review)

Append-only; does not rewrite tasks above.

- **Stop order (AC-006):** Mirror start safely. On stop: `removePac` first (browser stops routing to loopback), then `stopTlsProxy`. On start failure after proxy is up but before PAC succeeds: `stopTlsProxy` only (no PAC to remove). Step-1 tests must assert that stop ordering.
- **Provider wiring:** Keep `PlatformInterceptionProvider.start(activation, origins)` as the PAC-aware seam. The registered `InterceptionProvider` (used by `startInterception`) must either (a) be a thin wrapper that already closes over session `pacOrigins` + returns/sets the proxy endpoint on `activation.proxy`, or (b) gain an origins parameter — prefer (a) in `host.ts` so `startInterception` stays session-scoped without a second origins channel. Delete the always-null local `getCurrentSession` stub in `lifecycle.ts` and import the real one from `interception.ts`.
- **No sdd escalate:** HTTPS MITM stays out of scope; LIVE_E2E sample origins are HTTP loopback.
