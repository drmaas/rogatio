# F17 Request-Body Rules Implementation Plan

**Plan tier:** Free  
**Model:** `opencode/hy3-free` (verified equivalent for normal `opencode-go/hy3` plan role)  
**Specification:** `docs/specs/f17-request-body-rules.md` (reapproved 2026-08-25, ordinary MV3 authority)  
**Base:** `f76838d`  
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f17`  
**Branch:** `feature/f17`  
**Dependencies:** F14, F16, F7, F5  
**Repository changes:** None during planning

## Scope Guardrails

- F6 GET/HEAD authorization, F13 mocks, and F15 GET-only response rewriting remain separate.
- Do not widen `packages/runtime/src/server.ts` into a forward proxy.
- Package boundaries stay unchanged:

| Package | F17 boundary | F17 does not own |
|---|---|---|
| `schema` | Version-1 rule and exact-local-origin validation | Network, proxy, credentials |
| `compiler` | Detached ordered `RequestBodyOperation` values | Chrome, TLS, persistence |
| `browser-core` | Generic enablement, permission, status seams | Native messaging, body bytes |
| `editor` | Request-body fields and project local-origin fields | Runtime or filesystem access |
| `extension` | Chrome metadata, policy session, PAC, markers, lifecycle | Request bodies, TLS, upstream |
| `runtime` | Policy validation, authority, proxy, TLS, transform, forwarding | Browser storage, editor state |
| F16 trust layer | Native-host manifest and X.509 CA trust lifecycle | Request transformation |
| `cli` | Offline verify/edit/test and explicit trust/install diagnostics | Ownership of live browser sessions |
| `dry-run` | Additive F12 selector extension | F12 breaking change |

- No new product dependency. Use existing Node built-ins, browser APIs, and injected platform adapters only.

## Current Baseline Repairs (Prerequisite)

| Area | Current gap | F17 repair |
|---|---|---|
| F14 lifecycle | `f14-lifecycle.ts` is injected capability seam only; no policy/session ownership | Add policy-aware shared provider/session seam |
| F14 authority | `f14-revalidate.ts` accepts caller-selected IDs, lacks enabled groups/grants/digest/global arbitration | Add complete policy-bound authority validation |
| F14 protocol | `f14-envelope.ts` is metadata-only; not F17 staged native protocol | Keep `f14-v1`; add separate `f17-v1` framing/staging |
| F14 interception | `f14-interception.ts` has global provider state, no ownership rollback | Per-session ownership, actual provider state, PAC rollback, failure cleanup |
| F15 provider | `f15-interception.ts` only wraps injected adapter calls | Reuse shared provider seam without changing F15 GET-only semantics |
| F15 browser parity | `extension/browser-schema.ts` does not validate response-body payloads fully | Synchronize browser-safe F13/F15/F17 validation |
| F15 editor parity | `editor.ts` `ACTION_FIELDS` omits `responseBody` | Repair action-field cleanup and stale payload removal |
| F16 trust | `f16-trust.ts` stores SPKI/public-key, treats key existence as trust | Supply actual X.509 CA certificate/key, actual trust status, confinement, rollback |
| F16 CLI | `runtime install` has no required explicit extension ID; manifest uses empty origins | Add exact `--extension-id` handling and identity-bound manifest |
| Native host | No native-messaging executable or host entrypoint exists | Add explicit host entry/build/install contract |
| CLI editor host | `commands/edit.ts` uses wrong `createEditor` call shape and async validator shape | Repair host wiring using browser-safe synchronous validation |
| Runtime proxy | No HTTP/1.1 request-body proxy, TLS interception, marker verification, upstream forwarding | Add isolated F17 provider; do not modify F6 server behavior |

## Tests First

Author tests before production implementation. Add only test/configuration files in this phase. Run focused tests after authoring; expected result is red until corresponding production modules exist. Do not weaken assertions.

| Test file or area | First contract | Acceptance criteria |
|---|---|---|
| `packages/schema/test/request-body.test.ts` | Strict action shape, Unicode, bounds, methods, resource type, local origins, hostile objects | AC-001, AC-002, AC-005 |
| `packages/extension/test/browser-schema-request-body.test.ts` | Browser/Node valid-invalid parity and no Node/AJV imports | AC-003 |
| `packages/compiler/test/request-body.test.ts` | Detached operation and source order | AC-001, AC-002 |
| `packages/compiler/test/selector.test.ts` | Request/response phase, enabled groups, grants, target/initiator, priority, source-order tie, no composition | AC-004, AC-005 |
| `packages/dry-run/test/request-body.test.ts` | F17 winner/preview behavior with additive F12 contract | AC-004, AC-026 |
| `packages/runtime/test/f17-policy.test.ts` | Policy validation, detachment, canonical bytes, digest, limits, no sensitive payloads | AC-006, AC-008, AC-009 |
| `packages/runtime/test/f17-native-protocol.test.ts` | Chrome framing, 64 KiB frames, policy staging, part order, duplicates, timeout, digest mismatch | AC-007, AC-008 |
| `packages/runtime/test/f17-transform.test.ts` | Replace, strict UTF-8, MIME/encoding, regex `gu`, expansion, timeout, output bounds | AC-017, AC-018, AC-019 |
| `packages/runtime/test/f17-wire.test.ts` | Raw HTTP/1.1 framing, headers, methods, signatures, mTLS rejection | AC-016, AC-020, AC-021 |
| `packages/runtime/test/f17-proxy.test.ts` | Raw loopback proxy, marker handling, target policy, DNS pinning, zero upstream calls on failure | AC-014 through AC-023 |
| `packages/runtime/test/f14-*.test.ts` | F14 compatibility and shared provider ownership regression | AC-005, AC-011, AC-012, AC-023 |
| `packages/runtime/test/f15-interception.test.ts` and `response-body.test.ts` | F15 provider/status/credential/privacy regression | AC-005, AC-008, AC-020 |
| `packages/runtime/test/f16-trust.test.ts` | X.509 material, actual trust adapter, identity, confinement, atomicity, rollback | AC-009, AC-024 |
| `packages/extension/test/f17-policy.test.ts` | Policy construction and deterministic digest parity | AC-006, AC-008, AC-009 |
| `packages/extension/test/f17-session.test.ts` | Explicit start, serialization, rollback, stop, policy replacement, collision | AC-010 through AC-012, AC-027, AC-028 |
| `packages/extension/test/f17-metadata.test.ts` | Explicit metadata copy and no request-body/header/credential access | AC-013 |
| `packages/extension/test/f17-status.test.ts` | Disabled, permission, proxy, unsupported, error, active states | AC-010, AC-027 |
| `packages/editor/test/request-body.test.ts` | Mode controls, exact defaults, stale-field cleanup, constraints, diagnostics | AC-025 |
| `packages/editor/test/editor.test.ts` | F15/F17 action-field replacement and detached drafts | AC-005, AC-025 |
| `packages/cli/test/runtime-command.test.ts` | Explicit extension ID, trust/install status, offline runtime behavior | AC-024, AC-026 |
| `packages/cli/test/verify.test.ts`, `test.test.ts`, `routes.test.ts` | F17 validation and preview without runtime/network access | AC-026 |
| `test/browser/editor.spec.ts` | Browser artifact request-body controls and accessibility | AC-025 |
| `test/browser/request-body-live.spec.ts` | Dedicated capable-platform live gate | AC-029 |

## Ordered Tasks

### Task 1: Extend Schema and Browser-Safe Validation

**Depends on:** Tests first (author schema tests)

**Files:** 
- `packages/schema/src/types.ts`
- `packages/schema/src/limits.ts`
- `packages/schema/src/schema.ts`
- `packages/schema/src/validation.ts`
- `packages/schema/src/browser-validation.ts`
- `packages/schema/src/browser-index.ts`
- `packages/schema/src/index.ts`
- `packages/schema/test/request-body.test.ts`

**Changes:**
- Add `request-body` to `RuleType` enum.
- Add `RequestBodyMode`, strict replace/regex action types, `RequestBodyRuleFields`, optional `RequestBodyPolicyConfig.localOrigins`.
- Add exact F17 bounds: 4 MiB input/output, 2,048 UTF-16 pattern units, 4,096 UTF-16 replacement units, 32 local origins, 32 request-body operations/transforms, 256 KiB policy, 64 KiB frame, 250 ms regex deadline.
- Require: `type: "request-body"`; `method` exactly `POST`/`PUT`/`PATCH`; `resourceTypes` exactly `["xmlhttprequest"]`; exactly one `requestBody` action; replace exactly `{ mode, body }`; regex exactly `{ mode, pattern, replacement }`; no unknown keys; valid Unicode without lone surrogates; strict UTF-8/policy bounds; non-empty valid `gu` regex pattern; exact normalized HTTP(S) local origins.
- Implement semantic validation for constraints JSON Schema cannot express reliably.
- Preserve existing project validity when no F17 fields exist.
- Mirror all F17 checks in `browser-validation.ts` without AJV, Node imports, or runtime-compiled validation.
- Export browser-safe validation/types needed by browser hosts.

**Covers:** AC-001, AC-002, AC-003, AC-005

### Task 2: Add Detached Operations and Global Winner Selection

**Depends on:** Task 1

**Files:**
- `packages/compiler/src/types.ts`
- `packages/compiler/src/compile.ts`
- `packages/compiler/src/diagnostics.ts`
- `packages/compiler/src/index.ts`
- New: `packages/compiler/src/selector.ts`
- Compiler tests

**Changes:**
- Add `RequestBodyOperation` and strict detached action copying.
- Emit zero-based traversal source order for request-body operations (group array order, then rule array order).
- Add one shared selector for immutable operation sets that:
  - Filters enabled groups and fully granted effective origins
  - Matches URL, method, resource type, initiator (when exact selector context available), target, and phase
  - Selects only request-phase operations for request phase
  - Excludes response-body and response-header operations from request phase
  - Chooses highest priority, then lowest source order
  - Returns exactly one winner or `{ kind: "none" }`
  - Never composes operations
  - Never mutates inputs
  - Returns stable results independent of iteration order
- Use compiled operation array index as source order for legacy operation kinds unless policy contract amended to add explicit field to every operation.
- Validate `RequestBodyOperation.sourceOrder` against that index.
- Update compiler fixtures to prove existing redirect, query, header, mock, and response-body operation kinds remain supported.

**Covers:** AC-001, AC-004, AC-005, AC-025

### Task 3: Preserve Browser-Core Boundary

**Depends on:** Task 2

**Files:**
- `packages/browser-core/test/status.test.ts`
- `packages/browser-core/test/repository.test.ts`
- `packages/browser-core/test/runtime.test.ts`
- Source changes only if required by operation type updates

**Changes:**
- Keep `browser-core` free of runtime/native/proxy dependencies.
- Continue using `computeRuleStatuses` for base disabled/permission/install state.
- Overlay runtime-dependent request-body state in the extension layer rather than adding runtime knowledge to browser-core.
- Verify request-body project data remains additive, save/import still reset enablement, grants remain exact, and existing F4 behavior is unchanged.

**Covers:** AC-005, AC-027, AC-028

### Task 4: Repair F14 Shared Runtime Seams

**Depends on:** Task 2

**Files:**
- `packages/runtime/src/f14-types.ts`
- `packages/runtime/src/f14-envelope.ts`
- `packages/runtime/src/f14-lifecycle.ts`
- `packages/runtime/src/f14-interception.ts`
- `packages/runtime/src/f14-pac.ts`
- `packages/runtime/src/f14-revalidate.ts`
- `packages/runtime/src/f15-interception.ts`
- F14/F15 regression tests

**Changes:**
- Keep `f14-v1` as F15 metadata-only protocol.
- Add separate policy-aware session seam instead of changing F6 or pretending F14 already owns F17 traffic.
- Add explicit per-session ownership containing provider state, policy digest, extension ID, PAC origins, target policy, and owned routing identity.
- Remove global mutable provider authority from active-session path.
- Make start transactional: provider remains non-accepting until policy, trust, capability, collision, PAC, marker, and provider checks succeed. On failure, remove only Rogatio-owned routing, stop provider/session state, clear pending work, leave external proxy settings unchanged.
- Make stop idempotent and invalidate policy, capabilities, pending requests, sockets, timers, and workers.
- Extend authority revalidation to consume complete immutable policy and shared selector.
- Keep existing F14 callers/tests behaviorally compatible where required by F15.
- Make PAC exact-origin, deterministic, and `DIRECT` outside configured origins. Do not retain F14's older subdomain interpretation for F17.

**Covers:** AC-004, AC-005, AC-011, AC-012, AC-014, AC-023, AC-027, AC-028

### Task 5: Repair F16 Trust and Identity Lifecycle

**Depends on:** Task 4

**Files:**
- `packages/runtime/src/f16-trust.ts`
- `packages/runtime/src/index.ts`
- F16 tests
- `packages/cli/src/commands/runtime.ts`
- `packages/cli/src/index.ts`
- CLI tests

**Changes:**
- Replace SPKI-only CA handling with injected platform CA adapter supplying actual X.509 certificate and private-key material.
- Keep material confined to install root and runtime memory; never place in policy, native messages, diagnostics, or logs.
- Require: exact 32-character lowercase extension ID from `a`-`p`; exact `chrome-extension://<id>/` manifest origin; host path existence; canonical confined host path; platform manifest directory; fixed executable paths and argument arrays for platform tools; actual trust-store status (not CA-key presence); byte comparison before rewriting identical manifest; atomic manifest/material writes and cleanup; rollback on partial trust/install failure.
- Add internal runtime-only bridge for F17 to consume certificate/key material without exposing through policy contract.
- Require `rogatio runtime install --extension-id <id>`. Reject omitted, malformed, wildcard, or mismatched IDs before writes.
- Preserve explicit `trust`, `untrust`, `install`, `uninstall`; do not auto-run from `runtime start`.

