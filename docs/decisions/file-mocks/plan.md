# File mocks — plan

Audience: hybrid. Humans approve the strategy. Agents implement the phases
against `checklist.md`.

## Implementation strategy

TDD

## Goal

Add a dedicated `mock` rule type so a matched browser request returns a locally
defined response without contacting upstream. A mock carries a status, headers,
an optional delay, and exactly one body source: inline text or a local file read
at request time from a per-project confined root. Mocks are authored, validated,
compiled, and previewed through the existing Rogatio surfaces, and served only
while the unified native runtime host is running.

## Non-goals

- Do not fold mocks into response-body replace.
- Do not revive the F13 standalone mock server, `/v1/connection`, or the
  Check-and-connect flow.
- Do not change redirect or response-body behavior.
- Do not add an always-on browser path that serves mocks without the host.
- Do not turn the runtime into a general file server or add a file browse API.
- Do not add a new HTTP server, proxy framework, MIME database, or push channel.

## Architecture

### Shape of the change

The mock rule follows the same path every other rule type follows. The schema
package owns the public shape and validation. The compiler emits a new
`MockOperation`. The editor adds one built-in rule-type extension. Dry-run adds
one preview branch. The runtime renders the response. The extension installs a
session declarativeNetRequest (DNR) redirect to the host's loopback listener.

The runtime already carries dormant mock primitives: `RuntimeMockConfig`,
preset normalization, token minting, `renderMockResponse`, and a standalone
`startMockFaucet` server. The plan reuses the config and rendering, and retires
the standalone faucet in favor of the loopback listener that response-body rules
already use. That listener is reachable because `SessionConfig.contentListener`
already starts it without any PAC route, and the host already reports its
endpoint back to the extension as `runtime.start` metadata `proxy`. The route
keeps the existing fresh per-rule token boundary. A rule id and preset digest
are identifiers, not authorization.

### Public API and wire-format changes

Each item below is a published surface. Treat a change here as breaking unless
it is purely additive.

| Surface | Change |
| --- | --- |
| `RuleType` enum and JSON Schema `rule.type` | Add `"mock"`, with a `required: ["mock"]` conditional |
| `RogatioRule` | Add optional `mock?: MockAction` |
| `MockAction` | New public type: `status`, optional `headers`, `delayMs`, and exactly one of `body` or `file` |
| `RogatioOperation` | Add `MockOperation { kind: "mock"; matcher; mock }` |
| `CompilerDiagnosticCode` | Add mock-specific codes for forbidden headers and body-source violations |
| `ActionPreview` for mocks | New stable `kind: "mock"` summary text; the format is pinned by a contract test |
| `runtime.project.set` metadata | Add optional `fileRoot` and `enabledGroupIds`; host validates both and presets only enabled mocks |
| `runtime.start` metadata | Reuse the existing `contentListener` flag and `proxy` endpoint for mocks |
| `mock.connect` metadata | Reuse the internal post-start exchange for per-rule session tokens; add no UI connection state |
| Loopback listener path | Add `/.rogatio/mock/<token>/<digest>` beside `/.rogatio/body/` |
| Session DNR ID bands | Bound the response-body band and open a new mock band (amends ADR 0009) |
| Local project metadata | Add an optional root to extension project records and CLI device-local config; exclude it from exports |
| `rogatio runtime host` | Remove `--mock-port`; require `--root` for stdin projects with file mocks |

### Architecture decisions

1. **Dedicated mock semantics** — ADR 0012 adds `type: "mock"` and locks method,
   delay, and `HEAD` behavior without inheriting an upstream fetch.
2. **Capability-guarded loopback serving** — ADR 0013 reuses the existing
   listener and per-rule tokens, keeps rendered bytes off native messaging, and
   retires the faucet, `--mock-port`, and native mock body replies.
3. **Project-local confined root** — ADR 0014 stores one root outside project
   exports, sends it over `runtime.project.set`, and denies reads unless
   descriptor confinement can be proved.
