> Status: frozen 2026-10-14

# Test console modal workflow

Audience: agent.

## Stage checklist

- [x] Stage 0 — worktree `feature/test-console-modal`, base `f985ab7`.
- [x] Stage 1 — scope fixed by the request. Adversarial notes stayed in the session: keep AI Assist on the title row, show test status inside the dialog, close the dialog when a rule or diagnostic is opened, keep the group ledger.
- [x] Stage 2 — plan recorded in `plan.md`.
- [x] Stage 3 — tests updated with the view. A red-only run was skipped because the assertions describe DOM that the same change creates.
- [x] Stage 4 — implementation in the editor view and stylesheet.
- [x] Stage 5 — `pnpm validate` exit 0 after review fixes. Unit suite passed inside that run. Browser 100 passed, 9 skipped.
- [x] Stage 6 — fresh review. Round 1 (`grok-4.7-high-fast`; GPT and Gemini were usage-limited) found tab stops inside a closed miss list, editor status copied into the dialog, and a late run writing status after close. Fixed. Round 2 (`grok-4.7-high-fast`) found nothing actionable.
- [x] Stage 7 — living docs updated. `AGENTS.md` unchanged. Package boundaries unchanged.
- [x] Stage 8 — frozen into the feature commit. Issue #357.

## Models

- reasoning: `claude-opus-5-5-medium` — layout synthesis, medium complexity, allowlist.
- adversarial: `gpt-5.6-sol-medium` — different family. Pass held in the orchestrator because the request already fixed the layout.
- plan: `claude-sonnet-5-5-high`.
- coding: `claude-sonnet-5-5-high`.
- verify: repository `pnpm validate`.
- review: fresh context, different family from coding.
- docs: `claude-sonnet-5-5-high`.

Graphify CLI was not on `PATH`. The main checkout graph was not queried. Code and tests were the source.