> Superseded by: feat/collapse-runtime-uninstall-and-untrust

**Covers:** AC-009, AC-024, AC-028

### Task 6: Add F17 Policy, Canonicalization, Native Framing, and Host Control

**Depends on:** Tasks 2, 4, and 5

**Files:**
- `packages/runtime/src/types.ts`
- `packages/runtime/src/errors.ts`
- `packages/runtime/src/index.ts`
- New: `packages/runtime/src/f17-types.ts`
- New: `packages/runtime/src/f17-policy.ts`
- New: `packages/runtime/src/f17-canonical.ts`
- New: `packages/runtime/src/f17-native-framing.ts`
- New: `packages/runtime/src/f17-policy-staging.ts`
- New: native-host entrypoint
- Runtime tests

**Changes:**
- Define `f17-v1` separately from F14.
- Add F17 stable error codes without changing F6 public error behavior.
- Implement independent policy validation for: protocol/version; exact extension ID and native origin; project identity/revision and committed-project digest; enabled groups and granted origins; local target origins; operation shape, IDs, source order, matcher data, methods, resource types, action bounds, and limits; policy operation count and canonical policy size.
- Build detached immutable policy state.
- Canonical bytes must use fixed key ordering, deterministic set ordering, compact UTF-8 JSON, and SHA-256 digest format `sha256:<64 lowercase hexadecimal>`.
- Implement Chrome native-message framing with four-byte little-endian payload length.
- Enforce 64 KiB frame and 256 KiB policy limits before allocation.
- Implement `policy-begin`, `policy-part`, and `policy-commit` staging. Parts contain only base64url canonical policy bytes. Reject malformed, duplicate, reordered, oversized, timed-out, incomplete, and digest-mismatched staging.
- Keep one active policy per session and discard on disconnect, stop, replacement, or failure.
- Add native host entrypoint reading/writing only framed JSON on standard streams. No diagnostics or third-party tool output to native protocol stream.
- Add canonical golden-vector tests shared between browser and Node serializers.