4. **Redacted request-time errors** — ADR 0015 uses a bounded in-memory error
   map on existing status refreshes and defines its clearing rules.
5. **Kind-scoped session DNR bands** — ADR 0009 is amended to bound the
   response-body band and add a mock band containing redirects and one
   higher-priority loopback guard.

Defaulting absent `Content-Type` to `application/octet-stream`, rejecting
duplicate header names, and deriving `Content-Length` are routine rendering
rules. They do not need separate ADRs.

### Confined root resolution

Resolve the root in this order, and stop at the first hit:

1. The root the user set and saved on this project record.
2. For CLI file-backed projects only, the directory of the opened file when no
   root is saved.
3. No root. Every file-backed mock in the project reports an error.

Never fall back to the process working directory. The host validates the
supplied root as an absolute path to an existing directory before it accepts the
preset. Extension imports cannot reveal an absolute OS path, so they require an
explicit root. Extension storage keeps the root beside `StoredProject.data`.
CLI storage uses device-local config keyed by canonical project path, never a
sidecar beside the project.

The current confined reader is not sufficient proof under a concurrent
intermediate symlink swap: it opens first, then resolves the path, without
proving both refer to the same object chain. Harden that shared primitive or
report `unsupported` on platforms where the proof is unavailable. Never fall
back to the current path-only mock reader.

## Phases

Each phase maps to one checklist section in `checklist.md`. Phases run in order.
Phases 1 through 6 are pure and testable without a running host.

| Phase | Package | Intent |
| --- | --- | --- |
| 1 | `schema` | Add the public mock shape to the types and the JSON Schema |
| 2 | `schema` | Add mock semantic validation with stable diagnostic paths |
| 3 | `extension` (`browser-schema.ts`) | Mirror mock validation in the browser-safe validator |
| 4 | `compiler` | Emit `MockOperation` with stable diagnostics |
| 5 | `dry-run` | Preview the intended mock action without touching files |
| 6 | `editor` | Author, edit, copy, and remove mock rules |
| 7A | `runtime` | Prove confined binary file reads under race and platform limits |
| 7B | `runtime` | Render status, headers, body, delay, and method semantics |
| 8A | `runtime` | Build enabled mock presets and validate the confined root |
| 8B | `runtime`, `cli` | Carry large bounded config through native framing and CLI startup |
| 9A | `runtime` | Serve authorized mocks on the loopback listener |
| 9B | `runtime` | Report and clear redacted file errors; retire obsolete protocol |
| 10A | `extension` | Install and remove session DNR redirects with a loop guard |
| 10B | `extension`, repo | Prove mock routing and method preservation in real Chrome |
| 11A | `extension` | Report mock rule status and the file-error signal |
| 11B | `extension`, `browser-core` | Store and manage the device-local confined root |
| 12 | `cli` | Surface the confined root and mock preview in CLI workflows |
| 13 | repo | Contract test, docs sync, and full validation |

## Risks

### Over-engineering risks

These are the most likely ways this feature grows past its brief. Prefer the
listed reuse in every case.

- **A second HTTP server.** The dormant `startMockFaucet` is a whole extra
  listener with its own port flag and token scheme. Reuse the loopback intercept
  listener and its session lifecycle instead. Delete the faucet, but keep its
  fresh per-rule capability tokens.
- **A new file subsystem.** `readConfinedFile` already does no-follow open,
  bounded chunk reads, hard-link rejection, post-read `fstat`, abort handling,
  and raw bytes. Harden its intermediate-component race proof, then adapt its
  input for mocks. Do not write a second reader or weaken existing grant
  authorization.
- **A new limits module.** `LIMITS` in `packages/schema/src/limits.ts` already
  holds every mock bound this feature needs. Add nothing unless a bound is
  genuinely missing.
- **A content-type guessing library.** Require an explicit `Content-Type` header
  or fall back to `application/octet-stream`. No MIME database.
- **A push channel for rule errors.** Reuse the existing state refresh. Do not
  add a subscription, a port, or a polling timer.
