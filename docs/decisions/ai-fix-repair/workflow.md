# AI fix-kind repair — workflow log

Worktree `~/Projects/github/drmaas/rogatio-ai-fix-repair`, branch `feature/ai-fix-repair`, base `main` @ `50ca273`.

## Stage 0 — Setup

- [x] Worktree created (`git worktree add -b feature/ai-fix-repair … main`), `pnpm install`, `pnpm browser:install` (chrome + chromedriver 154.0.8037.57).
- Machine facts discovered: global `rogatio` on PATH (bundled `@rogatio/cli`); AI provider config exists but points at OpenAI (user switches to OpenRouter outside the agent session); native-messaging manifest installed for the main-checkout extension id `gjaniokcjjhonpefldollekeikaoghll`; no passwordless sudo (`sudo -n true` fails).
- Extension ids are path-derived; the worktree build is `mnmdiondogcadghmglncccnlfkceaahf` (sha256-nibble mapping verified against the installed manifest).

## Stage 1–3 — Repair semantics (product + unit tests)

- `packages/runtime/src/ai-assist.ts`: `repairTargetsFromDiagnostics` + `repairProposalIntoProject` (group-scoped FIFO replacement, ids kept, surplus appends); `runAIAssist` validates fix attempts against the repaired project.
- `packages/extension/src/ai-assist.ts`: browser-safe mirror of the repair mapping; `service-worker.ts` `ai-assist` fix branch validates the repaired project (other kinds keep the append gate).
- `packages/editor/src/editor.ts`: fix requests snapshot repair targets from `validateCurrent()`; `applyAIProposal` replaces the offending rules in place (ids/positions kept) and appends surplus proposal rules.
- Unit evidence: `packages/runtime/test/ai-assist.test.ts` 21 passed (repair mapping, FIFO, defensive junk handling, AC-004 convergence); `packages/extension/test/ai-assist.test.ts` 8 passed (AC-001 proposal accepted when it repairs, AC-002 non-repairing proposal rejected with `extension.ai-invalid-proposal`, generate-kind append gate unchanged); `packages/editor/test/ai-assist.test.ts` 10 passed (AC-003 in-place repair + surplus append, generate-kind unchanged). Adversarial cases covered: non-record diagnostics, out-of-range rule paths, malformed proposal rules, missing repair targets.

## Stage 4 — Live browser journeys

- `test/browser/ai-live.test.ts` (gated `AI_LIVE=1`, three `testStandalone` journeys): AC-005 Dashboard "Create using AI" (preview → saved project), AC-006 Workspace AI Assist generate (rule added, saved, live redirect works), AC-007 Workspace AI Assist fix (draft `urlRegex` broken → `aria-invalid` → fix → Apply repairs in place keeping `rule-redirect` → Save → live redirect `/old/anything` → `/new/`). Prerequisites fail fast with the exact fix command (`rogatio ai setup`, `sudo rogatio runtime install --extension-id <id>`); the suite attempts the native-host install itself only when passwordless sudo is available.

## Stage 5 — Validation

- `pnpm validate` green: format, lint, typecheck, build (18 ESM artifacts), vitest, artifact/module/boundary checks, negative fixtures, browser suite **55 passed / 7 skipped** (the 3 AI live journeys skip without `AI_LIVE=1`; body/request-body live skip without `LIVE_E2E=1`). AC-008 satisfied.

## Defects surfaced and fixed along the way

1. **Browser harness false-green risk (fixed):** `test/browser/global-setup.ts` spawned the smoke server and waited for readiness without noticing the child had died. A leaked server from an interrupted run holds port 4173 (`EADDRINUSE`), the fresh server dies instantly, readiness succeeds against the foreign server, and later tests cascade with `ERR_CONNECTION_REFUSED` (or worse, pass against stale fixtures). Setup now fails fast when the spawned server exits before ready, with a "kill the leftover smoke server" hint. Verified: full browser suite green on a clean port afterwards.
2. **CLI tests polluted the machine (fixed):** `packages/cli/test/runtime-command-gating.test.ts` and `runtime-uninstall-success.test.ts` exercised `runtime install` / `runtime uninstall` with the trust controller mocked but `node:fs/promises` real, so every test run rewrote or deleted the user's real `~/.local/share/rogatio/runtime-host` wrapper (with `process.argv[1]` = vitest's worker entry, i.e. garbage). Both now mock `node:fs/promises` like the sibling `runtime-install-success.test.ts`. Verified: `packages/cli/test` 112 passed and the real wrapper hash unchanged before/after.
3. **Wrapper content fragility (noted, out of scope):** `packages/cli/src/commands/runtime.ts` embeds `${process.execPath} ${process.argv[1] ?? "rogatio"}` in the wrapper, which is only correct when invoked as the real CLI. With (2) fixed the product path is always the CLI; a self-referential wrapper fix is a separate change.

