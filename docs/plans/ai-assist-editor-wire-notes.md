> Status: frozen 2026-09-20

# AI Assist editor wire — behavioral notes

Audience: hybrid. Issue #208 (Phase B1).

## Outcome

Shared editor AI Assist panel invokes host `options.aiAssist`, streams into the panel, and Apply writes proposals onto real draft rule fields. Hosts (#209) stay out of scope.

## Acceptance

| ID | Check |
| --- | --- |
| AC-001 | Send builds `AIAssistRequest` (`generate` or `fix` from diagnostics) and calls `options.aiAssist` |
| AC-002 | Token chunks update panel; error chunks surface in panel |
| AC-003 | Done/complete proposal Apply → `applyAIProposal` updates draft |
| AC-004 | `applyAIProposal` maps `redirect`, `query`, `header`, `response-body`, `requestBody`/`request-body` to real DraftRule / schema fields including `type` |
| AC-005 | Unit tests: send → handler; apply maps kinds; mock `aiAssist` drives panel |
| AC-006 | `pnpm validate` passes |

## Non-goals

CLI `/api/ai`, extension `aiAssist` host (#209), Create-using-AI gate (#207), frozen spec rewrite, new providers.

## Field map (kind → draft)

| RuleProposal.kind | `type` | Payload |
| --- | --- | --- |
| `redirect` | `redirect` | `redirect` ← `action` |
| `query` | `query` | `action` ← `action` |
| `header` | `header` | flat `headerDirection` / `headerOperation` / `headerName` / `headerValue` from `action` (accept schema keys or short `direction`/`operation`/`name`/`value`) |
| `response-body` | `response-body` | `responseBody` ← `action` |
| `request-body` | `request-body` | `requestBody` ← `action` |

## Risks

- Untrusted `action`: header flatten uses own-key string reads only; other kinds pass `action` through `snapshotOwnData` before assign; skip `__proto__` / `constructor` / `prototype` via existing snapshot rules.
- Concurrent Send: panel ignores while in-flight (disable Send).
- Panel streaming helper must accumulate tokens (`streamingContent +=`).
