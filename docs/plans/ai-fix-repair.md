> Status: frozen 2026-09-25

# AI fix-kind repair — plan

Worktree: `~/Projects/github/drmaas/rogatio-ai-fix-repair`, branch `feature/ai-fix-repair`, base `main` @ `50ca273`.

## Phase 1 — Repair mapping (runtime)

1. `packages/runtime/src/ai-assist.ts`: add `repairProposalIntoProject(project, diagnostics, proposal)` implementing REQ-1 (rule-path extraction `groups/<gi>/rules/<ri>`, stable order, de-dupe, group-scoped FIFO replacement keeping rule `id`). Use it in `runAIAssist` fix-attempt validation when `request.context.diagnostics` carries rule-level errors (REQ-4).
2. Tests (`packages/runtime/test/ai-assist.test.ts`): fix converges on a repaired project; targets de-dupe and keep ids; no targets → append behavior.

## Phase 2 — Extension mirror + service-worker gate

3. `packages/extension/src/ai-assist.ts`: browser-safe mirror of `repairProposalIntoProject` (same semantics, existing slim-mirror pattern).
4. `packages/extension/src/service-worker.ts`: `ai-assist` fix branch validates the repaired project; other kinds keep the append gate (REQ-2).
5. Tests (`packages/extension/test/ai-assist.test.ts`): AC-001, AC-002, and generate-kind unchanged.

## Phase 3 — Editor Apply

6. `packages/editor/src/editor.ts`: `runAIAssist` snapshots repair targets (rule ids + groups) from `validateCurrent()`; `applyAIProposal` replaces targets in place for fix requests (REQ-3), appends otherwise.
7. Tests (`packages/editor/test/ai-assist.test.ts`): AC-003; generate-kind append unchanged.

## Phase 4 — Live browser journeys

8. `test/browser/ai-live.test.ts` (gated `AI_LIVE=1`, skipped by default): AC-005 create project via Dashboard "Create using AI"; AC-006 add rule via Workspace AI Assist; AC-007 fix broken rule (break `urlRegex` in the draft, Assist `fix`, Apply, Save, live redirect assertion against the local validate server). Reuse `extension-context`, `sample-basic-helpers` (validate server, `extensionSend`, `withNewTab`), and the `LIVE_E2E`-style prerequisite handling (native host install with sudo fallback + provider-config check).

## Phase 5 — Docs + validation

9. Update `docs/architecture.md` AI Assist paragraph (repair semantics). Run `pnpm validate`; run the live suite against the user's OpenRouter provider; record evidence in `workflow.md`.

## Risks

- Live LLM variance: prompts pin group ids, target URLs, and destinations; assertions stay structural (valid project, rule count, id preservation) plus one behavioral redirect check.
- Native-messaging host discovery under Chrome for Testing on Linux is unverified; the suite fails with the exact `rogatio runtime install` command when the host is missing.
