# Plan — dashboard-runtime-ai

> Status: frozen 2026-10-04

> Audience: hybrid
> Status: draft for review
> PRD: `docs/decisions/dashboard-runtime-ai/prd.md`
> Research: `docs/decisions/dashboard-runtime-ai/research.md`

## Implementation strategy

TDD — existing unit + browser harnesses cover every phase/state, so failing tests first is cheap.

## Goal

Render the same runtime/AI truth already shown in the Workspace sidebar on the Dashboard tab, with working Start/Stop + diagnostics entry, so the disabled Create using AI state is explainable and fixable without leaving the Dashboard. Reuse existing commands and state (`refresh`, `check-ai-support`, `runtimeControlDisabled`, `runtimeStatusText`); no new lifecycle, permissions, storage keys, or network calls.

## Non-goals

- No new runtime lifecycle or host install flow changes.
- No AI provider setup UI (CLI `ai setup` + host own that).
- No Workspace sidebar behavior change (sidebar keeps existing markup/hooks).
- No popup changes; no new permissions, storage keys, or network calls.

## Architecture

ADR candidates (title + choice):

- Dashboard status placement → new `System status` dashboard-card above `Start a project`, before the creation section, so the gate explanation precedes the gated button.
- Card markup reuse → extract shared private runtime/AI body builders in `extension-page-entry.ts` parameterized by surface; sidebar keeps `createSidebarCard` + `data-card` hooks, dashboard uses new `data-dashboard-section="system-status"` hooks so sidebar browser-test selectors keep meaning sidebar-only.
- Runtime card fullness → full card (Start/Stop + status line + extension ID + copy + diagnostics entry; error + recovery text only on `failed`/`unsupported`), matching PRD scope, sharing `nativeRuntimeCommand`, `showDiagnostics`, `runtimeControlDisabled`, `runtimeStatusText`/`runtimeStatusTone`.
- Live region → `aria-live="polite"` + `role="status"` on the new dashboard status lines (sidebar lines are plain `<p>` today; new surface sets the pattern without changing sidebar markup).
- Styling → reuse F22 dashboard-card tokens + existing tone-dot classes; responsive collapse and forced-colors follow the existing dashboard-card rules.

## Phases

- Phase 1 — shared builders (checklist §1): TDD unit tests first, then extract runtime/AI body builders; no visual change; `pnpm validate`.
- Phase 2 — dashboard surface (checklist §2): TDD render tests first, then `renderOverview` system-status card + CSS + a11y wiring; `pnpm validate`.
- Phase 3 — tests + validate (checklist §3): dashboard status browser suite (Start/Stop + diagnostics + AI enable flow), `pnpm validate`.

## Risks

- Duplicating sidebar card logic instead of extracting → Dashboard/Workspace truth drifts; mitigated by shared builder funcs + shared `runtimeControlDisabled`/`runtimeStatusText`.
- Reusing `data-card` hooks → sidebar browser tests become ambiguous; mitigated by new `data-dashboard-section` hooks (sidebar selectors untouched).
- Focus loss on `refresh` rebuild → mitigated by keeping `renderShell` focus-restore path and not changing the dirty-editor guard.
- Key leak via provider lines → mitigated by copying only `providerUrl` + `model` (existing `checkNativeAISupport` behavior) and asserting absence in tests.
- Dashboard buttons missing shell delegated dispatch → new controls must live inside the shell handler subtree (`renderOverview(main)` output); anything mounted outside (like the diagnostics overlay) needs direct listeners.
- Focus-restore ambiguity from shared `data-command` values → safe because sidebar (workspace-only) and the dashboard card never co-render; `restoreSidebarFocus` resolves the single instance.

## Acceptance criteria

1. Dashboard shows a `System status` card above `Start a project` with Runtime status + Start/Stop and AI status; key string never appears in DOM (checklist §2, verified §3 browser).
2. AI status covers all four states with precedence needs-runtime > Configured + provider/model > not reported > Not configured; partial provider/model renders not reported (checklist §1–§2, verified §3 unit + browser).
3. Create using AI `disabled` equals `!aiSupported` on every `refresh`, matching the Dashboard AI card truth (checklist §2, verified §3 browser gate-agreement).
4. Start/Stop/diagnostics/copy on Dashboard call the same handlers + `runtimeControlDisabled` as Workspace for phases stopped/starting/started/failed/unsupported/error; `refresh` updates Dashboard without switching `data-view` (checklist §2, verified §3 browser Start/Stop + diagnostics flow).
5. Styling uses dashboard-card language + F22 tokens; status lines expose `aria-live="polite"` + `role="status"`; focus-visible, forced-colors, 360px width, and 200% zoom hold without overlap (checklist §2, verified §3 browser).
6. Unit (builders + disabled logic + render/state mapping) and dashboard-status browser suite pass; `pnpm validate` passes per phase with evidence logged (checklist §1–§3).

## Contracts

Skipped — no `docs/contracts.md` for this feature (no cross-boundary contract change; existing `refresh`/`check-ai-support`/`diagnose-native-runtime` shapes unchanged).
