# Implementation plan — ai-provider-metadata (issue #241)

> Status: frozen 2026-09-27. Audience: hybrid. (Approved plan; spec gate passed 2026-09-27.)
> Ordered tasks; tests-first per task. AC/REQ ids refer to `spec.md`.

## T1 — Host: add `ai.status` to the three envelope registries (foundational)

- **Files:** `packages/runtime/src/types.ts` (`EnvelopeMessageType` union + `AIStatusRequest` /
  `AIStatusResponse` types), `packages/runtime/src/envelope.ts`
  (`ENVELOPE_MESSAGE_TYPES`), `packages/runtime/src/native-framing.ts` (enum).
- **Behavior:** `ai.status` is an accepted additive message type. Response metadata shape:
  `{ configured: boolean, providerUrl?: string, model?: string }` — optional fields omitted
  (not `undefined`-valued) when unconfigured. Request metadata: empty object.
- **Covers:** REQ-001.
- **Tests first:** envelope/framing unit tests — parse accepts `ai.status`; response round-trips;
  an `ai.status` metadata carrying a `apiKey` key is still body-key-safe (the generic body scan
  covers `body|requestBody|responseBody` only — the pick-type is the real defense, see T2).
- **Verify:** `pnpm --filter @rogatio/runtime test`.

## T2 — Host: config refresh + pick-type boundary (foundational)

- **Files:** `packages/runtime/src/lifecycle.ts`, small helper in
  `packages/runtime/src/ai-config.ts` if needed (reuse `readProviderConfig()` /
  `getProviderConfigPath()` — already runtime-owned, exported from `src/index.ts:4`).
- **Behavior:**
  - `refreshAIProviderConfig()`: re-read provider.json; when content differs from the config
    in force, rebuild (or clear) `aiClient`. Invoked at the start of the `ai.status`,
    `ai.complete`, `ai.stream.chunk` cases. Malformed config → `configured: false`, never a
    throw (REQ-007 honesty + REQ-010 stability).
  - `ai.status` case returns metadata from a **pick-type** `{configured, providerUrl, model}`;
    `AIProviderConfig` (contains `apiKey`) is never spread into an envelope (REQ-002).
  - Existing `meta.model || config.model` fallback chain is unchanged (REQ-005, AC-009).
- **Covers:** REQ-001, REQ-002, REQ-003.
- **Tests first (AC-001/002/003):** temp-dir config fixtures (pattern in
  `packages/runtime/test/ai-config.test.ts`):
  - full config → `{configured:true, providerUrl, model}`; no file → `{configured:false}` with
    no provider/model keys;
  - recursive key scan + value scan of the serialized envelope finds no `apiKey`-named key and
    no key value on **every** response path (configured, unconfigured, malformed, partial);
  - rewrite config without restart → next `ai.status` reflects it and the next `ai.complete`
    uses the new model; delete config → `configured:false` and `ai.not-configured` next call.
- **Verify:** `pnpm --filter @rogatio/runtime test`.

## T3 — Extension: metadata-only check + SW passthrough

- **Files:** `packages/extension/src/native-session.ts` (replace probe `checkAISupport` with
  `requestAIStatus()`), `packages/extension/src/protocol.ts` (`check-ai-support` response gains
  optional `providerUrl`, `model`, `reported`), `packages/extension/src/service-worker.ts`
  (`check-ai-support` handler passes host metadata through instead of synthesizing a boolean;
  `supported` now = reported-and-configured).
- **Behavior:** the check sends exactly one `ai.status` envelope and no `ai.complete`
  (REQ-004). Any send failure / non-conforming response → `{reported: false}` = the single
  "not reported" signal (REQ-007). Gate precedence unchanged: no envelope at all when the
  native phase is not `started` (AC-010).
- **Covers:** REQ-004, REQ-006, REQ-007, REQ-008.
- **Tests first (AC-004/006/010):** extension unit tests (`packages/extension/test/`,
  pattern in `ai-generation.test.ts:204-244`): one `ai.status`, zero `ai.complete`; metadata
  passes through; unconfigured → `reported: true, supported: false`; failure → `reported:
  false`; runtime-not-started → no envelope sent.
- **Verify:** `pnpm --filter @rogatio/extension test`.

## T4 — Extension UI: card states and provider/model lines

- **Files:** `packages/extension/src/extension-page-entry.ts` (~:612-635 AI card),
  `packages/extension/src/popup.css`/`extension.css` tone classes + forced-colors block.
- **Behavior (REQ-005/006/007):** three states after "needs runtime": `Configured` (status
  line + two plain text lines `data-ai-provider` / `data-ai-model` with reported values),
  `Not configured` (no provider lines), `not reported` (muted tone, no provider lines, no
  error card). Wording "Ready" → "Configured". "Create using AI" card gates on reported
  configuration (REQ-008). Key never rendered (REQ-010).
- **Tests first (AC-007/008/010 + flip):** browser assertions in
  `test/browser/sidebar-cards.test.ts` — **replace** the `:256-267` scope-split test ("carries
  the AI status and nothing else", `[data-ai-provider]` count 0) with the new states; keep
  `data-ai-status` attribute. Unit tests for the state mapping if extracted as a pure helper.
- **Verify:** `pnpm test:browser` subset for sidebar + full unit suites.

## T5 — Browser journey: old-host fallback (integration seam)

- **Files:** `test/browser/` journey (extend `extension.test.ts` mock harness or a focused new
  file), host-faithful stub behavior: unknown envelope type rejected the way
  `packages/runtime/src/envelope.ts` rejects it (parse error, not a null).
- **Covers:** AC-005 (adversarial A1), AC-007/008 end-to-end.
- **Behavior:** new extension + old host → "AI: not reported", no error card, later
  native-session traffic unaffected.
- **Verify:** browser journey run; note Chrome-for-Testing prerequisites
  (`pnpm browser:install`).

## T6 — Regression and stability

- **Covers:** AC-009 (fallback-chain unit pin: request `model: ""` → host config model),
  AC-011 (`generate-project` / `ai-assist` suites green, size probe and stable error codes
  untouched).
- **Verify:** full `pnpm validate` (canonical; same command CI runs). Capture exact commands
  and exit codes in `workflow.md`.

## T7 — Documentation (Stage 10 material)

- `docs/architecture.md` — native host now reports AI provider metadata via `ai.status`;
  config is re-read and takes effect without host restart; the check is metadata-only.
- `packages/docs-site` extension guide / reference (AI card states), root `README.md` if the
  AI card is described there.
- `> Superseded by:` footer on frozen `docs/specs/ai-integration.md` (registry + probe claims)
  pointing at the frozen `docs/specs/ai-provider-metadata.md` (adversarial A5).
- AGENTS.md orientation line only if package-role text shifts (it likely does not).

## Ordering, dependencies, rollback

- T1 → T2 (host is self-contained and testable before the extension moves) → T3 → T4 → T5 →
  T6 → T7. T5 depends on T3/T4. No migrations, no feature flags, no generated files.
- **Rollback:** revert the feature commit(s). The wire change is additive in both directions,
  so any mixed extension/host pairing remains safe (spec §8).