**Covers:** AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-028

### Task 7: Implement Bounded Request Transformation

**Depends on:** Task 6

**Files:**
- New: `packages/runtime/src/request-body.ts`
- New: `packages/runtime/src/f17-regex-worker.ts` (or equivalent isolated worker boundary)
- Runtime tests

**Changes:**
- Implement discriminated transform result with stable code only.
- Validate before transformation:
  - Body length is non-negative and equals received bytes
  - Body is at most 4 MiB
  - Accepted MIME type is JSON, `application/*+json`, form-encoded, or `text/*`
  - Charset is absent or UTF-8
  - Content encoding is absent or `identity`
  - Input is strict UTF-8 (including replace mode)
  - No binary or unsupported framing metadata accepted
- Implement replace mode: validate incoming bytes, discard them, encode configured replacement UTF-8 bytes.
- Implement regex mode: one `gu` ECMAScript regex, standard `String.replace` expansion. Never evaluate replacement text. Preserve zero-length global-match progress semantics.
- Run regex work in independently terminable boundary. Enforce 250 ms regex deadline, complete operation timeout, output limit, and concurrent-transform limit. Terminate workers on timeout/failure/resource exhaustion.
- Never expose partial output or fall back to original body after transform failure.

**Covers:** AC-017, AC-018, AC-019, AC-021, AC-028

