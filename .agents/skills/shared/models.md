# Shared model selection (sdd · doit · rpi)

Canonical model catalogs and routing for all three workflows. Skills and `AGENTS.md` point here; do not fork tables into skill files.

## Provider tiers

Choose exactly one at workflow start. Carry it through every delegated role. If the user did not specify a tier, ask before delegating.

| Tier | When to use |
| --- | --- |
| **cursor** | Session already runs in Cursor. Preferred default in Cursor. |
| **free** | OpenCode Zen + OpenRouter free catalogs. Preferred outside Cursor. |
| **normal** | Paid OpenCode Go chains (and paid OpenRouter equivalents). |
| **freebuff** | User wants the freebuff coding-agent harness. |

Aliases (accept and normalize to the canonical name above):

- `opencode-zen`, `openrouter` → **free**
- `opencode-go` → **normal**

Prefer **cursor** in Cursor sessions. Outside Cursor, prefer **free**. Do not silently change tiers mid-workflow.

## Cursor catalog (power × price)

Prices are Cursor list rates per 1M tokens (input / output). Power is relative within models the Cursor `task` tool can take as `model`.

Cursor bills two separate monthly pools. Exhausting one does not exhaust the other — always fall across pools (see [Pool exhaustion](#pool-exhaustion)).

| Model slug | Pool | Role fit | Input / Output | Power | Notes |
| --- | --- | --- | --- | --- | --- |
| `claude-fable-5-1-thinking-high` | Other | Frontier+ | ~$10 / $50 | Highest | ~2× Opus; retention approval; **not default** |
| `claude-opus-5-thinking-high` | Other | Reasoning / review | ~$5 / $25 | Very high | Best default for discovery and critique |
| `gpt-5.6-sol-medium` | Other | Agentic / review alt | ~$4 / $20 | High | Different family than Claude |
| `muse-spark-1.3-high` | Other | Mid / cheap | ~$1.25 / $4.25 | Medium | Light Other-pool fallback |
| `cursor-grok-4.6-high-fast` | Cursor Models | Strong Cursor-pool | ~$4 / $12 | High | Cross-pool stand-in for Opus/Sol |
| `composer-2.5-fast` | Cursor Models | Coding | ~$3 / $15 | High (coding) | Best value implement / verify |
| `inherit` | (session) | Session | (session) | Unknown | Only when user forces it |

Do not route Fable unless the user explicitly asks.

## Shared roles

Workflows map their stages/phases onto these roles. Model picks are by **role**, not by workflow name.

| Role | Used for |
| --- | --- |
| `reasoning` | Brainstorm, architecture, specification, research, heavy planning |
| `adversarial` | Adversarial brainstorm, research/plan review (different family from author) |
| `plan` | Implementation plan, lightweight plan, architecture+plan combo |
| `coding` | Tests-first, implementation |
| `verify` | Format/lint/typecheck/tests loops, debug |
| `review` | Independent review, implementation review, final review |
| `docs` | Documentation, refactor candidate write-ups |

## Cursor role routing

Each role: **primary → alt (same pool) → cross-pool**. Walk the chain per [Pool exhaustion](#pool-exhaustion).

| Role | Primary | Alt (same pool) | Cross-pool |
| --- | --- | --- | --- |
| `reasoning` | `claude-opus-5-thinking-high` (Other) | `gpt-5.6-sol-medium` (Other) | `cursor-grok-4.6-high-fast` (Cursor) |
| `adversarial` | `gpt-5.6-sol-medium` (Other) | `muse-spark-1.3-high` (Other) | `cursor-grok-4.6-high-fast` (Cursor) |
| `plan` | `claude-opus-5-thinking-high` (Other) | `gpt-5.6-sol-medium` (Other) | `cursor-grok-4.6-high-fast` (Cursor) |
| `coding` | `composer-2.5-fast` (Cursor) | `cursor-grok-4.6-high-fast` (Cursor) | `gpt-5.6-sol-medium` (Other) |
| `verify` | `composer-2.5-fast` (Cursor) | `cursor-grok-4.6-high-fast` (Cursor) | `muse-spark-1.3-high` (Other) |
| `review` | `claude-opus-5-thinking-high` (Other) | `gpt-5.6-sol-medium` (Other) | `cursor-grok-4.6-high-fast` (Cursor) |
| `docs` | `cursor-grok-4.6-high-fast` (Cursor) | `composer-2.5-fast` (Cursor) | `gpt-5.6-sol-medium` (Other) |

### Pool exhaustion

- **Cursor Models** — Composer, Grok (first-party).
- **Other Models** — Claude, GPT, Muse, Fable, etc.

When spawning a role:

1. Try **Primary**.
2. If the slug is not in the Task allowlist → try **Alt**.
3. If the primary's pool is at max usage → skip every model in that pool for this spawn; use **Cross-pool** immediately.
4. If **Cross-pool** is also unavailable → try any remaining allowlisted slug from the non-exhausted pool that fits the role (reasoning/review → Grok or Sol; coding/verify → Composer or Sol/Muse).
5. If **both pools** are maxed → stop and ask. Options: enable on-demand, switch to **free** / **freebuff**, approve a specific model, or pause. Do not silently burn on-demand.

Remember exhausted pools in conversation state for later stages until the user says usage reset or on-demand is approved.

## Free catalog

OpenCode Zen free:

- `opencode/x-preview-f-free` (Ox Alpha Free)
- `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free)
- `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free)
- `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free)
- `opencode/hy3-free` (Hy3 Free)
- `opencode/mimo-v2.5-free` (MiMo V2.5 Free)
- `opencode/big-pickle` (Big Pickle)

OpenRouter free:

- `openrouter/poolside/laguna-s-2.1:free` (Laguna S 2.1)
- `openrouter/thinkingmachines/inkling-small:free` (Inkling Small)
- `openrouter/dots-studio/dots-3-note-preview:free` (Dots3-Note Preview)

## Free role routing

If primary unavailable, use fallback — never the session model or a paid provider. If both unavailable, stop and ask (switch tier or approve a replacement).

| Role | Primary | Fallback |
| --- | --- | --- |
| `reasoning` | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| `adversarial` | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| `plan` | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |
| `coding` | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| `verify` | `opencode/nemotron-3.5-lightning-free` | `openrouter/poolside/laguna-s-2.1:free` |
| `review` | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| `docs` | `opencode/hy3-free` | `openrouter/dots-studio/dots-3-note-preview:free` |

## Normal (opencode-go) role chains

Prefer an exact or clearly equivalent free OpenCode Zen model before a paid normal model when one exists (`opencode/hy3-free` for `opencode-go/hy3`). Other free models are capability alternatives, not automatic equivalents. Fall through the chain; last resort is the session model only when earlier links are unavailable.

| Role | Chain |
| --- | --- |
| `reasoning` | `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session |
| `adversarial` | `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session |
| `plan` | `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/openai/gpt-5.5` → session |
| `coding` | `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → `opencode-go/kimi-k2.7-code` → session |
| `verify` | `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session |
| `review` | `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/openai/gpt-5.5` → session |
| `docs` | `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session |

For **freebuff**, use that harness's free routing when documented; otherwise follow **free** role routing inside the freebuff session.

## Workflow phase → role maps

Look up the role, then pick the model from the active tier's role table.

### sdd

| Stage | Phase | Role |
| --- | --- | --- |
| 1 | Brainstorm (primary) | `reasoning` |
| 1 | Adversarial brainstorm | `adversarial` |
| 2 | Architecture | `reasoning` |
| 3 | Specification | `reasoning` |
| 4 | Human review gate | _(no model)_ |
| 5 | Implementation plan | `plan` |
| 6 | Tests first | `coding` |
| 7 | Implementation | `coding` |
| 8 | Verification and tests | `verify` |
| 9 | Independent fresh-context review | `review` |
| 10 | Documentation | `docs` |
| 11 | Release actions | _(no model; user auth)_ |

### doit

| Stage | Phase | Role |
| --- | --- | --- |
| 1 | Brainstorm and scope (primary) | `reasoning` |
| 1 | Adversarial pass | `adversarial` |
| 2 | Architecture note and lightweight plan | `plan` |
| 3 | Tests first | `coding` |
| 4 | Implementation | `coding` |
| 5 | Verification and tests | `verify` |
| 6 | Independent fresh-context review | `review` |
| 7 | Documentation | `docs` |
| 8 | Release actions | _(no model; user auth)_ |

### rpi

| Phase | Role |
| --- | --- |
| Research | `reasoning` |
| Research review | `adversarial` |
| Plan | `plan` |
| Plan review | `adversarial` |
| Implementation | `coding` |
| Verify | `verify` |
| Implementation review | `review` |
| Final review | `review` |
| Refactor | `docs` |
| Commit / human gates | _(no model; user auth)_ |

## No-retention rule

OpenCode Zen / Go selections under **free** and **normal** must avoid models that retain or train on data. Prefer free no-retention IDs.

For **cursor**: do not use `claude-fable-5-1-thinking-high` without explicit user approval.

If a role's full chain is unavailable (allowlist miss, both Cursor pools exhausted, or only retaining models left), stop and ask. Do not silently substitute.

## Verification

- **cursor**: confirm slug is on the Task `model` allowlist; walk primary → alt → cross-pool.
- **free** / **normal** / **freebuff**: at workflow start, run `opencode models` (or harness equivalent) and confirm IDs. If unavailable, user must confirm reachability before delegation.

A model report is not verification evidence; required repo commands still run for real.

## Passing the model to a subagent

### cursor

Pass the slug via the Task tool `model` parameter:

```
task(
  model: "composer-2.5-fast",
  subagent_type: "generalPurpose",
  ...
)
```

### free / normal / freebuff

Prefix the prompt with the model ID:

```
[model: opencode/nemotron-3-ultra-free]

You are running <phase> for the <workflow> workflow...
```

Resolve ID from: workflow phase → role → active tier's role table. Do not hardcode IDs in phase files.

## Recording

Record in conversation state (and the workflow log when the skill writes one):

- Provider tier (canonical name).
- Per-phase/role model used (and whether primary, alt, cross-pool, or chain fallback).
- Exhausted Cursor pools, if any.
- Explicit approvals for on-demand usage, retaining models, or premium models (e.g. Fable).