- **A storage envelope version bump.** Add the saved root as an optional field on
  the stored project record and read it defensively. Bump
  `ENVELOPE_VERSION` only if a migration proves unavoidable.

### Correctness and security risks

- **DNR band collision.** `isResponseBodyRedirectId` matches every id at or above
  `4_000_001`, so `removeResponseBodyRedirects` would delete mock rules placed
  above it. Bound both bands before adding the mock band.
- **Mock recursion.** A user regex such as `.*` also matches the loopback mock
  URL. Without an explicit guard the redirect loops. The guard must be session
  scoped, match only the listener route, have priority above the maximum authored
  priority, and disappear with the session.
- **Non-GET DNR redirects.** Chrome's redirect behavior for `POST` and other
  methods is unproven. Keep this as an explicit delivery risk. Prove that Chrome
  preserves the method with a real browser journey. If Chrome does not, the
  locked all-method contract needs a new product decision before implementation
  can ship.
- **Extension-supplied absolute root.** Chrome MV3 has no API that yields an
  absolute directory path, so the user types it. The host must validate it and
  must never widen it. Treat the root as an authority grant in review.
- **Confinement race.** `openConfinedFile` currently opens through the path and
  then resolves it. A concurrent intermediate symlink swap can make those checks
  describe different objects. A platform without a descriptor-anchored proof
  must report `unsupported`.
- **Native envelope size.** `runtime.project.set` is capped at 64 KiB, while a
  valid project can exceed that and authored inline mock text is part of the
  config. Test the largest valid inline mock through real native framing. Reuse
  the existing bounded multipart staging pattern if one envelope cannot carry
  it. Do not increase the frame cap or send rendered/file bytes in envelopes.
- **Collapsed file errors.** `renderMockResponse` maps every file failure to
  `runtime.file-denied` today. Losing `runtime.size-limit`,
  `runtime.file-race-rejected`, `runtime.platform-unsupported`, and
  `runtime.timeout` would make R6 untestable.
- **Path leakage in diagnostics.** No logical or absolute path may appear in any
  rule error, status, log line, or HTTP failure body.
- **Browser bundle contamination.** The browser-schema mirror must stay free of
  Ajv, `node:` imports, and `@rogatio/dry-run`.
- **Digest instability.** Minted per-rule values must stay out of the canonical
  preset bytes, or the preset digest changes on every start.
- **Header ambiguity.** Reject duplicate names case-insensitively and all
  response-framing headers. Compute one `Content-Length`; preserve one configured
  `Content-Type` and `Cache-Control`.
- **Delayed-request exhaustion.** A page can issue many matching requests with
  long delays. Reuse the runtime's concurrent-operation bound, never buffer
  request bodies, and abort work when the client disconnects.
- **Open product choice: HTTP no-body statuses.** The schema range includes
  `204`, `205`, and `304`, while every mock requires a body source. Their
  response-body and `Content-Length` behavior is undefined. Do not implement or
  test these statuses until the user chooses the product behavior.

## Acceptance criteria

Each criterion is observable through a test or a command.

1. A project with a `type: "mock"` rule carrying status, headers, delay, and one
   body source validates in both `@rogatio/schema` and the browser-safe mirror,
   and the two produce the same diagnostic paths. (R1, R2)
2. A mock rule with both `body` and `file`, with neither, with an out-of-range
   status or delay, with a control character in a header name or value, with a
   response-framing header, or with an unknown property fails with a stable
   field-specific diagnostic. (R2)
3. `compileProject` emits one `MockOperation` per mock rule. Runtime preset
   construction retains only enabled groups, and the operation round-trips with
   a stable digest. (R1)
4. The editor can create, edit, copy, remove, save, and reload a mock rule, and
   rejects an invalid draft without saving. The browser bundle contains no
   `node:` import, no Ajv, and no `@rogatio/dry-run`. (R3)
5. `rogatio test`, `POST /api/dry-run`, and the extension `dry-run` command all
   return the same mock preview summary for the same case, and none of them
   opens a file or starts a runtime. (R4)
