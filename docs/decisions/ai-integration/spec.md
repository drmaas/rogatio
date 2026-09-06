# AI Integration Specification (Revised)

> Status: DRAFT — pending human review (Stage 4)
> Updated per user guidance: self-contained edit, cross-platform config, shared AI modules.

## 1. Problem Statement & Goals

**Problem**: Users want AI-assisted rule authoring for Rogatio projects — generating new projects from natural language, adding rules to existing projects, and fixing validation/runtime issues — without leaving the editor or CLI workflow.

**Goals**:
- Enable AI to generate valid `.rogatio.json` projects from natural language
- Enable AI to add valid rules (redirect, query, header, mock, response-body, request-body) to existing projects
- Enable AI to fix schema validation errors and compiler diagnostics
- Enable AI to fix dry-run mismatches (regex, origin, method, resourceType)
- Respect Rogatio's local-first, privacy-preserving architecture
- User controls AI provider (URL, model, API key); no mandatory accounts or telemetry
- **Self-contained `rogatio edit`**: AI runs in-process, no separate native host needed
- **Shared AI module**: Both CLI edit and native host use same `@rogatio/runtime` AI engine
- **Cross-platform config**: Single provider config file at platform-standard location

## 2. Scope & Non-Goals

### In Scope
- Cross-platform AI provider config: `~/.config/rogatio/provider.json` (Linux), `%LOCALAPPDATA%\rogatio\provider.json` (Windows), `~/Library/Application Support/rogatio/provider.json` (macOS)
- CLI `ai` subcommands: `setup`, `ls`, `show`, `delete`, `test`
- `@rogatio/runtime` exports shared AI completion engine (client, config I/O, validation loop)
- CLI `edit` server reads config, enables AI endpoints, passes `aiAssist` to editor
- Native host (`rogatio runtime host`) reads same config, handles AI envelopes for extension
- Editor "AI Assist" panel with streaming SSE (CLI) / native messaging chunks (extension)
- AI proposes structured rule changes validated by schema/compiler before editor commit
- Dry-run as AI validation tool
- Graceful degradation when config missing / network error

### Non-Goals
- AI intercepting live traffic (no `webRequestBlocking` in MV3)
- Cloud-hosted AI or Rogatio-managed endpoints
- Automatic rule application without user review
- Browser-direct AI calls (security boundary)
- MCP server integration
- WebLLM or in-browser local models
- AI-generated test cases (dry-run cases are user-provided)
- Multi-turn conversation persistence across sessions
- Project-wide refactoring (single rule/group at a time)
- Multiple named provider profiles (v1: single provider; extensible later)

## 3. Actors, Entry Points & Environments

| Actor | Entry Point | Environment |
|-------|-------------|-------------|
| Developer (CLI config) | `rogatio ai setup/ls/show/delete/test` | Linux, Windows, macOS |
| Developer (CLI edit) | `rogatio edit` → "AI Assist" panel | Linux, Windows, macOS |
| Developer (Extension) | Extension management page → AI status | Chrome MV3 (macOS native host; Linux/Windows capability-gated) |
| AI Provider | OpenAI-compatible chat completions API | User-configured (OpenAI, Ollama, OpenRouter, vLLM, etc.) |

## 4. Functional Requirements

### REQ-001: Cross-Platform Provider Config File
- **Path resolution**:
  - Linux: `$XDG_CONFIG_HOME/rogatio/provider.json` or `~/.config/rogatio/provider.json`
  - macOS: `~/Library/Application Support/rogatio/provider.json`
  - Windows: `%LOCALAPPDATA%\rogatio\provider.json`
- **File format** (JSON):
```json
{
  "providerUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "apiKey": "sk-..."
}
```
- **Permissions**: Created with 0o600 (owner read/write only)
- **Never** written to `.rogatio.json` (version-controlled project file)

### REQ-002: CLI `ai` Subcommands
| Command | Behavior |
|---------|----------|
| `rogatio ai setup` | Interactive prompts for providerUrl, model, apiKey; writes config file (creates directory if needed) |
| `rogatio ai ls` | Lists configured provider (single for v1); shows providerUrl, model, key redacted |
| `rogatio ai show` | Shows full config with apiKey redacted (sk-***) |
| `rogatio ai delete` | Removes config file; confirms before deletion |
| `rogatio ai test` | Sends test message ("Hello") to provider; validates response; reports latency |

### REQ-003: Shared AI Completion Engine (`@rogatio/runtime`)
**Exported API:**
```typescript
// Config I/O
getProviderConfigPath(): string
readProviderConfig(): Promise<AIProviderConfig | null>
writeProviderConfig(config: AIProviderConfig): Promise<void>
deleteProviderConfig(): Promise<void>

// Client
createAIClient(config: AIProviderConfig): AIClient

interface AIClient {
  complete(options: AICompletionOptions): Promise<AICompletionResult>
  stream(options: AICompletionOptions): AsyncIterable<AIStreamChunk>
}

// High-level assist with validation loop
runAIAssist(request, config, validate, dryRun?): Promise<AIProposal>

// System prompt
buildSystemPrompt(project): string
```

