# Model selection

The user picks a provider tier at workflow start. The per-phase routing table picks the model within that catalog.

## Provider tiers

- **opencode-go** — paid OpenCode Go models. Use only when the user explicitly chose this tier. Avoid data-retention or data-training models.
- **opencode-zen** — free OpenCode Zen models. Preferred when available.
- **openrouter** — OpenRouter free models. Use the `free` suffix where possible.
- **freebuff** — the freebuff coding agent harness. Use when the user wants freebuff to drive the workflow.

If the user did not specify a tier, ask before delegating any work.

## Per-phase routing (free tier)

| Phase | Primary | Fallback |
| --- | --- | --- |
| Research | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Research review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Final review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Refactor | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |

The implementer uses a cheaper model. Planning, review, and refactor use stronger reasoning models. The implementer and its reviewer use different models where possible to avoid correlated blind spots.

## No-retention rule

OpenCode Zen and OpenCode Go models must be free. Avoid models that retain data or train on data.

If a phase's primary and fallback are both unavailable, or both retain data, stop and ask the user. Do not silently substitute. The user may:

- Switch provider tier.
- Explicitly approve a retaining model for that one phase.
- Pause the workflow.

## Verification

At workflow start, run `opencode models` to confirm the chosen tier's model IDs are available. Record the result in conversation state. If `opencode models` is not available, the user must confirm the model IDs are reachable before delegation.

## Passing the model to a subagent

When the skill spawns a subagent via the `task` tool, prefix the prompt with the model ID. Example:

```
[model: opencode/nemotron-3-ultra-free]

You are running a research phase for the RPI workflow...
```

The model prefix is read from this file's routing table, not hardcoded in the phase files.

## Recording

In conversation state, record:

- Provider tier.
- Per-phase model used.
- Per-phase fallback used, if any.
- Any explicit user approvals for retaining models.

This state lives in the conversation, not on disk, unless the user asks for a workflow log.
