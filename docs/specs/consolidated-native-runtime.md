---
title: Consolidated Native Runtime
feature: consolidated-native-runtime
replaces: f6-runtime-foundation, f13-mock-rules, f14-macos-runtime
status: DRAFT — pending Stage 4 approval
---

# Specification: Consolidated Native Runtime

## 1. Problem and goals

The current architecture uses three separate runtime processes:
- F6 standalone Node HTTP server (`packages/runtime/src/server.ts`) for pairing/auth (`/v1/pair`, `/v1/authorize`) and mock serving (`/v1/connection`, `/mock/<token>`).
- F13 mock rules served by the F6 server.
- F14 native-messaging host (`packages/runtime/src/lifecycle.ts`, `interception.ts`, `envelope.ts`) for TLS proxy/interception, body-confidentiality, and independent authority revalidation, with a capability gate (`unsupported` when CA/PAC adapter absent).

This creates complexity: two protocols (HTTP + stdio envelope), separate lifecycle controllers, and different security models. The CLI (`packages/cli/src/commands/runtime.ts`) starts the F6 server; the extension (`packages/extension/src/service-worker.ts`) tracks separate `MockRuntimePhase` and `NativeRuntimePhase`.

**Goals:**
- Consolidate all runtime behavior into a single native host using ONLY stdio native-messaging (`f14-v1` extended).
- Eliminate HTTP endpoints entirely.
- Convert pairing/auth to envelope messages (reusing F6 capability + preset digest).
- Deliver mock responses through the envelope (`mockBody` base64, max 64KB).
- Remove the F14 capability gate (`unsupported`); native host activates unconditionally.
- Delete the CLI runtime server; CLI limited to editor/config/setup.
- Merge extension service-worker phases (`MockRuntimePhase` + `NativeRuntimePhase` → single `NativeRuntimePhase`).

**Non-goals:**
- Changing the schema package (`packages/schema/`).
- Changing the compiler (`packages/compiler/`).
- Changing the browser core library beyond runtime-related interfaces.
- Changing the docs-site build or design system.
- Introducing cloud/telemetry features (security model remains local-first).

## 2. Scope

**In scope:**
- `packages/runtime/src/` (envelope, lifecycle, interception, trust, native-framing, types, index).
- `packages/cli/src/commands/runtime.ts` (delete server functionality).
- `packages/cli/src/index.ts` (remove runtime server from CLI entry if needed).
- `packages/extension/src/service-worker.ts` (merge phases, update native-runtime commands).
- `packages/extension/src/native-session.ts` (extend for pairing/auth/mock).
- `packages/extension/src/mock-runtime.ts` (delete or integrate into native session).
- `packages/extension/src/protocol.ts` (update for new envelope message types if needed).
- `docs/specs/consolidated-native-runtime.md` (this spec).
- `docs/plans/consolidated-native-runtime.md` (implementation plan).
- `docs/architecture.md` (update architecture note).
- `docs/guides/runtime.md` and `docs/reference/security.md` (update documentation).

**Explicit non-goals (preserved from F6/F13/F14 specs):**
- No hosted/cloud runtime.
- No telemetry or remote sync.
- No changes to the `.rogatio.json` project format (though native host consumes it for pairing/auth/mock).
- No changes to the browser-core `ProjectRepository` or storage interfaces outside runtime-related updates.

## 3. Actors, entry points, environments

**Actors:**
- User (editor/config/setup via CLI; grants permissions via browser extension).
- Browser extension (service-worker, native-session, protocol parser).
- CLI (`rogatio` command: editor/config/setup only after this change).
- Native host process (started by extension or thin launcher; communicates via stdio native messaging).
- Device-local CA / PAC adapter (used unconditionally; no `unsupported` gate).

**Supported environments:**
- macOS (reference platform for native messaging, CA, PAC — remains reference).
- Linux, Windows (activate when CA/PAC capabilities present — but now unconditional, so host starts regardless; TLS proxy behavior depends on adapter availability, not activation gate).

**Entry points:**
- CLI: `rogatio` (editor/config/setup); no `runtime` subcommand for server start.
- Extension: `startNativeSession` (native messaging), `stopNativeSession`.
- Native host: stdio native messaging port (managed by extension/native messaging host).

## 4. Functional requirements

