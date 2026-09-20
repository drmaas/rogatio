> Status: frozen 2026-09-20

# AI Assist editor wire — plan

Audience: hybrid. Issue #208.

## Architecture note

- Panel owns UI + streaming display APIs; editor owns request build, handler invoke, draft apply.
- Reuse existing `EditorAIAssistHandler` / `AIAssistChunk` / `AIProposal` in `packages/editor/src/types.ts`. Do not call `runAIAssist` from editor (runtime is Node host; #209 wires it).
- `applyAIProposal` must set rule `type` and the correct payload field(s). Header is flat schema fields, not nested `action`.
- Rejected: new abstraction layer; editor-side validation loop (already in `packages/runtime` `runAIAssist`).

## Ordered tasks

1. **Tests** (`packages/editor/test/ai-assist.test.ts`) — mock `aiAssist` AsyncIterable + Promise; assert request kind/context; assert draft after Apply for each kind. Covers AC-001..005.
2. **Panel** (`ai-assist-panel.ts`) — `onSend(prompt)` callback; user message + clear textarea; fix token accumulation; `addMessage` keeps `messages` array in sync. AC-001/002.
3. **Editor invoke** (`editor.ts`) — pass `onSend` → `runAIAssist`; build request; consume iterable or promise; drive streaming APIs; surface errors; in-flight guard. AC-001/002.
4. **applyAIProposal** (`editor.ts`) — kind→field map + header flatten + skip forbidden keys. AC-003/004.
5. **Validate** — `pnpm validate`. AC-006.
6. **Docs** — architecture/README only if boundary text needs a one-line update; freeze decision docs on release.
