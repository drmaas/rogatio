# AI Integration Implementation Plan

> Based on approved spec at `docs/decisions/ai-integration/spec.md`

## Phase Overview

| Phase | Description | Packages | Est. Tasks |
|-------|-------------|----------|------------|
| 1 | Shared AI Completion Engine (`@rogatio/runtime`) | runtime | 8 |
| 2 | CLI `ai` Subcommands | cli | 6 |
| 3 | CLI Edit Server AI Integration | cli, editor | 7 |
| 4 | Native Host AI Integration | runtime, extension | 5 |
| 5 | Editor AI Assist Panel UI | editor | 6 |
| 6 | Extension AI Status | extension | 3 |
| 7 | Cross-Platform Verification & Polish | all | 4 |

**Total: ~39 tasks**

---

## Phase 1: Shared AI Completion Engine (`@rogatio/runtime`)

### Task 1.1: Config File Path Resolution
**File:** `packages/runtime/src/ai-config.ts` (new)
**Behavior:** Cross-platform config path resolution
**Acceptance:** AC-001, AC-017
**Test:** Unit - verify paths for Linux/macOS/Windows
```typescript
export function getProviderConfigPath(): string {
  // Linux: $XDG_CONFIG_HOME/rogatio/provider.json or ~/.config/rogatio/provider.json
  // macOS: ~/Library/Application Support/rogatio/provider.json
  // Windows: %LOCALAPPDATA%\rogatio\provider.json
}
```

### Task 1.2: Config File I/O (Read/Write/Delete)
**File:** `packages/runtime/src/ai-config.ts`
**Behavior:** Read/write/delete with 0o600 permissions
**Acceptance:** AC-001, AC-017
**Test:** Unit - read/write/delete roundtrip; verify file perms
```typescript
export interface AIProviderConfig {
  providerUrl: string;
  model: string;
  apiKey: string;
}
export async function readProviderConfig(): Promise<AIProviderConfig | null>
export async function writeProviderConfig(config: AIProviderConfig): Promise<void>
export async function deleteProviderConfig(): Promise<void>
```

### Task 1.3: AI Client (Complete + Stream)
**File:** `packages/runtime/src/ai-client.ts` (new)
**Behavior:** OpenAI-compatible client using global fetch
**Acceptance:** AC-010, AC-015
**Test:** Unit - mock fetch; test complete, stream, retry, timeout
```typescript
export interface AICompletionOptions { messages, model, temperature?, stream?, responseFormat?, signal? }
export interface AICompletionResult { content: string; usage? }
export interface AIStreamChunk { delta: string; done: boolean; usage? }

export function createAIClient(config: AIProviderConfig): AIClient
export interface AIClient {
  complete(options: AICompletionOptions): Promise<AICompletionResult>
  stream(options: AICompletionOptions): AsyncIterable<AIStreamChunk>
}
```

### Task 1.4: System Prompt Generation
**File:** `packages/runtime/src/ai-prompt.ts` (new)
**Behavior:** Build system prompt with schema constraints, rule types, diagnostic codes
**Acceptance:** AC-005, AC-006, AC-008
**Test:** Unit - snapshot test prompt content; verify includes all rule types
```typescript
export function buildSystemPrompt(project: unknown): string
```

### Task 1.5: High-Level `runAIAssist` with Validation Loop
**File:** `packages/runtime/src/ai-assist.ts` (new)
**Behavior:** Orchestrates AI → validate → fix loop (max 3 iterations)
**Acceptance:** AC-008, AC-009
**Test:** Unit - mock validate/dryRun; test success, fix loop, max iterations
```typescript
export async function runAIAssist(
  request: AIAssistRequest,
  config: AIProviderConfig,
  validate: (value: unknown) => readonly EditorDiagnostic[],
  dryRun?: (project: unknown, cases: readonly DryRunTestCase[]) => DryRunResult,
): Promise<AIProposal>
```

### Task 1.6: Shared Types Export
**File:** `packages/runtime/src/ai-types.ts` (new) + `packages/runtime/src/index.ts`
**Behavior:** Export all AI types for consumers (cli, editor, extension)
**Acceptance:** AC-016
**Test:** TypeScript compile - verify imports work in cli/editor/extension

### Task 1.7: Runtime Index Exports
**File:** `packages/runtime/src/index.ts`
**Behavior:** Add AI exports to public API
**Acceptance:** AC-016
**Test:** Build passes; imports resolve

