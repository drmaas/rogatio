# AI provider and model metadata on the management page AI card

> Status: frozen 2026-09-27
> Issue: drmaas/rogatio#241. Audience: hybrid. Approved at the Stage 4 gate 2026-09-27.

## 1. Problem statement and goals

The management page sidebar AI card can only say "AI: Ready", "AI: needs runtime", or "AI: Not
configured". Operators cannot see **which provider and model** the native runtime will use.
Provider configuration never crosses the host boundary at all, and the existing capability
check is not a foundation to build on:

- `check-ai-support` is extension-internal; its response is synthesized by the service worker
  from a boolean, not reported by the native host.
- The boolean comes from a ping probe that sends a real `ai.complete` with `model: "test"`, so
  a misbehaving provider makes a refresh slow (HTTP-level retry with backoff) and the
  configured model is never exercised by the check (`meta.model` wins in `lifecycle.ts`).
- Provider configuration is read once at host launch (`readProviderConfig()` in the CLI
  `runtime` command) and captured for the process lifetime, so `rogatio ai setup` has no
  visible effect until the host restarts.

**Goal:** the AI card shows the configured provider URL and model, reported by the native
host, with a status check that touches no network and never exposes the API key.

## 2. Scope and non-goals

**Scope:** a new `ai.status` host envelope and its registries; host-side provider-config
refresh; replacing the ping probe with a metadata-only check; AI card provider/model display;
graceful "not reported" degradation against old hosts; tests (unit, integration, browser) and
docs.

**Non-goals:**

- No AI configuration editing UI, file pickers, or settings surface.
- No `ai` field in the project schema; `.rogatio.json` carries no AI metadata (see REQ-009).
- No AI display in the popup.
- No live readiness probing ("does a completion actually work") in the status check.
- No change to `ai.complete` / `ai.stream.chunk` request/response semantics beyond consuming
  the refreshed client.
- No schema (`packages/schema`) changes and no project-file migration.

## 3. Actors, entry points, supported environments

- **Operator** — opens the extension management page (Workspace) sidebar AI card.
- **Chrome extension (MV3)** — service worker + management page, same bundle, same release.
- **Native host** — `rogatio runtime host`, Node ESM, macOS native messaging. Config file
  `~/.config/rogatio/provider.json` (platform equivalent) `{ providerUrl, model, apiKey }`,
  written by `rogatio ai setup`.
- **Environments:** Chrome for Testing journeys (`test/browser/`), Node unit/integration
  tests. Old host binaries already installed on user machines are in scope for compatibility.

## 4. Functional requirements

- **REQ-001** The native host answers a new `ai.status` envelope with provider metadata
  `{ configured, providerUrl?, model? }`. `configured` is true iff a usable provider config
  (providerUrl, model, apiKey) exists. The response never contains the API key or any key-like
  field.
- **REQ-002** The `ai.status` response is constructed from a dedicated pick-type at the host
  boundary. The internal `AIProviderConfig` object (which includes `apiKey`) is never
  serialized into an envelope.
- **REQ-003** The host re-reads `provider.json` when handling `ai.status`, `ai.complete`, and
  `ai.stream.chunk`, and rebuilds (or clears) its AI client when the config content changed.
  Provider configuration is therefore effective without a host restart; the card and the
  client can never disagree about which config is in force.
- **REQ-004** The extension's AI capability check becomes metadata-only: it sends `ai.status`
  and issues no completion request and no network traffic to the provider.
- **REQ-005** The AI card shows provider URL and model when the host reports `configured`:
  status line "AI: Configured", plus provider and model lines exposing `data-ai-provider` and
  `data-ai-model` attributes. The rendered model is the effective default model (the model
  used when a request supplies none).
- **REQ-006** When the host reports `configured: false`, the card shows "AI: Not configured"
  and renders no provider/model lines.