### REQ-001 — Native host activates unconditionally
The native host process starts via native messaging without checking adapter capability. There is no `unsupported` state tied to CA/PAC adapter absence. The host runs on all platforms where native messaging is available.

### REQ-002 — Protocol uses ONLY stdio native-messaging envelope
All communication uses the `f14-v1` envelope format (`packages/runtime/src/envelope.ts`, `native-framing.ts`). There are no HTTP endpoints (delete `packages/runtime/src/server.ts`). The envelope uses 4-byte length prefix + JSON.

### REQ-003 — Envelope message types extended
New message types added to `EnvelopeMessageType`:
- `pair.request`: pairing handshake initiation.
- `pair.response`: pairing handshake result.
- `authorize.request`: authorization request (reuses capability + preset digest from F6).
- `authorize.response`: authorization decision.
- `mock.connect`: mock connection info request.
- `mock.request`: mock response request (with token reference).
- `mock.response`: mock response delivery (with `mockBody` base64).

Existing types preserved: `runtime.start`, `runtime.stop`, `runtime.status`, `authority.grant`, `authority.revoke`, `transform.request`, `transform.result`.

### REQ-004 — Pairing/auth handshake via envelope
Pairing/auth reuses the F6 mechanism (`packages/runtime/src/server.ts`: `pairCapability`, `authorizeExact`):
- Random capability token generated by host.
- Preset digest (`sha256:${string}`) from canonical `.rogatio.json`.
- Authorization checks rule existence, URL regex match, origin membership, method, resource type, initiator scope.
- Denied authorization triggers no interception (same security boundary as F6/F14).

### REQ-005 — Mock serving via envelope
Mock responses delivered through `mock.response` envelope message:
- Field name: `mockBody`.
- Encoding: base64-encoded string.
- Max size: `ENVELOPE_MAX_BYTES` (`64 * 1024`) for the entire envelope; mock body portion must not exceed a reasonable subset (e.g., 32KB for body, rest for headers/metadata) — exact limit to be defined in implementation but bounded by 64KB total.
- Mock token (`string`) references the enabled mock operation (`ruleId`).
- Mock URL resolution (`/mock/<token>`) no longer exists; extension uses `mock.connect` to retrieve token mappings and `mock.request` to request responses.

### REQ-006 — Mock connection info via envelope
`mock.connect` response provides connection metadata (protocol version, preset digest, enabled mock tokens mapped by `ruleId`). This replaces `/v1/connection`.

### REQ-007 — Mock phase removed; native phase unified
The extension service-worker (`service-worker.ts`) removes separate `MockRuntimePhase`. All runtime state tracked as a single `NativeRuntimePhase` (`stopped`, `starting`, `running`, `stopping`). Mock operations (`mock`) are treated as part of native session state, not a separate connection check.

### REQ-008 — CLI runtime server deleted
`packages/cli/src/commands/runtime.ts` no longer starts/stops an HTTP server. `packages/runtime/src/server.ts`, `proxy.ts` deleted. CLI retains only editor/config/setup functionality.

### REQ-009 — Native messaging manifest and CA trust preserved
`packages/runtime/src/trust.ts`: `createRequestBodyTrustController`, `generateNativeMessagingManifest` preserved (adapted for unconditional activation). Device-local CA install/uninstall/trust/untrust/status continues to work; no `unsupported` state from adapter absence.

> Superseded by: feat/collapse-runtime-uninstall-and-untrust

### REQ-010 — Authority revalidation preserved and unified
`packages/runtime/src/interception.ts`: `revalidateAuthority` applies to all transforms (mock, body, header, redirect, query). No separate authorization mechanism for mock vs body vs header.

### REQ-011 — Body confidentiality preserved
For non-mock transforms: envelope carries bounded metadata and transform instructions, never body bytes, credentials, sensitive headers, or file contents. For mock responses: `mockBody` delivers response content (base64) through envelope; body is processed in-process only; never persisted, logged, exported, or transferred outside native messaging except through the envelope response.

### REQ-012 — Envelope size limits preserved
`ENVELOPE_MAX_BYTES` (`64 * 1024`) maintained. Mock response body plus headers/metadata must fit within this limit.

### REQ-013 — Extension interface updated
`packages/extension/src/service-worker.ts`: `nativeRuntime` interface (`start`, `stop`, `status`, `sendPolicy`) preserved but extended to handle pairing/auth/mock. `mockRuntime` interface removed (or integrated). `ExtensionApplicationOptions` updated accordingly.