### Task 1.8: AI Config/Client Unit Tests
**File:** `packages/runtime/test/ai-config.test.ts`, `ai-client.test.ts`, `ai-assist.test.ts`
**Behavior:** Comprehensive unit tests for all Phase 1 functions
**Acceptance:** AC-001, AC-010, AC-017
**Test:** `pnpm test --filter @rogatio/runtime`

---

## Phase 2: CLI `ai` Subcommands

### Task 2.1: AI Command Entry Point
**File:** `packages/cli/src/commands/ai.ts` (new)
**Behavior:** Command router for `ai setup/ls/show/delete/test`
**Acceptance:** AC-002
**Test:** Unit - command parsing, help output

### Task 2.2: `ai setup` - Interactive Configuration
**File:** `packages/cli/src/commands/ai.ts`
**Behavior:** Prompts for providerUrl, model, apiKey; writes config via runtime
**Acceptance:** AC-001, AC-002
**Test:** Unit - mock stdin/stdout; verify config written to correct path

### Task 2.3: `ai ls` / `ai show` - List/Display Config
**File:** `packages/cli/src/commands/ai.ts`
**Behavior:** Read config via runtime; display (key redacted for show)
**Acceptance:** AC-002
**Test:** Unit - mock config; verify output format

### Task 2.4: `ai delete` - Remove Config
**File:** `packages/cli/src/commands/ai.ts`
**Behavior:** Confirm deletion; call runtime deleteProviderConfig()
**Acceptance:** AC-002
**Test:** Unit - mock confirm; verify file removed

### Task 2.5: `ai test` - Connection Test
**File:** `packages/cli/src/commands/ai.ts`
**Behavior:** Read config; send test message via AIClient; report latency/result
**Acceptance:** AC-002
**Test:** Unit - mock AIClient; verify test message sent, response validated

### Task 2.6: CLI Index Integration
**File:** `packages/cli/src/index.ts`
**Behavior:** Register `ai` subcommand in main router
**Acceptance:** AC-002
**Test:** Integration - `rogatio ai --help` works

---

## Phase 3: CLI Edit Server AI Integration

### Task 3.1: Edit Command Reads Provider Config
**File:** `packages/cli/src/commands/edit.ts`
**Behavior:** On startup, call `readProviderConfig()`; create AIClient if configured
**Acceptance:** AC-003
**Test:** Unit - mock config; verify AIClient created

### Task 3.2: AI Server Routes (Complete + Stream)
**File:** `packages/cli/src/server/routes.ts`
**Behavior:** Add `/api/ai/complete` (JSON) and `/api/ai/stream` (SSE) routes
**Acceptance:** AC-003, AC-010
**Test:** Unit - mock AIClient; test SSE format, CSRF protection

### Task 3.3: Editor `aiAssist` Handler Implementation
**File:** `packages/cli/src/commands/edit.ts` (in generateEditorHtml)
**Behavior:** Pass `aiAssist` handler that calls `/api/ai/stream` (SSE)
**Acceptance:** AC-004, AC-010
**Test:** Integration - editor receives streaming chunks

### Task 3.4: Dry-Run Endpoint (Existing - Verify Works)
**File:** `packages/cli/src/server/routes.ts`
**Behavior:** Ensure `/api/dry-run` works for AI tool calls
**Acceptance:** AC-009
**Test:** Integration - existing dry-run tests pass

### Task 3.5: Editor HTML "Configure AI" Fallback
**File:** `packages/cli/src/commands/edit.ts` (generateEditorHtml)
**Behavior:** If no config, inject "Configure AI" button linking to `rogatio ai setup`
**Acceptance:** AC-011
**Test:** E2E - no config → button visible

### Task 3.6: CSRF Protection for AI Routes
**File:** `packages/cli/src/server/routes.ts`
**Behavior:** Apply existing CSRF middleware to `/api/ai/*`
**Acceptance:** AC-013 (security)
**Test:** Unit - request without token rejected

### Task 3.7: Edit Command AI Integration Tests
**File:** `packages/cli/test/edit-ai.test.ts` (new)
**Behavior:** Full edit server AI flow tests
**Acceptance:** AC-003, AC-004
**Test:** Integration - start server, call AI routes, verify responses

---

## Phase 4: Native Host AI Integration

### Task 4.1: Native Host Reads Provider Config
**File:** `packages/runtime/src/host.ts`
**Behavior:** On startup, call `readProviderConfig()`; create AIClient if configured
**Acceptance:** AC-016
**Test:** Unit - mock config; verify AIClient created

