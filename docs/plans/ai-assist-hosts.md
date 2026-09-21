> Status: frozen 2026-09-20

# AI Assist hosts — plan

Audience: hybrid

## Architecture note

- **CLI:** edit-server owns Assist. `RouteContext` gains `aiProviderConfig`. New `POST /api/ai/assist` CSRF-gates, rejects when unconfigured, parses editor-shaped `AIAssistRequest`, calls `runAIAssist` with schema diagnostic adapter + optional `aiClient`, returns `{ proposal }`. Embedded `edit.ts` handler POSTs the full request (Promise path). Raw `/complete` and `/stream` unchanged for other callers.
- **Runtime:** `mergeProposalIntoProject` maps each `RuleProposal` onto a schema-shaped rule (`kind` → `type` + action fields) and inserts into the target group’s `rules[]`. `runAIAssist` validates that merged project. Shared by CLI; extension duplicates a slim merge for browser boundary.
- **Extension:** New SW command `ai-assist`. Page `aiAssist` → `client.send`. SW builds Assist system prompt + stringified draft/diagnostics, `requestAIComplete` (`model: ""` → host default), parses proposal, merge+`validateProjectDetailed`, returns proposal. Remount Workspace editor when `aiSupported` flips. No CLI HTTP.
- **Rejected:** new `ai.assist` envelope (protocol + 64 KiB/body-key); SSE token wrapper around non-streaming `runAIAssist`; overloading `/api/ai/stream` (frozen raw-proxy contract).

## Ordered tasks

1. **Runtime merge + test** — `packages/runtime/src/ai-assist.ts`: fix merge; unit test with `validateProjectDetailed` (or schema-shaped assert). Covers AC-001 foundation.
2. **CLI `/api/ai/assist` + tests** — `routes.ts` + `RouteContext.aiProviderConfig`; tests CSRF/404/happy/invalid. AC-001–005.
3. **CLI `edit.ts` handler** — Promise fetch to `/api/ai/assist` with full request; drop hardcoded model/SSE parser. AC-002–003.
4. **Extension protocol + SW `ai-assist`** — `protocol.ts`, `service-worker.ts`, tests like `ai-generation.test.ts`. AC-007–008.
5. **Extension Workspace wire** — `extension-page-entry.ts` pass `aiAssist` when supported; remount on support flip. AC-006.
6. **Docs sync** — architecture/README/docs-site via docs-accuracy-sync. AC-009.
7. **Gate** — `pnpm validate`. AC-010.