## 5. Acceptance criteria

### AC-001 — Native host starts unconditionally
Given: extension calls `startNativeSession` (`packages/extension/src/native-session.ts`).
When: no CA/PAC adapter present (simulated by removing adapter).
Then: native host reports `started` (not `unsupported`); no error from adapter absence; TLS proxy may or may not activate (depends on adapter availability), but host itself runs.

### AC-002 — Pairing/auth handshake works via envelope
Given: extension initiates pairing (`pair.request`).
When: pairing succeeds (capability token generated) and authorization requested with preset digest.
Then: `authorize.response` returns allowed (with `groupId`, `ruleId`, `operation`) or denied (with `reason` from `AuthorityDenyReason` set: `project-invalid`, `operation-unknown`, `project-inconsistent`, `url-mismatch`, `target-unauthorized`, `initiator-unauthorized`, `method-mismatch`, `resource-type-unauthorized`).

### AC-003 — Mock response delivered through envelope
Given: enabled mock operation (`kind === "mock"`), granted origins, and mock token present.
When: extension requests mock response (`mock.request` with token).
Then: `mock.response` delivered with base64 `mockBody`; response headers included in envelope; total size ≤ `ENVELOPE_MAX_BYTES`.

### AC-004 — Mock connection info available
Given: native host running.
When: extension requests `mock.connect`.
Then: response includes `protocol: "v1"`, `port` (optional — may become irrelevant without HTTP), `presetDigest`, `mocks` array (`{ruleId, token}`).

### AC-005 — CLI runtime server removed
Given: `packages/cli/src/commands/runtime.ts` examined.
Then: no `createRuntimeServer`, no `/v1/pair`, `/v1/authorize`, `/v1/connection`, `/mock/<token>` code; no `serveMock`; CLI `runtime` subcommand either removed or reduced to setup/config only.

### AC-006 — Extension service-worker unified
Given: `service-worker.ts` inspected.
Then: `MockRuntimePhase` and separate `check-mock-runtime` logic removed; `NativeRuntimePhase` tracks all runtime state including mock connections; `operationStatuses` returns `"needs proxy"` only when native host is not `started` (not when mock is disconnected separately).

### AC-007 — Security boundaries unified
Given: any transformation request.
Then: `revalidateAuthority` validates rule existence, URL regex, origins, method, resource type, initiator scope, target origin, grant authority — same as F14 `authority.grant/revoke` model, applied uniformly.

## 6. API, CLI, file format, compatibility changes

**CLI changes:**
- Remove `packages/cli/src/commands/runtime.ts` server start/stop/status functionality.
- Keep CLI entry (`packages/cli/src/index.ts`) for editor/config/setup only (if any setup requires native host installation, keep a thin install/uninstall command).
- No new CLI commands required beyond setup.

**Runtime package changes (`packages/runtime/src/`):**
- `types.ts`: extend `EnvelopeMessageType` (`pair.request`, `pair.response`, `authorize.request`, `authorize.response`, `mock.connect`, `mock.request`, `mock.response`).
- `envelope.ts`: extend `containsBodyKey` to distinguish mock response bodies (`mockBody` allowed) from transform bodies (forbidden); or redesign body policy.
- `lifecycle.ts`: extend `createNativeRuntimeController` with pairing/auth/mock lifecycle; remove `unsupported` capability gate.
- `interception.ts`: keep `startInterception`, `revalidateAuthority`; make unconditional.
- `trust.ts`: keep CA/trust management; apply unconditionally.
- `native-framing.ts`: keep stdio encoding; support new message types.
- `index.ts`: consolidate exports.

**Extension changes (`packages/extension/src/`):**
- `service-worker.ts`: merge phases, update `operationStatuses`, update `handleRequest`.
- `native-session.ts`: extend `NativeRuntimeConfig` and `startNativeSession` for pairing/auth/mock.
- `mock-runtime.ts`: delete or repurpose.
- `protocol.ts`: add new message parsing if needed.

**Documentation changes:**
- Replace `docs/specs/f6-runtime-foundation.md`, `f13-mock-rules.md`, `f14-macos-runtime.md` with this spec.
- Update `docs/architecture.md`.
- Update `docs/guides/runtime.md` (remove separate mock/body server description).
- Update `docs/reference/security.md` (update body confidentiality description, remove separate mock server description).