### Task 4.2: Native Messaging AI Envelope Types
**File:** `packages/runtime/src/native-framing.ts` (extend)
**Behavior:** Add `AICompleteRequest`, `AICompleteResponse`, `AIStreamChunkResponse`, `AIErrorResponse`
**Acceptance:** AC-016
**Test:** Unit - encode/decode roundtrip

### Task 4.3: Native Host AI Envelope Handlers
**File:** `packages/runtime/src/host.ts`
**Behavior:** Handle `ai.complete` → `AIClient.complete()`, `ai.stream.chunk` → `AIClient.stream()`
**Acceptance:** AC-011, AC-016
**Test:** Unit - mock AIClient; verify envelope responses

### Task 4.4: Extension Native Session AI Types
**File:** `packages/extension/src/native-session.ts`
**Behavior:** Add TypeScript types for AI envelopes (mirror runtime types)
**Acceptance:** AC-016
**Test:** TypeScript compile - types match

### Task 4.5: Extension Native Runtime AI Send
**File:** `packages/extension/src/native-session.ts`
**Behavior:** Ensure `nativeRuntime.send()` works for AI envelopes
**Acceptance:** AC-011
**Test:** Integration - extension ↔ native host AI envelope exchange

---

## Phase 5: Editor AI Assist Panel UI

### Task 5.1: Editor Types for AI Assist
**File:** `packages/editor/src/types.ts`
**Behavior:** Add `EditorAIAssistHandler`, `AIAssistRequest`, `AIAssistChunk`, `AIProposal`, `RuleProposal`
**Acceptance:** AC-004, AC-007
**Test:** TypeScript compile

### Task 5.2: AI Assist Panel Component
**File:** `packages/editor/src/ai-assist-panel.ts` (new)
**Behavior:** Side panel with conversation history, streaming display, Apply/Reject buttons
**Acceptance:** AC-004, AC-007
**Test:** Unit - DOM structure; Playwright - panel opens, streams, applies

### Task 5.3: Command Bar "AI Assist" Button
**File:** `packages/editor/src/editor.ts`
**Behavior:** Add button to command bar (desktop) and mobile nav
**Acceptance:** AC-004
**Test:** Playwright - button visible when aiAssist provided

### Task 5.4: Inline "Fix with AI" on Diagnostics
**File:** `packages/editor/src/editor.ts` (diagnostic rendering)
**Behavior:** Add "Fix with AI" button on each validation error
**Acceptance:** AC-008
**Test:** Playwright - error shown → fix button → AI called with fix request

### Task 5.5: Streaming Token Rendering
**File:** `packages/editor/src/ai-assist-panel.ts`
**Behavior:** Render SSE tokens incrementally; handle done/error
**Acceptance:** AC-007, AC-010
**Test:** Playwright - tokens appear <500ms; done shows proposal

### Task 5.6: Apply/Reject Proposal Integration
**File:** `packages/editor/src/ai-assist-panel.ts` + `editor.ts`
**Behavior:** Apply → calls editor setField for each rule; Reject → dismisses
**Acceptance:** AC-007
**Test:** Playwright - apply adds rule to draft; save persists

---

## Phase 6: Extension AI Status

### Task 6.1: Native Host AI Status Reporting
**File:** `packages/runtime/src/host.ts`
**Behavior:** On `runtime.status` envelope, include AI configured status
**Acceptance:** AC-011
**Test:** Unit - status includes aiConfigured: boolean

### Task 6.2: Extension Management Page AI Status
**File:** `packages/extension/src/extension-page.ts`
**Behavior:** Display AI status indicator (Configured / Not configured / Error)
**Acceptance:** AC-011
**Test:** Playwright - status shows correctly

### Task 6.3: Extension AI Assist Read-Only View
**File:** `packages/extension/src/extension-page.ts`
**Behavior:** If AI configured, show read-only AI conversation (no editor panel)
**Acceptance:** AC-011
**Test:** Playwright - AI conversation visible in management page

---

## Phase 7: Cross-Platform Verification & Polish

### Task 7.1: Linux/Windows Config Path Tests
**File:** `packages/runtime/test/ai-config.test.ts`
**Behavior:** Verify config path resolution on all platforms (mock os.homedir/platform)
**Acceptance:** AC-001, AC-017
**Test:** Unit - platform matrix