### Task 8: Implement Target Policy, Wire Validation, TLS, and Scoped Proxy

**Depends on:** Tasks 5, 6, and 7

**Files:**
- New: `packages/runtime/src/f17-target.ts`
- New: `packages/runtime/src/f17-wire.ts`
- New: `packages/runtime/src/f17-tls.ts`
- New: `packages/runtime/src/f17-proxy.ts`
- Updates to `packages/runtime/src/f14-interception.ts`
- Runtime integration tests

**Changes:**
- Keep provider separate from F6 `server.ts`.
- Implement loopback-only HTTP/1.1 provider:
  - HTTP absolute-form only for port 80
  - HTTPS `CONNECT` only for port 443
  - Reject arbitrary CONNECT targets
  - Reject HTTP/2, HTTP/3, ALPN other than `http/1.1`, redirects, ambient proxy settings, re-resolution
  - Parse and validate exactly one decimal `Content-Length`
  - Count received bytes independently
  - Reject early EOF, excess bytes, duplicate/conflicting lengths, transfer encoding, chunking, trailers, `Expect`, `Upgrade`, pipelining, multipart, compression, and unsupported bodies
  - Do not resolve or connect upstream before validation and transformation succeed
- Implement exact target URL validation and public/local-origin policy.
- Resolve all A and AAAA answers, reject mixed public/non-public answers, classify all addresses, pin one validated address.
- Preserve hostname for HTTP authority and HTTPS SNI.
- Implement TLS interception through F16-provided X.509 CA material and injected leaf-certificate adapter.
- Reject client-certificate/mTLS negotiation before upstream body transmission.
- Preserve `Cookie`, `Authorization`, `Origin`, `Referer`, and ordinary approved metadata.
- Reconstruct `Host`/authority and `Content-Length`.
- Remove or reject hop-by-hop, proxy, transfer, trailer, stale encoding, and conflicting framing headers.
- Reject `Content-MD5`, `Digest`, `Content-Digest`, `Signature`, `Signature-Input`.
- Verify markers before transforming.
- Remove internal markers before upstream.
- Forward routed-origin traffic unchanged only when there is no body winner.
- Block selected body operations on missing, expired, duplicated, or mismatched markers.
- Use injected resolver/transport/TLS/PAC adapters in unit and raw HTTP integration tests.
- Assert resolver and transport call counts are zero for all pre-upstream failures.

