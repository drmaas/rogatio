# Implementation Plan — Group Activation Visibility + Attention Explanation

## Approved scope (from spec f-group-activation-visibility.md)
- No per-rule enable/disable change (group-level only preserved).
- Presentational changes in `packages/extension/src/extension-page-entry.ts` and related CSS.

## Tasks (in order)

### T1 — Sidebar group activation visibility (REQ-GAV-001, AC-GAV-003)
File: `packages/extension/src/extension-page-entry.ts` (function `renderSidebar`)
- Add visual distinction to active vs inactive group activation checkboxes (use design-system tokens: active = `--rogatio-success` / primary accent, inactive = muted/neutral).
- Preserve existing `data-groupToggle` event behavior.
- Preserve accessibility (label association, keyboard operable).

### T2 — Badge/status explanation (REQ-GAV-004, AC-GAV-004)
File: `packages/extension/src/extension-page-entry.ts` (function `renderTopbar`, badge text; status message area)
- When `state.badge?.attention` is true, include the reason (e.g., "needs permission") and a concise fix step referencing the sidebar actions (e.g., "Grant declared access").
- Keep badge text concise (fit in pill); use `statusMessage` or sidebar `permissionSummary` for longer explanation.
- Preserve existing `aria-live` status region behavior.

### T3 — Link attention to permission summary (REQ-GAV-005, AC-GAV-005)
File: `packages/extension/src/extension-page-entry.ts`
- When attention is due to `needs permission`, make the sidebar `permissionSummary` and `groupToggle` state clearly indicate the missing permission path (existing `permissionSummary` shows origins needed; enhance if needed with a reference to the grant button).
- No new dependencies.

### T4 — Design-system consistency (REQ-GAV-007)
Files: `packages/extension/src/extension-page.css` / `packages/extension/src/extension.css` (depending on build output)
- Use only existing design-system tokens (`--rogatio-success`, `--rogatio-warning`, `--rogatio-primary`, surfaces, borders).
- No new colors or fonts.

### T5 — Verification (Stage 8)
- Run `pnpm validate` (canonical validation command from repo).
- Confirm existing browser tests for group toggle and badge remain green.
- Confirm no forbidden MV3 patterns added.

## Acceptance criteria covered
- AC-GAV-001 (sidebar visible state)
- AC-GAV-002 (badge/status explanation with fix steps)
- AC-GAV-003 (group-level preserved, no per-rule toggle change)
- AC-GAV-004 (no new dependencies, design tokens only)
- AC-GAV-005 (existing behavior preserved)