6. A matched mock served by the running host returns the configured status,
   headers, and body, and no request reaches the original upstream host. (R5)
7. A file-backed mock returns the current file bytes on every request, including
   non-UTF-8 bytes. A missing, unreadable, oversized, hard-linked, replaced, or
   out-of-root file, including an intermediate symlink replacement race, fails
   closed with a distinct stable error, and no diagnostic contains a path. A
   platform that cannot prove confinement reports `unsupported`. (R6)
8. A mock with no method filter serves every method. A mock with a method filter
   serves only that method. `HEAD` applies the same delay and file read, returns
   full-body `Content-Length`, and sends an empty body. A real Chrome test proves
   a `POST` redirect arrives as `POST`. (locked decision 2)
9. A rule whose regex also matches the loopback mock URL serves once and does not
   loop. Stopping the runtime or disconnecting the host removes every mock
   session rule and the loop guard. (R7)
10. An enabled mock reports `needs runtime` before the host starts, `active`
    after the redirect is installed, `unsupported` when the platform or native
    adapter cannot support it, and `error` on projection, install, or
    request-time file failure. (R8)
11. A rule in file error returns to `active` after a later successful read, and
    clears immediately when the project is saved or the host restarts.
    (locked decision 3)
12. A project with no saved root and no originating file reports an error for
    every file-backed mock and never reads from the process working directory.
    (locked decision 1)
13. The maximum valid inline mock reaches the host through native framing
    without raising the 64 KiB envelope cap. Rendered and file bytes never enter
    a native envelope.
14. `pnpm validate` passes, and the emitted CLI bundle still has no workspace
    dependencies.

### Acceptance evidence map

| Criterion | Checklist phase | Required evidence |
| --- | --- | --- |
| 1–2 | 1–3 | Schema cases, adversarial semantic cases, and browser-validator parity |
| 3 | 4, 8A | Compiler field assertions, enabled-group filtering, and digest tests |
| 4 | 6 | Editor lifecycle tests and browser-bundle import check |
| 5 | 5, 12 | Dry-run unit tests plus built CLI, HTTP, and extension-command parity |
| 6 | 9A, 10B | Loopback integration and Chrome journey with an upstream request trap |
| 7 | 7A–7B, 9B | Confinement races, binary reads, stable errors, and path-redaction checks |
| 8 | 7B, 9A, 10A–10B | Runtime method tests and required Chrome `POST` preservation journey |
| 9 | 10A–10B | Session cleanup tests and real-Chrome broad-regex recursion journey |
| 10–11 | 9B, 11A | Status transition and file-error clearing tests through `get-state` |
| 12 | 8A, 11B, 12 | Missing-root tests that place a tempting file in the process working directory |
| 13 | 8B, 9A | Maximum inline config through native framing; response bytes over loopback |
| 14 | 13 | Canonical `pnpm validate` and emitted-bundle dependency check |

## Contracts

`updated`. `docs/contracts.md` covers the public shape, local root storage,
native metadata, capability route, DNR lifecycle, errors, and tooling pointers.
It does not copy the schema. `packages/schema/src/schema.ts` remains the shape
source of truth.

Contract verification stays with the phase that owns each surface:

| Contract surface | Verification | Phase |
| --- | --- | --- |
| Public schema and limits | Schema contract pin against source schema | 13 |
| Browser validator parity | Shared-fixture ordered diagnostic comparison | 3 |
| Compiler operation | Field-by-field compiler test and exhaustive union check | 4 |
| Preview summary | Dry-run contract pin and three-surface parity | 5, 12, 13 |
| Native metadata and frame bound | Host-bridge protocol and maximum-config tests | 8A–8B |
| Capability route and error codes | Loopback authorization, framing, and status tests | 9A–9B |
| Session DNR lifecycle | Band, rollback, cleanup, recursion, and Chrome tests | 10A–10B |
| Device-local roots | Export-exclusion and storage round-trip tests | 11B, 12 |