**Covers:** AC-014 through AC-023, AC-028, AC-029

### Task 9: Integrate Extension Policy and Live Session

**Depends on:** Tasks 2, 4, 5, 6, and 8

**Files:**
- `packages/extension/public/manifest.json`
- `packages/extension/src/chrome.ts`
- `packages/extension/src/protocol.ts`
- `packages/extension/src/diagnostics.ts`
- `packages/extension/src/projection.ts`
- `packages/extension/src/dnr.ts`
- `packages/extension/src/service-worker.ts`
- `packages/extension/src/background.ts`
- `packages/extension/src/extension-page-entry.ts`
- New: native-session, policy, metadata, and marker modules
- Extension tests

**Changes:**
- Add only permissions required for approved browser boundary: native messaging, proxy control, metadata observation, existing storage/DNR permissions, and declared optional host access. Do not add `webRequestBlocking` or fetch interception.
- Add explicit extension identity build configuration. Validate actual `chrome.runtime.id` against configured ID; never infer an ID for policy authority.
- Build policy from committed project state, enabled groups, granted origins, exact local origins, all request-phase arbitration operations, source order, limits, revision, and digest. Exclude observed bodies, response bodies, cookies, credentials, sensitive headers, mock file contents, and unrelated payloads.
- Add native session coordinator serializing start, stop, policy replacement, permission changes, PAC changes, and marker installation. Start only after explicit user action and successful policy, identity, trust, capability, collision, and arbitration checks.
- Add metadata-only `webRequest` listener. Explicitly copy URL, target, method, resource type, initiator, request ID, and policy digest. Never read or spread `details.requestBody`, headers, cookies, or authorization values.
- Add marker routing through dedicated adapter and DNR session-rule seam. Adapter must prove global winner suppression or return `unsupported`; must not rely on incidental DNR ordering.
- Keep request-body operations out of DNR body actions. Keep existing redirect/query/header/mock installation behavior and F15 response-body routing separate while ensuring higher-priority request action suppresses lower request-body transformation.
- Map status from actual state:
  - Disabled group → `disabled`
  - Missing grant → `needs permission`
  - No active body session → `needs proxy`
  - Missing capability/trust/identity/arbitration/collision support → `unsupported`
  - Provider/policy installation failure → `error`
  - Policy/provider/PAC/marker installation complete → `active`