- **REQ-007** When the host does not report (old host rejecting the unknown envelope type, or
  any send failure), the card shows an unobtrusive "AI: not reported" state — never an error
  card, never a broken card, and the rest of the native session keeps working.
- **REQ-008** The "Create using AI" affordance gates on reported configuration (metadata),
  replacing "a probe completion did not fail". Approved trade-off (D3): a broken key or URL
  shows Configured and enables the affordance; the failure surfaces on actual use through the
  existing stable error paths (`extension.ai-generation-failed`, `ai.error` envelopes).
- **REQ-009** The project schema gains no `ai` field. Host config is the single source of
  truth for provider metadata (decision D4).
- **REQ-010** The AI card never renders the API key, and no test fixture or snapshot contains
  a real key. Status and diagnostic strings remain stable and independent of third-party
  provider wording.

## 5. Acceptance criteria

- **AC-001** *(REQ-001, REQ-002)* Host unit test: `ai.status` with a full provider.json returns
  `{ configured: true, providerUrl, model }` matching the file; with no config file returns
  `{ configured: false }` and no `providerUrl`/`model` keys.
- **AC-002** *(REQ-001, REQ-002 — adversarial)* The serialized `ai.status` envelope, scanned
  recursively, contains no `apiKey` (or case/separator variant) key and no value equal to the
  configured key, on every response path including malformed-config paths.
- **AC-003** *(REQ-003)* Host unit test: rewriting provider.json (as `rogatio ai setup` does)
  without restarting the host is reflected by the next `ai.status`, and a subsequent
  `ai.complete` uses the new model; deleting the file yields `configured: false` and
  `ai.not-configured` on the next completion.
- **AC-004** *(REQ-004)* Extension unit test: the check sends exactly one `ai.status`
  envelope and zero `ai.complete` envelopes, on success and on failure paths.
- **AC-005** *(REQ-007 — adversarial, A1)* Integration/browser test with a host-faithful stub
  that rejects unknown envelope types the way `envelope.ts` does (not a null-returning mock):
  the card shows "AI: not reported", no error card appears, and other native-session traffic
  still works after the failed check.
- **AC-006** *(REQ-001, REQ-006)* Extension unit test: `check-ai-support` response carries the
  host-reported providerUrl/model additively; reported unconfigured maps to the Not configured
  card state.
- **AC-007** *(REQ-005 — flips sidebar-cards.test.ts:266)* Browser test: with a host reporting
  configured metadata, the AI card renders `[data-ai-provider]` and `[data-ai-model]` with the
  reported values; with no report they have count 0 and the card degrades per REQ-007.
- **AC-008** *(REQ-010 — adversarial)* Browser test: the management page DOM contains no
  element whose text or attribute equals the API key, in any card state.
- **AC-009** *(REQ-005)* The model shown equals the model used when a request supplies none
  (host config model); extension call paths that send `model: ""` are covered by a unit test
  pinning the fallback chain.
- **AC-010** *(REQ-004, REQ-007)* The "needs runtime" state keeps precedence when the native
  runtime phase is not `started`, and the check is not attempted in that state (no envelope
  sent).
- **AC-011** Regression: `generate-project` and `ai-assist` flows pass unchanged, including
  the envelope size probe and stable error codes.

## 6. API, CLI, UI, file-format, compatibility changes

- **Wire protocol (additive):** new message type `ai.status` added to all three registries —
  `packages/runtime/src/types.ts` `EnvelopeMessageType`, `packages/runtime/src/envelope.ts`
  `ENVELOPE_MESSAGE_TYPES`, `packages/runtime/src/native-framing.ts` enum. Request metadata:
  empty object. Response metadata: `{ configured: boolean, providerUrl?: string, model?: string }`.
  Envelope keeps `protocol: "v1"`: a new message type is an additive v1 change.
- **Extension-internal protocol (additive):** `check-ai-support` response grows optional
  `providerUrl`, `model`, `reported` fields alongside `supported`. Page and service worker
  ship in one bundle, so they change in lockstep.