### Task 7.2: Config File Permissions Test
**File:** `packages/runtime/test/ai-config.test.ts`
**Behavior:** Verify written config file has 0o600 permissions
**Acceptance:** AC-017
**Test:** Unit - stat file mode

### Task 7.3: Full E2E: CLI Edit → AI Generate → Apply → Verify
**File:** `test/integration/ai-generate.test.ts` (new)
**Behavior:** Playwright: `rogatio edit` → AI Assist → generate rule → apply → `rogatio verify`
**Acceptance:** AC-005, AC-006, AC-007
**Test:** `pnpm test:integration` (Playwright)

### Task 7.4: Full E2E: CLI Edit → AI Fix Validation Error
**File:** `test/integration/ai-fix.test.ts` (new)
**Behavior:** Playwright: project with error → "Fix with AI" → fix applied → verify passes
**Acceptance:** AC-008
**Test:** `pnpm test:integration`

### Task 7.5: Full E2E: Extension AI Status + Native Host
**File:** `test/browser/ai-extension.test.ts` (new)
**Behavior:** Playwright (macOS): Start runtime → management page → AI status → AI assist
**Acceptance:** AC-011
**Test:** `pnpm test:browser` (macOS only)

### Task 7.6: Provider Compatibility Testing
**File:** `test/integration/ai-providers.test.ts` (new)
**Behavior:** Test against OpenAI, Ollama, OpenRouter (if available in CI)
**Acceptance:** AC-010
**Test:** Manual / CI with test credentials

### Task 7.7: Documentation Updates
**Files:** `README.md`, `packages/cli/README.md`, `packages/runtime/README.md`
**Behavior:** Document `rogatio ai` commands, config file location, AI Assist usage
**Acceptance:** All ACs (documentation)
**Test:** Manual review

### Task 7.8: Canonical Validation
**Command:** `pnpm validate`
**Behavior:** Full lint, typecheck, unit, integration, build
**Acceptance:** All ACs
**Test:** Must pass before merge

---

## Dependency Graph

```
Phase 1 (runtime AI engine)
    ├──→ Phase 2 (cli ai commands) ──────┐
    ├──→ Phase 3 (cli edit AI) ──────────┤
    ├──→ Phase 4 (native host AI) ───────┤
    │                                    ▼
    └──────────────────→ Phase 5 (editor UI)
                                    │
                                    ▼
                            Phase 6 (extension status)
                                    │
                                    ▼
                            Phase 7 (verification)
```

## Parallelization Opportunities

- **Phase 1** tasks 1.1-1.6 can be done in parallel (independent modules)
- **Phase 2** tasks 2.2-2.5 can be done in parallel (independent subcommands)
- **Phase 3** tasks 3.1-3.3 depend on Phase 1 complete
- **Phase 4** tasks 4.1-4.3 depend on Phase 1 complete
- **Phase 5** tasks 5.1-5.6 depend on Phase 3 complete (aiAssist handler)
- **Phase 6** tasks 6.1-6.3 depend on Phase 4 complete
- **Phase 7** depends on all previous phases

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AI provider compatibility | Test matrix in Phase 7; fallback to non-streaming |
| Streaming SSE vs native messaging chunks | Separate code paths; shared AIClient handles both |
| Config file permissions on Windows | Use `chmod` equivalent; test on all platforms |
| Large context windows | Active project only; summarize if needed |
| Validation loop infinite | Hard limit 3 iterations; tested in Phase 1 |

## Rollback Plan

Each phase is independently revertible:
- Phase 1: Remove new files, revert index.ts exports
- Phase 2: Remove ai.ts command, revert index.ts
- Phase 3: Remove AI routes, revert edit.ts
- Phase 4: Remove AI envelope handlers, revert framing
- Phase 5: Remove AI panel, revert editor types
- Phase 6: Remove AI status from extension page
- Phase 7: Documentation only

---

## Verification Checklist (Pre-Merge)

- [ ] `pnpm validate` passes (lint, typecheck, unit, integration, build)
- [ ] All Phase 1-6 unit tests pass
- [ ] Integration tests: AI generate, AI fix, AI dry-run tool
- [ ] Browser tests: CLI edit AI flow, Extension AI status (macOS)
- [ ] Config file created at correct path with 600 perms on all platforms
- [ ] No API key in `.rogatio.json` or git history
- [ ] Editor bundle contains no `node:` imports, no AI client code
- [ ] Native host uses shared AI module
- [ ] Documentation updated