## Stage 4–5 completion (continuation session, 2026-09-25)

The original session ended after `pnpm validate` with the live journeys (AC-005..007) written but never executed. A continuation session ran them against the user's OpenRouter provider and fixed what surfaced. Final evidence: `AI_LIVE=1 pnpm test:browser test/browser/ai-live.test.ts` — **3/3 passed twice consecutively** (AC-005 26s, AC-006 77s, AC-007 77s). AC-008 (validate green with live skipped) re-verified at the end of the continuation.

Findings and fixes, in discovery order:

1. **Provider structured-outputs gap (config-only fix, user-approved).** Every extension AI call sends `response_format: {"type":"json_object"}`; the then-configured `openrouter/free` router frequently lands on models without structured-outputs support (HTTP 400 "model does not support feature: structured-outputs"), which failed all three journeys at `extension.ai-assist-failed`/generation failure. No free model can be pinned under this account (every `:free` endpoint returns 404 "0 endpoints available matching your guardrail restrictions and data policy"); the user chose to pin a paid model rather than add a client-side fallback. `~/.config/rogatio/provider.json` now pins `google/gemini-2.5-flash-lite` (~$0.0001 per AI call), verified reliable at rule-JSON output.
2. **Provider guardrail masks IP literals in completions.** Verified by char-code dump: a prompt containing `127.0.0.1` comes back with literal `[IP_ADDRESS]` in the completion (across gemini/deepseek/mistral routes — account-level guardrail), which fails `validateProjectDetailed` ("Redirect destination must be an absolute URL" since `new URL("http://[IP_ADDRESS]:…")` throws). The journeys therefore use `http://localhost:8080` in all model-facing URLs; `localhost` passes the mask unmasked. `startValidateServer` now binds dual-stack so `localhost` (possibly resolving to ::1 first) reaches it.
3. **AC-007 journey defect: rule cards render per route.** The editor is a routes layout (`[data-desktop-route-rail]`); the journey located `[data-rule-card]` without opening the group route first and failed at the initial `fill`. Fixed by clicking the group's rail button (name taken from the loaded project).
4. **AC-005 prompt underspecified for real models.** The product's create-project system prompt carries no schema, so models returned a `{"project":{…}}` wrapper with invented rule fields (`match`, `redirect: "string"`), consistently failing validation. The journey prompt now pins the version-1 shape (keys, `type: "redirect"`, `redirect: {destination}`, `resourceTypes: ["main_frame"]`, explicit ids). Replay through the production `parseAIProposal`/`validateProjectDetailed` chain: 5/5 and 3/3 valid.
5. **Save resets group enablement (documented product behavior).** `browser-core` `buildUpdate` sets `enabledGroupIds: []` on every save (docs/architecture.md: "project creation/import/save never grants or enables anything automatically"), so after Apply+Save all rule statuses were `disabled` and `chrome.declarativeNetRequest.getDynamicRules()` was empty — the live redirect could never fire. The journeys now mirror the real user flow and re-activate the sample group after save.
6. **Editor "Saved" status is not observable in the extension.** The save adapter calls `refresh()`, which remounts the editor, so the transient `"Saved"` status vanishes before assertions poll it. The journeys instead wait for the persisted state to reflect the change (`waitForPersisted`).
7. **Journey rewrite helper escaping bug.** A JSON-text `split("https://example\\.com")` rewrite misses regex hosts because `JSON.stringify` doubles the backslash; the sample's `urlRegex` stayed on `example\.com` while origins moved to localhost, so the repaired rule never matched the navigation URL. Fixed by rewriting rule fields at the object level (like `rewriteSampleToValidateOrigin`).
8. **Model omits `groupId` on assist-generate proposals (live path).** `parseAIProposal` requires `groupId`, and the real service-worker request intermittently produced rule entries without it (`extension.ai-invalid-response`) even though identical-looking replay requests passed 10/10 — a captured content snippet (temporary failure-code instrumentation, since removed) proved the omission. The journey prompt now pins the exact reply template including `groupId`, and `sendAssistWithRetry`/`generateWithRetry` retry failed requests up to 3 times for live variance. Verified: 5/5 with `groupId` present, then two clean 3/3 live runs.

Supporting evidence harnesses (temporary esbuild-bundled probes against the real `packages/extension/src` parse/merge/repair/validate chain and the real `runtime host` framing): provider structured-outputs capability matrix, completion-masking char-code dumps, per-model proposal-shape compliance (deepseek/mistral 6/6 assist, gemini 4/4 + 5/5 generate with pinned schema), and a native-host frame replay (host returns well-formed completions; the corruption was downstream).

## Incidents

- Early file edits were routed by tooling to the main checkout instead of the worktree; they were moved over as a patch (`git apply`) and the main checkout restored to clean (duplicate edits kept in `stash@{0}` — safe to drop).