- **UI:** AI card gains provider and model lines (`data-ai-provider`, `data-ai-model`); status
  wording "Ready" becomes "Configured"; new muted "not reported" state. F22 design system
  tokens only; forced-colors entry extended like existing blocks.
- **CLI:** none. `rogatio ai setup|ls|show` unchanged.
- **File formats:** none. provider.json and .rogatio.json are unchanged.

## 7. Security, privacy, performance, accessibility, operational

- **Security (REQ-001/002/010):** the API key never crosses the host boundary and never
  reaches the DOM. The host builds the response from a pick-type; an adversarial test asserts
  absence end-to-end. Provider.json is parsed defensively (existing `ai-config.ts` validation
  stands; malformed input yields `configured: false`, never a crash or partial metadata).
- **Performance:** the status check performs at most one small local file read and zero
  network I/O (REQ-004). Refresh cost per AI call is one stat/read of a tiny file, negligible
  against a completion. The page refresh can no longer be slowed by a bad provider.
- **Accessibility:** provider/model lines are plain text nodes in the existing card; status
  remains a single readable line; the new state keeps the existing tone-class + status-dot
  pattern and a forced-colors entry.
- **Stability:** no new user-facing error strings depend on third-party wording; "not
  reported" is a stable, test-pinned phrase.

## 8. Migration, rollout, backward compatibility

- **New extension + old host:** the old host's envelope parser rejects the unknown `ai.status`
  type; the extension treats that as "not reported" (REQ-007, AC-005). No session damage, no
  error card. This is the primary compatibility case (already-installed hosts).
- **Old extension + new host:** the old extension never sends `ai.status`; every existing
  envelope behaves identically. The host-side config refresh changes when config takes effect
  (immediately instead of at restart) but no envelope shape or code changes — a strict
  improvement with no compatibility surface.
- **Rollout:** extension and host ship in the same release; the fallback covers hosts that
  have not been reinstalled yet. No data migration. No feature flag.
- **Rollback:** revert the commit; the wire change is additive so an older extension against a
  newer host remains safe in either direction.
- **Supersession:** frozen `docs/specs/ai-integration.md` pinned the three-type AI registry
  and the probe-based check; it receives a `> Superseded by:` footer pointing at this spec
  (Stage 10).

## 9. Open questions and assumptions

Resolved at Stage 1 (decisions D1–D4 in the workflow log): wire path (`ai.status` envelope),
staleness (re-read + refresh client), probe (metadata-only), project-file field (not added).
No open questions remain. Assumptions: `readProviderConfig()` path resolution is reusable from
the host runtime package (verified: `ai-config.ts` lives in `packages/runtime`); the
`check-ai-support` command name and `supported` field stay (additive shape change only).

## Design summary

(Canonical boundary notes land in `docs/architecture.md` at Stage 10, with the code, so living
docs never describe unshipped behavior.)

- **Host (`packages/runtime`):** `lifecycle.ts` gains an `ai.status` case returning the
  pick-type metadata; a small `refreshAIProviderConfig()` step re-reads provider.json and
  rebuilds the client, invoked by the `ai.status`, `ai.complete`, `ai.stream.chunk` cases. The
  three registry lists gain `ai.status`.
- **Extension (`packages/extension`):** `native-session.ts` replaces `checkAISupport`'s probe
  with `requestAIStatus()` (new `ai.status` request, null on any failure — the single "not
  reported" signal). `service-worker.ts` `check-ai-support` passes host metadata through
  instead of synthesizing a boolean. `extension-page-entry.ts` renders the provider/model
  lines and the three card states. `protocol.ts` response shape grows optional fields.
- **Tests:** runtime unit (AC-001/002/003), extension unit (AC-004/006/009/010), browser
  journey with host-faithful stub (AC-005/007/008), regression suite (AC-011), and the
  flipped sidebar-cards assertion.
