# F23 — Unified Native-Host Runtime

**Status:** Approved specification.

## Goal

Rogatio uses one device-local native host process for mock, response-body, and request-body runtime behavior. Normal extension operation has only **Start runtime** and **Stop runtime**; there is no separate Check and connect action and no user-run CLI proxy server.

The host owns the internal loopback proxy and TLS interception. For a matching supported request it validates authority, reads a bounded body, applies one highest-priority replacement or regex rule, opens a fresh connection to the original origin, and relays the modified request. Non-matching or unsupported requests pass through untouched when protocol-safe.

## Approved decisions

- Start configures scoped PAC/proxy routing automatically.
- CLI remains installer/admin functionality only.
- CA trust is established once during setup, never silently on every Start.
- Unsupported/non-transformable requests pass through untouched.
- Only the highest-priority matching request-body rule applies; ties use source order and stable rule ID.
- Mock, response-body, and request-body behavior share one host and one lifecycle.

## Requirements

1. Start establishes native messaging, loads one immutable active-project policy, starts the host-owned proxy/TLS path, and installs exact scoped PAC routing transactionally.
2. Start failure rolls back every component already started and leaves external proxy state unchanged.
3. Stop removes only Rogatio-owned PAC/proxy state, aborts active work, invalidates capabilities, clears transient body buffers, restores prior proxy state, and is idempotent.
4. Native host registration and device-local CA trust are one-time installer/admin prerequisites. They are not repeated by Start.
5. The native host owns the internal proxy listener; no separate CLI proxy process is required.
6. Every intercepted request is revalidated against the immutable policy before body access, including rule identity, URL, effective origin, method, resource type, initiator scope, target, and enabled-group authority.
7. Non-matching and unsupported requests pass through untouched. A matching request never receives a partial rewrite or unsafe original-body fallback after transformation begins.
8. One highest-priority request-body rule applies; request-phase actions do not compose.
9. Initial body support is bounded UTF-8 JSON, form-encoded, or textual HTTP/1.1 bodies with valid Content-Length and identity encoding. Compressed, multipart, binary, ambiguous, invalid, or oversized bodies are unsupported.
10. Transformed requests recalculate framing, remove internal/hop-by-hop headers, preserve approved browser metadata including Cookie and Authorization, reject unsupported signatures/mTLS, and connect upstream using the original hostname for Host/SNI.
11. Redirects, proxy recursion, unsafe targets, unsafe DNS results, automatic retries, and traffic persistence are forbidden.
12. Native messaging carries lifecycle, policy, and metadata/control only. Request and response bodies remain inside the host-owned interception path; mock response delivery is bounded and explicitly typed.
13. Public diagnostics are stable and redacted: no bodies, credentials, sensitive headers, raw URLs, paths, addresses, certificates, stack traces, or third-party wording.
14. Runtime status is unified: stopped, starting, running, stopping, error, or unsupported. Separate mock connected/checking state is removed.

## Compatibility and non-goals

Existing `.rogatio.json` projects remain valid. Existing installer/admin trust operations remain available. The extension no longer requires an operational `rogatio runtime` command. There is no unrestricted forward proxy, persistent traffic history, automatic trust installation, sequential rule composition, or initial support for compressed/multipart/binary bodies or signed-body recomputation.

## Acceptance criteria

- Start once reaches running and enables mock, response-body, and request-body behavior without Check/connect.
- Stop once tears down the unified session and repeated Stop is harmless.
- Scoped PAC/proxy startup and rollback are atomic.
- Highest-priority request-body replacement/regex reaches the original origin through a fresh upstream connection.
- Non-matching and unsupported requests reach the origin unchanged.
- Native control messages contain no observed request/response body bytes.
- Existing unit, integration, browser, build, and canonical validation suites pass.