**Implementation:**
- Uses global `fetch` (Node 24+) with `undici` for streaming if needed
- JSON mode for structured proposals (`responseFormat: { type: "json_object" }`)
- Retry with exponential backoff (429, 5xx, network errors); max 3 retries
- Timeout: 60s complete, 120s stream
- Sanitizes all AI output (defensive clone, no prototypes, no functions)

### REQ-004: CLI Edit Server AI Integration
- On `rogatio edit` startup: call `readProviderConfig()`
- If configured: create `AIClient`, enable `/api/ai/*` routes, pass `aiAssist` handler to editor
- If not configured: AI routes return 404; editor shows "Configure AI" prompt
- **Routes** (CSRF-protected):
  - `POST /api/ai/complete` → `AIClient.complete()` → JSON response
  - `POST /api/ai/stream` → `AIClient.stream()` → SSE response
- **Editor `aiAssist` handler**: Calls `/api/ai/stream` (preferred) or `/api/ai/complete`

### REQ-005: Native Host AI Integration
- `rogatio runtime host` startup: call `readProviderConfig()`
- If configured: create `AIClient`, register handlers for `ai.complete` / `ai.stream.chunk` envelopes
- **Envelope handlers**:
  - `ai.complete` → `AIClient.complete()` → return `ai.complete` response
  - `ai.stream.chunk` → `AIClient.stream()` → emit `ai.stream.chunk` envelopes per chunk
- If not configured: return `ai.error` with `code: "ai.not-configured"`

### REQ-006: Native Messaging AI Envelopes
**Request (extension → native host):**
```typescript
interface AICompleteRequest {
  protocol: "v1";
  type: "ai.complete";
  requestId: string;
  timestamp: number;
  metadata: AICompletionOptions;  // { messages, model, temperature?, stream?, responseFormat? }
}
```

**Response (native host → extension):**
```typescript
interface AICompleteResponse {
  protocol: "v1";
  type: "ai.complete";
  requestId: string;
  timestamp: number;
  metadata: AICompletionResult;  // { content, usage? }
}

interface AIStreamChunkResponse {
  protocol: "v1";
  type: "ai.stream.chunk";
  requestId: string;
  timestamp: number;
  metadata: AIStreamChunk;  // { delta, done, usage? }
}

interface AIErrorResponse {
  protocol: "v1";
  type: "ai.error";
  requestId: string;
  timestamp: number;
  metadata: { code: string; message: string; retryable: boolean };
}
```

### REQ-007: Editor AI Integration
- **`EditorOptions.aiAssist`** handler (async iterable for streaming):
```typescript
interface EditorAIAssistHandler = (request: AIAssistRequest) => AsyncIterable<AIAssistChunk>;

interface AIAssistRequest {
  kind: "generate" | "fix" | "explain";
  prompt: string;
  context: {
    project: EditorProjectSnapshot;
    activeGroupId?: string;
    focusedRuleId?: string;
    diagnostics?: readonly EditorDiagnostic[];
    dryRunCases?: readonly DryRunTestCase[];
  };
}

interface AIAssistChunk {
  type: "token" | "done" | "error";
  content?: string;
  proposal?: AIProposal;
  error?: { code: string; message: string };
}

interface AIProposal {
  rules: readonly RuleProposal[];
  explanation: string;
}

interface RuleProposal {
  kind: "redirect" | "query" | "header" | "mock" | "response-body" | "request-body";
  groupId: string;
  name: string;
  urlRegex: string;
  origins?: string[];
  resourceTypes?: string[];
  priority?: number;
  method?: string;
  action: unknown;
}
```

- **UI**: "AI Assist" button in command bar (desktop) / mobile nav
- **Panel**: Conversation history, streaming tokens, Apply/Reject per proposal
- **Inline**: "Fix with AI" button on validation errors

### REQ-008: System Prompt (Versioned with Release)
Embedded in `buildSystemPrompt()` includes:
- Schema constraints: regex limits (2048 chars), forbidden headers, origin bounds, resource types, method enum
- Rule type schemas: each kind with action field structure
- Compiler diagnostic codes reference (stable codes from `@rogatio/compiler`)
- Current project JSON (active project only, redacted)
- Output format: strict JSON `{ rules: RuleProposal[], explanation: string }`
- Instructions: minimal changes, use dry-run tool for validation

### REQ-009: Validation Loop (Max 3 Iterations)
```
1. AI returns proposal (via streaming or complete)
2. Editor calls validate() → diagnostics
3. If zero diagnostics: present with "Apply"
4. If diagnostics: call AI with kind="fix", include diagnostics + failed proposal
5. Repeat up to 3 times per original request
6. After 3 failures: present raw diagnostics, disable auto-fix for this request
```

### REQ-010: Dry-Run as AI Tool
- AI can invoke `dryRun` handler (passed via `EditorOptions.dryRun`)
- Called via `/api/dry-run` from CLI server
- AI provides test cases; dry-run returns match results
- AI uses results to refine proposal before presenting

