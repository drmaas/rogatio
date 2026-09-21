> Status: frozen 2026-09-20

# AI Assist hosts — behavioral notes

Audience: hybrid

## Outcome

CLI `rogatio edit` and extension Workspace Assist produce a validated rule proposal using configured provider settings. Extension uses native messaging, not the CLI edit server.

## Locked decisions (Stage 1)

1. No new native `ai.assist` envelope — reuse `ai.complete` + SW `ai-assist` (generate-project pattern). Avoids 64 KiB / body-key protocol expansion vs frozen REQ-006.
2. New CLI `POST /api/ai/assist` returning JSON `{ proposal }`. Leave `/api/ai/complete` and `/api/ai/stream` as raw proxies. Editor uses Promise `AIAssistResponse` (tokens absent in v1).
3. Fix `runAIAssist` proposal→project merge (`kind`→rule `type`, insert into `groups[groupId].rules`) before hosts call it with real schema validate.
4. Extension: SW one-shot validate (no 3-attempt loop). Note residual in PR.
5. Frozen specs under `docs/specs|plans|workflows|research` untouched.

## Acceptance checks

| ID | Check |
| --- | --- |
| AC-001 | CLI Assist via `runAIAssist` returns validated proposal |
| AC-002 | CLI uses `provider.json` model (server-side), not hardcoded client model |
| AC-003 | Response matches editor `AIAssistResponse` / final `proposal` |
| AC-004 | CSRF required; unconfigured → 404 `ai-not-configured` |
| AC-005 | Focused CLI route tests for assist contract |
| AC-006 | Workspace `createEditor` gets `aiAssist` when AI available |
| AC-007 | Create/fix Assist through SW → native `ai.complete` (unit-mockable) |
| AC-008 | Extension never calls CLI loopback HTTP |
| AC-009 | architecture / README / docs-site match shipped behavior |
| AC-010 | `pnpm validate` passes |

## Non-goals

- Re-fix Create-using-AI gate (#207)
- Re-implement editor panel (#208)
- CLI “create whole project from prompt”
- Browser e2e AI journeys
- Finishing `requestAIStream`
- Rewriting frozen AI integration spec