- Stop must be idempotent, remove only owned routing, invalidate pending work, avoid overwriting changed external proxy settings.

**Covers:** AC-004, AC-005, AC-006, AC-008 through AC-015, AC-020, AC-021, AC-027, AC-028

### Task 10: Add Editor and Offline CLI Support

**Depends on:** Tasks 1 and 2

**Files:**
- New: `packages/editor/src/rule-types/request-body.ts`
- `packages/editor/src/rule-types/index.ts`
- `packages/editor/src/index.ts`
- `packages/editor/src/types.ts`
- `packages/editor/src/editor.ts`
- Existing response-body rule/editor tests
- `packages/extension/src/browser-schema.ts`
- `packages/cli/src/commands/edit.ts`
- `packages/cli/src/commands/verify.ts`
- `packages/cli/src/commands/test.ts`
- `packages/cli/src/commands/runtime.ts`
- `packages/cli/src/server/routes.ts`
- `packages/cli/src/index.ts`
- CLI/editor tests

**Changes:**
- Add request-body editor controls: mode selector; replace body control; regex pattern and replacement controls; exact defaults; stable field paths; bounded fields; stale-field cleanup when changing mode or rule type; detached draft behavior.
- Constrain request-body rules to POST/PUT/PATCH and exactly `xmlhttprequest` in rendered editor. If existing extension registry cannot express common-field constraints, implement smallest built-in editor constraint seam or resolve required extension metadata contract before coding.
- Repair generic action-field handling so switching among query, mock, response-body, and request-body types removes stale fields and preserves only selected action.
- Synchronize F13/F15/F17 browser validation and operation checks. Ensure response-body validation uses same strict payload and regex rules in Node and browser hosts.
- Repair `commands/edit.ts` to call current `createEditor(options)` contract. Use browser-safe synchronous validation adapter; do not change F5 to accept asynchronous validation. Serve browser-safe schema validator if required. Keep save/dry-run callbacks asynchronous and offline.
- Update CLI verify/test/edit diagnostics to use stable mapped diagnostics rather than raw AJV or platform wording. Add safe request-body action previews containing metadata only, never test body persistence or runtime calls.
- Extend `runtime install` parsing to require explicit extension ID. Keep `runtime start` process diagnostics-only when no extension policy exists.

