# AI Integration Architecture (Revised)

> Updated per user guidance: self-contained `rogatio edit`, cross-platform config, shared AI modules.

## Chosen Approach: Self-Contained Edit Process with Shared AI Modules

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EDITOR (Browser)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │ AI Assist   │  │  Command    │  │   Draft     │  │  Validate/Save  │   │
│  │   Panel     │──│   Bar       │──│   State     │──│   Adapters      │   │
│  └──────┬──────┘  └─────────────┘  └─────────────┘  └────────┬────────┘   │
│         │                                                     │            │
│         ▼                                                     ▼            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    CLI EDIT SERVER (127.0.0.1:random)               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │   │
│  │  │ /api/ai/    │  │ /api/ai/    │  │ /api/       │  │ /api/    │  │   │
│  │  │  complete   │  │  stream     │  │  validate   │  │  save    │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  │   │
│  │         │                │                │             │         │   │
│  │         ▼                ▼                ▼             ▼         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐  │   │
│  │  │              AI COMPLETION ENGINE (in-process)              │  │   │
│  │  │  • Reads ~/.config/rogatio/provider.json                    │  │   │
│  │  │  • OpenAI-compatible client (fetch/undici)                  │  │   │
│  │  │  • System prompt with schema/rule/diagnostic context        │  │   │
│  │  │  • Streaming + non-streaming                                │  │   │
│  │  │  • Validation loop (max 3 iterations)                       │  │   │
│  │  └─────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         NATIVE HOST (rogatio runtime host)                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Reads SAME ~/.config/rogatio/provider.json                       │   │
│  │  • Uses SAME AI completion engine (shared module)                   │   │
│  │  • Extension accesses via native messaging (ai.*) envelopes         │   │
│  │  • No separate AI config; no separate process for AI                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLI AI SUBCOMMANDS                             │
│  rogatio ai setup      → Interactive provider configuration                 │
│  rogatio ai ls         → List configured providers                          │
│  rogatio ai show       → Show current provider (key redacted)               │
│  rogatio ai delete     → Remove provider config                             │
│  rogatio ai test       → Test connection to provider                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions (Revised)

| Decision | Rationale |
|----------|-----------|
| **Self-contained `rogatio edit`** | No proxy, no native host dependency for AI; works everywhere CLI runs |
| **Cross-platform config file** | `~/.config/rogatio/provider.json` (Linux), `%LOCALAPPDATA%\rogatio\provider.json` (Windows), `~/Library/Application Support/rogatio/provider.json` (macOS) |
| **Shared AI module** | `@rogatio/runtime` exports AI completion engine; both CLI server and native host import it |
| **CLI `ai` subcommands** | User-friendly provider management: `setup`, `ls`, `show`, `delete`, `test` |
| **Native host unchanged role** | Still `rogatio runtime host` for extension debugging; just also uses shared AI module |
| **Streaming via SSE from CLI server** | Editor receives SSE; native host uses native messaging chunks for extension |
| **No fallback routing needed** | Edit process always has AI engine; native host always has AI engine |

## Component Responsibilities (Revised)

### `@rogatio/schema` — AI Metadata in Project (Unchanged)

```typescript
// packages/schema/src/types.ts
export interface RogatioProject {
  version: 1;
  name: string;
  description?: string;
  groups: RogatioGroup[];
  ai?: AIProjectConfig;        // Optional metadata only (no credentials)
}

export interface AIProjectConfig {
  providerUrl: string;          // For reference/display only
  model: string;                // For reference/display only
}
```

### `@rogatio/runtime` — **NEW: Shared AI Completion Engine**

**New module:** `packages/runtime/src/ai-completion.ts`