**Migration/rollout:**
- Existing `.rogatio.json` files remain compatible (no schema change).
- Existing native messaging host registrations (`manifest.json`) may need update if message format changes; but since `f14-v1` protocol preserved with extensions, backward compatibility depends on host version negotiation (to be handled by extension checking host version).
- Since this replaces specs, no backward compatibility required with old F6 server or F13 mock server; these are removed.

## 7. Security, privacy, performance, accessibility, operational requirements

**Security:**
- Pairing/auth uses capability + preset digest (same as F6 `authorizeExact`).
- No credentials, sensitive headers, or body bytes transmitted through native messaging for non-mock transforms (`containsBodyKey` preserved).
- Mock response body (`mockBody`) transmitted through envelope as base64; never persisted or exported outside native process.
- Authority revalidation (`revalidateAuthority`) applies to all requests.
- No hosted/cloud endpoints; no telemetry.

**Privacy:**
- Local-first: no cloud sync, no remote endpoints.
- Observed bodies processed in-process only; never logged, persisted, exported.
- No user accounts.

**Performance:**
- Single native process reduces process overhead (vs separate F6 server + F14 host).
- Stdio native messaging lower overhead than HTTP loopback for control messages.
- Envelope max 64KB bounds memory usage.

**Accessibility:**
- CLI and extension behavior unchanged from user perspective (except removal of separate mock server process, which is invisible).
- No new UI elements required.

**Operational:**
- Native host starts unconditionally; no `unsupported` state to diagnose.
- Extension service-worker simplified (single phase tracking).
- CLI reduced; less operational surface.

## 8. Migration, rollout, backward-compatibility

**Migration:**
- No data migration (no persistent runtime state outside native messaging session).
- Existing `.rogatio.json` files fully compatible.
- Native messaging manifest (`packages/runtime/src/trust.ts`: `generateNativeMessagingManifest`) may need version update if message format changes significantly; but since protocol is `v1` extended, manifest version may stay `v1` with capability negotiation.

**Rollout:**
- Feature branch (`feature/consolidated-native-runtime`) isolated in worktree (`/home/drmaas/.local/share/opencode/worktree/rogatio/consolidated-native-runtime`).
- After spec approval (Stage 4), implementation plan, tests, implementation, verification, review, documentation, release actions follow.
- Merge to `main` after user authorization.

**Backward-compatibility:**
- Old F6 server (`packages/runtime/src/server.ts`) removed; no backward compatibility required (replaced by native envelope).
- Old F13 mock server (`packages/extension/src/mock-runtime.ts`) removed; replaced by native envelope mock delivery.
- Old F14 native messaging (`f14-v1`) preserved with extensions; backward compatible at protocol level if new message types ignored by older hosts (but since host and extension updated together, this is a paired deployment).

## 9. Open questions and assumptions

**Assumptions (labeled A-E — confirmed with user before drafting spec):**
- **A** Protocol: ONLY stdio native-messaging envelope (`f14-v1` extended), NO HTTP endpoints. Confirmed.
- **B** Pair/auth: converted to envelope message types (`pair.request`/`response`, `authorize.request`/`response`). Confirmed.
- **C** Mock serving: delivered through envelope; mock response body allowed via base64 `mockBody` field (max 64KB total envelope). Confirmed.
- **D** Capability gate: removed — native host unconditional (no `unsupported` from adapter absence). Confirmed.
- **E** CLI: delete runtime server (`packages/cli/src/commands/runtime.ts`, `packages/runtime/src/server.ts`, `proxy.ts`). Confirmed.

**Open questions:**
- Should the native messaging manifest (`generateNativeMessagingManifest`) update its version field (`v1`) to indicate extended protocol, or keep `v1` and rely on message type negotiation?
- Should `packages/runtime/src/index.ts` export a consolidated interface (`createConsolidatedNativeHost`) or keep separate interfaces (`createRuntimeServer` deleted, `createNativeRuntimeController` extended)?
- Should extension service-worker remove `MockRuntimePhase` entirely or rename it to part of `NativeRuntimePhase`?
- Exact base64 encoding for `mockBody`: standard base64 string in JSON (`string`), or binary array (`number[]`)? Standard base64 string preferred.
- Should mock response headers be included in envelope metadata (`headers`) or embedded in `mockBody`? Separate `headers` field preferred (same as F6 mock config).

---