**Covers:** AC-003, AC-005, AC-025, AC-026, AC-027

### Task 11: Build, Integration, and Capability-Gated E2E

**Depends on:** Tasks 1 through 10

**Files:**
- `scripts/build.ts`
- `scripts/validate.ts`
- `package.json`
- `playwright.config.ts`
- `scripts/serve-smoke.ts`
- `test/browser/*`
- Integration tests
- Package manifests only if required

**Changes:**
- Add build targets for native host/isolated regex worker if implementation requires separate files. Update artifact expectations and emitted-module checks.
- Extend validation to verify:
  - F17 browser artifacts contain no Node globals, Node imports, AJV runtime, filesystem, TLS, runtime, or observed body data
  - Extension manifest contains only approved permissions
  - Native host output is non-empty and executable in configured install layout
  - Policy serializers produce deterministic bytes
  - Negative type fixtures remain unchanged
  - Generated outputs are not source-controlled
- Add raw HTTP integration tests with fake resolver, transport, CA, PAC, marker, and Chrome adapters. Prove real byte counts and zero upstream calls on failure.
- Add browser editor/extension journeys using shipped browser artifacts, not source doubles.
- Add separate live command/gate for capable macOS evidence. Must require explicit environment flag and fail when prerequisites missing rather than silently passing. Gate requires: dedicated Chrome profile, explicit extension ID, installed native host manifest, trusted device-local X.509 CA, no controlling proxy/PAC/extension/enterprise collision, non-incognito Chrome. Must prove: native messaging, PAC routing, trusted TLS, HTTPS POST/XHR transformation, global winner selection, credential preservation, pre-upstream failure blocking, stop teardown.
- Linux and Windows must provide either equivalent injected-adapter evidence or explicit offline/capability-negative evidence. Do not claim capable live support from Linux unit tests.

**Covers:** AC-005, AC-007, AC-008, AC-011 through AC-029, AC-030

### Task 12: Documentation, Review, and Workflow Evidence

**Depends on:** Task 11

**Files:**
- `README.md`
- `docs/architecture.md`
- `docs/f17-workflow.md`
- Affected F14/F15/F16 documentation
- This plan

**Changes:**
- Synchronize package boundaries, F14/F15/F16 repair decisions, explicit identity/trust setup, offline limitations, live-platform requirements, marker behavior, status semantics, and rollback behavior.
- Update architecture status only after implementation and verification.
- Record exact model/tier, tests-first red run, verification commands, capability evidence, review rounds, residual risks, and release state in `docs/f17-workflow.md`.
- Perform fresh-context review with maximum three rounds. Requirement or API findings return to specification/architecture; coverage findings return to tests; implementation findings return to code. Rerun canonical validation after every fix.

**Covers:** AC-005, AC-024, AC-028, AC-030

## Acceptance-Criterion Matrix

| Acceptance criteria | Primary tasks |
|---|---|
| AC-001 through AC-003 | T1, T2, T9, T10 |
| AC-004 | T2, T9, T10; requires dry-run contract decision |
| AC-005 | T1, T2, T3, T4, T9, T10, T11 |
| AC-006 through AC-009 | T5, T6, T9 |
| AC-010 through AC-015 | T4, T6, T9 |
| AC-016 through AC-023 | T7, T8 |
| AC-024 | T5 |
| AC-025 through AC-027 | T3, T9, T10 |
| AC-028 | T1 through T11 |
| AC-029 | T8, T9, T11 |
| AC-030 | T11, T12 |
| AC-031 | T9, T11 |

## Integration and E2E Gates

