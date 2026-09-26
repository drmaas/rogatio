> Status: frozen 2026-09-25

# AI fix-kind repair — spec

## Problem

The AI "fix broken rule" journey cannot work through the extension. When the Workspace draft has validation errors, the editor sends an `ai-assist` request with `kind: "fix"` and the draft + diagnostics. The service worker merges the returned proposal by **appending** rules (`mergeProposalIntoProject`) and then validates the merged project. The broken rule is still in the draft, so the merged project never validates and every fix proposal is rejected with `extension.ai-invalid-proposal`. The frozen spec's AC-008 ("Given schema error, 'Fix with AI' produces valid fix") is unreachable through the extension path.

## Goal

Given a rule with validation errors, AI Assist `fix` produces a corrected rule that replaces the offending rule in the draft; the service worker accepts the proposal only when applying it yields a valid project; after Apply + Save the project validates and behaves as intended.

## Requirements

- **REQ-1 — Repair mapping.** For a `fix` request with `context.diagnostics`, the rules carrying errors (diagnostic paths beginning `groups/<gi>/rules/<ri>`) are *repair targets*, in stable path order, de-duplicated. Proposal rules map onto targets group-scoped FIFO: a proposal rule with `groupId` equal to a target rule's group replaces the earliest unused target in that group (keeping the target rule's `id` and position; all other fields come from the proposal). Proposal rules with no remaining target append as new rules (existing behavior). With no repair targets, behavior is unchanged.
- **REQ-2 — Service-worker gate.** For `kind: "fix"` with diagnostics, the `ai-assist` handler validates the *repaired* project (draft + repair mapping) instead of the append-merge. An unrepairing proposal is still rejected with `extension.ai-invalid-proposal`. Non-fix requests keep the append-merge gate.
- **REQ-3 — Editor Apply.** `applyAIProposal` applies the same mapping for fix requests (targets snapshotted when the request was built), so the broken rule is repaired in place instead of duplicated. Generate/explain apply behavior is unchanged.
- **REQ-4 — Host parity.** `packages/runtime` `runAIAssist` validates fix attempts with the same repair mapping (targets from `request.context.diagnostics`) so the CLI `/api/ai/assist` host converges instead of exhausting fix attempts. The extension keeps its browser-safe slim mirror of the mapping.
- **REQ-5 — Live browser coverage.** Opt-in Selenium journeys (`AI_LIVE=1`, real provider) assert the three AI features in the real extension: create project (Dashboard "Create using AI"), add new rule (Workspace AI Assist generate), fix broken rule (Workspace AI Assist fix → apply → save → project validates and the fixed rule behaves correctly in the browser).

## Non-goals

- No new proposal wire format (no rule ids in `RuleProposal`); mapping is inferred from `groupId` + diagnostics order.
- No inline "Fix with AI" button on diagnostics rows (frozen spec UI text is future work).
- No change to `generate`/`explain` semantics (append-only), prompts, or the provider config surface.
- No streaming changes; `ai.complete` remains the envelope.

## Acceptance criteria

- **AC-001** A fix proposal that corrects the offending rule passes the service-worker gate; the repaired project validates (`packages/extension/test/ai-assist.test.ts`).
- **AC-002** A fix proposal that leaves the project invalid is still rejected with `extension.ai-invalid-proposal` (same test file).
- **AC-003** Editor Apply for a fix request replaces the offending rule in place, keeping its `id`, and appends surplus proposal rules (`packages/editor/test/ai-assist.test.ts`).
- **AC-004** `runAIAssist` fix attempts validate the repaired project and converge (`packages/runtime/test/ai-assist.test.ts`).
- **AC-005** Live browser journey (AI_LIVE=1): Dashboard create-project produces a saved project.
- **AC-006** Live browser journey (AI_LIVE=1): Workspace AI Assist generate adds a rule that saves cleanly.
- **AC-007** Live browser journey (AI_LIVE=1): Workspace AI Assist fix repairs a deliberately broken rule; after Apply + Save the project validates and the fixed redirect works against a local server.
- **AC-008** `pnpm validate` is green with the AI live suite skipped by default.

## Known limitations (out of scope)

- Fix-kind requests without rule-level diagnostics (project/group-level errors) cannot be repaired by rule proposals and are rejected by the gate, unchanged from today.
- The repair mapping is heuristic (group-scoped FIFO); a model that returns corrected rules under a wrong `groupId` appends instead of repairing, and the gate rejects the result.