**Exports:**
```typescript
// Shared types
export interface AIProviderConfig {
  providerUrl: string;      // e.g., "https://api.openai.com/v1"
  model: string;            // e.g., "gpt-4o-mini"
  apiKey: string;           // Bearer token
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AICompletionOptions {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  stream?: boolean;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
}

export interface AICompletionResult {
  content: string;           // Full response (non-streaming) or final assembled
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AIStreamChunk {
  delta: string;
  done: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

// Core functions
export function getProviderConfigPath(): string;           // Cross-platform path
export function readProviderConfig(): Promise<AIProviderConfig | null>;
export function writeProviderConfig(config: AIProviderConfig): Promise<void>;
export function deleteProviderConfig(): Promise<void>;

export function createAIClient(config: AIProviderConfig): AIClient;

export interface AIClient {
  complete(options: AICompletionOptions): Promise<AICompletionResult>;
  *stream(options: AICompletionOptions): AsyncIterable<AIStreamChunk>;
}

// High-level: validation loop with schema/compiler
export interface AIAssistRequest {
  kind: "generate" | "fix" | "explain";
  prompt: string;
  context: {
    project: unknown;           // RogatioProject
    activeGroupId?: string;
    focusedRuleId?: string;
    diagnostics?: readonly EditorDiagnostic[];
    dryRunCases?: readonly DryRunTestCase[];
  };
}

export interface AIProposal {
  rules: readonly RuleProposal[];
  explanation: string;
}

export interface RuleProposal {
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

export async function runAIAssist(
  request: AIAssistRequest,
  config: AIProviderConfig,
  validate: (value: unknown) => readonly EditorDiagnostic[],
  dryRun?: (project: unknown, cases: readonly DryRunTestCase[]) => DryRunResult,
): Promise<AIProposal>;

// System prompt generation (versioned with release)
export function buildSystemPrompt(project: unknown): string;
```

**Implementation details:**
- Uses global `fetch` (Node 24+) or `undici` for streaming
- System prompt embeds: schema bounds, rule type schemas, compiler diagnostic codes
- JSON mode for structured proposals (`responseFormat: { type: "json_object" }`)
- Retry with exponential backoff (429, 5xx); timeout 60s complete / 120s stream
- Sanitizes AI output before returning (defensive clone)

### `@rogatio/cli` — Config Commands + Edit Server Integration

**New CLI subcommand:** `rogatio ai` (`packages/cli/src/commands/ai.ts`)

```bash
rogatio ai setup       # Interactive: prompts for URL, model, key; writes config
rogatio ai ls          # List all configured providers (supports multiple? start with one)
rogatio ai show        # Show current provider (key redacted: sk-***)
rogatio ai delete      # Remove provider config
rogatio ai test        # Test connection: sends "ping" message, validates response
```

**Edit command integration** (`packages/cli/src/commands/edit.ts`):
- On startup, read provider config via `readProviderConfig()`
- If configured: enable AI endpoints and pass `aiAssist` handler to editor
- If not configured: AI features hidden; "Configure AI" button in panel

**New server routes** (`packages/cli/src/server/routes.ts`):
- `POST /api/ai/complete` → calls `aiClient.complete()` → JSON response
- `POST /api/ai/stream` → calls `aiClient.stream()` → SSE response
- Both use existing CSRF protection

### `@rogatio/editor` — AI Assist Integration (Unchanged from previous)

- `aiAssist` handler in `EditorOptions` (called by editor for generate/fix/explain)
- "AI Assist" panel in command bar / mobile nav
- Streaming token display, Apply/Reject per proposal
- Max 3 fix iterations per diagnostic

### `@rogatio/extension` — Native Host Bridge

**Native messaging envelopes** (extend `packages/extension/src/native-session.ts`):

```typescript
// Request: extension → native host
interface AICompleteRequest {
  protocol: "v1";
  type: "ai.complete";
  requestId: string;
  timestamp: number;
  metadata: AICompletionOptions;  // Reuses shared types
}

// Response: native host → extension
interface AICompleteResponse {
  protocol: "v1";
  type: "ai.complete";
  requestId: string;
  timestamp: number;
  metadata: AICompletionResult;
}

interface AIStreamChunkResponse {
  protocol: "v1";
  type: "ai.stream.chunk";
  requestId: string;
  timestamp: number;
  metadata: AIStreamChunk;
}

interface AIErrorResponse {
  protocol: "v1";
  type: "ai.error";
  requestId: string;
  timestamp: number;
  metadata: { code: string; message: string; retryable: boolean };
}
```

**Native host handler** (`packages/runtime/src/host.ts`):
- On `ai.complete` / `ai.stream.chunk` envelope: call shared `aiClient.complete()` / `aiClient.stream()`
- Returns response via native messaging
- Reads provider config at startup via `readProviderConfig()`

### `@rogatio/dry-run` — Unchanged (AI Tool)