1. **Offline gate:** schema, compiler, selector, editor, CLI, policy, framing, transform, target, and raw-wire tests pass without network, native messaging, CA, proxy, or target access.

2. **Capability-negative gate:** Linux/Windows default adapters report deterministic `unsupported`; no PAC, trust, provider, socket, or certificate side effects occur.

3. **Injected-provider gate:** fake Chrome, PAC, marker, resolver, transport, TLS, and CA adapters prove transactional lifecycle, global arbitration, rollback, and zero upstream calls.

4. **Browser artifact gate:** Playwright loads emitted editor/extension artifacts and verifies request-body controls, detached drafts, accessibility, and no Node leakage.

5. **macOS live gate:** dedicated capable runner proves AC-029 with real Chrome native messaging, PAC, trusted TLS, HTTPS POST/XHR, credentials, failure blocking, winner selection, and stop cleanup.

6. **Packaged-install gate:** native host manifest, executable path, extension ID, host origin, trust material, and extension package are tested together. Missing prerequisites must fail or report explicit capability-negative status.

## Generated and Local-Only Artifacts

Do not commit: `node_modules/`, `packages/*/dist/`, `build-manifest.json`, coverage, Playwright reports/results, browser binaries, caches, environment files, secrets, native host runtime state, CA keys/certificates, PAC snapshots, markers, traffic captures, request bodies, response bodies, or credentials.

Keep `pnpm-lock.yaml` unchanged because no new dependency is approved. Change only with explicit dependency approval.

## Rollback Strategy

- No schema-version migration required. Existing projects without F17 fields remain valid. Older consumers may reject F17 fields but must not silently discard them.
- Runtime rollback: explicit stop, stop acceptance, invalidate policy/capabilities/pending work, remove only Rogatio-owned markers/PAC, restore PAC only when ownership and prior value still match, stop provider, retain external settings.
- Do not automatically remove F16 trust artifacts during code rollback. `untrust` and `uninstall` remain explicit user actions.

> Superseded by: feat/collapse-runtime-uninstall-and-untrust
- Code rollback: revert of F17 source, tests, build/validation, and documentation changes. Do not delete files, worktrees, trust artifacts, or generated output without required prompt and authorization.

## Canonical Verification

Run in order:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:browser
pnpm validate
```

Also run focused F17 unit/integration tests, explicit macOS live gate when capable, `git diff --check`, and final staged/unstaged/tracked/untracked audit. Record exact results in `docs/f17-workflow.md`.

## Blockers and Assumptions

**Blockers (must resolve before dependent tasks):**

1. **Marker correlation API:** Current MV3 metadata observation cannot dynamically inject per-request marker through non-blocking listener, and DNR session rules do not match `requestId`. Approved marker flow uses static DNR markers. AC-015 and AC-029 cannot claim exact initiator authority without this documented limitation.

2. **Extension identity and packaging:** Current manifest/build has no explicit stable extension ID, Chrome key strategy, native-host install path, or executable packaging contract. Select these before implementing AC-009 and AC-029.

3. **X.509 platform adapter:** F16 currently has SPKI/key material only. Spec does not define exact macOS certificate-generation, leaf-certificate, trust-query, or fixed-tool paths/arguments. Do not claim live TLS until this adapter contract is approved and implemented.

4. **Policy contract contradiction:** `RequestBodyPolicyV1.operations` typed as complete `RogatioOperation[]`, but architecture forbids mock payloads/file contents; only `RequestBodyOperation` explicitly carries `sourceOrder`; policy limits absent from shown public type. Resolve sanitized operation shape, source-order representation, and limit encoding in Task 6.

5. **F12 dry-run contract:** F12 accepts `MatcherOperation[]` and has no winner field or target/initiator/phase context, while F17 requires shared arbitration in dry-run. Approve additive `dry-run` contract or explicitly limit F17 dry-run evidence to compiler/CLI selector checks.

**Assumptions:**
- F17 uses separate `f17-v1` protocol, exact-origin PAC matching, compiler-array index for legacy source order, no new dependencies, and no live-support claim from current Linux environment.