### REQ-011: Graceful Degradation
| Condition | Behavior |
|-----------|----------|
| No config file | `rogatio edit`: AI features hidden, "Configure AI" button; `rogatio ai`: prompts to run `setup` |
| Network error | Inline error in panel with "Retry" button; streaming falls back to complete |
| Provider error (401, 429, 5xx) | User-facing error with actionable message; retryable flag |
| Streaming fails | Automatic fallback to non-streaming complete |
| Native host no config | Extension: AI status "Not configured"; envelopes return `ai.not-configured` |

## 5. Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| **AC-001** | `rogatio ai setup` creates config at correct platform path with 600 perms | Unit + manual |
| **AC-002** | `rogatio ai ls/show/delete/test` work correctly | Unit + manual |
| **AC-003** | `rogatio edit` enables AI endpoints when config exists | Integration test |
| **AC-004** | Editor shows "AI Assist" button when AI configured | Playwright E2E |
| **AC-005** | User types "Create a redirect rule for api.example.com to mock.local" → AI proposes valid redirect rule | Playwright E2E |
| **AC-006** | Proposed rule passes `rogatio verify` with zero diagnostics | Automated test |
| **AC-007** | User clicks "Apply" → rule appears in editor, saves to `.rogatio.json` | Playwright E2E |
| **AC-008** | Given schema error, "Fix with AI" produces valid fix (max 3 iterations) | Unit + E2E |
| **AC-009** | Given failing dry-run case, AI modifies rule to match | Unit + E2E |
| **AC-010** | Streaming tokens appear in editor <500ms (local provider) | Manual + benchmark |
| **AC-011** | Extension management page shows AI status; AI works when native host running | Playwright E2E (macOS) |
| **AC-012** | Config file never written to `.rogatio.json`; API key never in project file | Audit |
| **AC-013** | All AI output passes through schema/compiler validation before editor commit | Code review + test |
| **AC-014** | No network requests to Rogatio-owned endpoints | Network audit |
| **AC-015** | Editor browser bundle contains no `node:` imports, no Ajv, no AI client code | Build manifest audit |
| **AC-016** | Native host uses shared AI module; reads same config file | Code review |
| **AC-017** | Config file permissions 600 (owner only) | Unit test |

## 6. API / CLI / UI Changes

### CLI New Subcommands
```bash
rogatio ai setup       # Interactive configuration
rogatio ai ls          # List provider
rogatio ai show        # Show config (key redacted)
rogatio ai delete      # Remove config
rogatio ai test        # Test connection
```

### CLI Edit Command
- Reads config on startup
- Enables `/api/ai/complete` and `/api/ai/stream` routes
- Passes `aiAssist` handler to editor (calls SSE endpoint)

### Editor UI
- Command bar: "AI Assist" button (sparkle icon)
- Mobile nav: "AI Assist" option
- Side panel: Conversation, streaming, Apply/Reject
- Diagnostic inline: "Fix with AI" button

### Extension UI
- Management page: AI status indicator (Configured/Not configured/Error)
- No AI panel in popup

### File Formats
- **Config**: `~/.config/rogatio/provider.json` (or platform equivalent) — `{ providerUrl, model, apiKey }`
- **Project**: `.rogatio.json` optional `ai: { providerUrl, model }` for display only

## 7. Security, Privacy, Performance, Accessibility

### Security
- Config file: 0o600 permissions; created by `rogatio ai setup`
- API key only in config file; read by CLI server and native host processes
- AI output sanitized → validated by schema/compiler → editor draft
- Native messaging frames carry AI request/response only

### Privacy
- Zero telemetry
- Requests only to user-configured provider URL
- Project data sent to AI provider (user's choice)
- No conversation history persisted

### Performance
- Streaming first token <500ms (local provider)
- In-process AI client: no IPC overhead for CLI edit
- Native host: native messaging chunks (64 KiB frames)
- Context: active project only (~50KB typical)

### Accessibility
- AI Assist panel: keyboard navigable, screen reader announcements
- Apply/Reject: accessible labels, focus management
- Errors: live region announcements
- Forced colors / high contrast: design system tokens

## 8. Migration, Rollout, Backward Compatibility

- **Backward compatible**: All additive; existing projects work unchanged
- **No migration**: Config file created on first `rogatio ai setup`
- **Rollout**: Feature enabled by presence of config file
- **Native host**: AI gateway active when config exists (existing `Start runtime` unchanged)

## 9. Open Questions & Assumptions

| Question | Assumption for Spec |
|----------|---------------------|
| Multiple providers | v1: single provider; named profiles extensible later |
| System prompt versioning | Embedded in `@rogatio/runtime` source; versioned with release |
| Max context size | Active project only (1 of max 64 projects) |
| Iteration limit | 3 auto-fix attempts per diagnostic |
| Streaming default | Yes (SSE from CLI, chunks from native host) |
| Provider testing | OpenAI, Ollama, OpenRouter, vLLM (OpenAI-compatible) |
| Dry-run tool | AI calls editor's existing `dryRun` handler via `/api/dry-run` |
| Config directory creation | `rogatio ai setup` creates parent directories as needed |

---

**Approval**: This specification requires explicit human approval before implementation plan (Stage 5).