AI calls editor's `dryRun` handler via `/api/dry-run` to validate proposals.

## Data Flow: AI-Assisted Rule Generation (CLI Edit)

```
1. User runs `rogatio edit` → CLI server starts
2. CLI server reads ~/.config/rogatio/provider.json → creates AIClient
3. User opens editor → clicks "AI Assist" → types prompt
4. Editor calls /api/ai/stream (SSE) with { kind: "generate", prompt, context }
5. CLI server route → runAIAssist(request, config, validate, dryRun)
6. runAIAssist:
   a. Builds system prompt (schema + rules + diagnostics + project)
   b. Calls AIClient.stream() with messages
   c. Streams chunks to editor via SSE
   d. On done: validates proposal via validate()
   e. If invalid: loops back to AI with diagnostics (max 3x)
   f. Returns final proposal
7. Editor displays proposal with "Apply" button
8. User clicks Apply → editor save adapter → .rogatio.json
```

## Data Flow: Extension AI (Native Host)

```
1. User clicks "Start runtime" → extension launches native host via native messaging
2. Native host starts → reads ~/.config/rogatio/provider.json → creates AIClient
3. Extension management page → "AI Assist" → sends ai.complete envelope
4. Native host handles envelope → calls AIClient.complete() / stream()
5. Returns ai.complete / ai.stream.chunk envelopes
6. Extension assembles → presents in management page (read-only, no editor)
```

## Security Boundaries (Revised)

| Boundary | Protection |
|----------|------------|
| **API Key** | Only in `~/.config/rogatio/provider.json` (600 perms) or OS keychain; read by CLI server and native host processes only |
| **Project Data** | Sent to user's AI endpoint only; no Rogatio infrastructure |
| **AI Output** | Sanitized → validated by schema/compiler → editor draft |
| **Native Messaging** | Frames carry AI request/response metadata only |
| **Config File** | Created by `rogatio ai setup` with 600 permissions; never written by editor |

## Platform Support Matrix (Revised)

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| `rogatio edit` + AI | ✅ | ✅ | ✅ |
| `rogatio ai` config commands | ✅ | ✅ | ✅ |
| Extension AI (native host) | ✅ | Capability-gated | Capability-gated |
| Shared AI module | ✅ | ✅ | ✅ |

## Rejected Alternatives (Revised)

| Alternative | Reason |
|-------------|--------|
| Project-local `.rogatio.ai.json` | User wants cross-platform config directory |
| CLI server proxying to native host | User wants self-contained edit process |
| Browser-direct AI calls | Security boundary violation |
| Separate AI daemon | Unnecessary; in-process is simpler |

## Testing Seams (Revised)

| Seam | Test Type |
|------|-----------|
| Config file path resolution | Unit (runtime) |
| Config read/write/delete | Unit (runtime) |
| AI client (complete/stream) | Unit (runtime, with mock fetch) |
| System prompt generation | Unit (runtime) |
| Validation loop (3 iterations) | Unit (runtime) |
| CLI `ai` subcommands | Unit (cli) |
| Edit server AI routes | Unit (cli server) |
| Editor aiAssist integration | Unit (editor) |
| Native host AI envelopes | Integration (extension ↔ runtime) |
| Full generation flow | E2E (Playwright) |
| Full fix flow | E2E (Playwright) |
| Config file permissions | Unit (runtime) |

## Migration & Rollout (Revised)

1. **Phase 1**: `@rogatio/runtime` AI completion engine + config file I/O
2. **Phase 2**: CLI `ai` subcommands (`setup`, `ls`, `show`, `delete`, `test`)
3. **Phase 3**: CLI edit server AI routes + editor `aiAssist` integration
4. **Phase 4**: Native host AI envelope handling
5. **Phase 5**: Editor AI panel UI + streaming + validation loop
6. **Phase 6**: Extension management page AI status
7. **Phase 7**: Polish, docs, cross-platform verification

Each phase independently testable.

## Open Questions Resolved

| Question | Resolution |
|----------|------------|
| Config storage | Cross-platform config directory (not project-local) |
| Self-contained edit | Yes - AI engine in-process in CLI server |
| Native host AI | Shared module; reads same config file |
| CLI subcommands | `setup`, `ls`, `show`, `delete`, `test` |
| Multiple providers | Start with single provider; extensible to named profiles later |