# Feature: Group Activation Visibility and Attention Explanation

**Status:** Draft (Stage 3 — Specification)
**Scope:** Presentational improvement to the Chrome extension management page (`packages/extension/src/extension-page-entry.ts` + `packages/extension/src/extension.css`). No product behavior, no new public API, no per-rule enable/disable change.

## 1. Problem Statement and Goals

Users activate a group (`grp-sample`) but see:
- Badge: `Active rules: 0 (attention needed)` — unclear why attention is needed.
- Sidebar group activation checkbox: no visual active/inactive distinction beyond checked/unchecked.
- Small bottom-left list (`grp-sample/rule-redirect: needs permission`) — buried; no link to fix steps.
- No explanation connecting attention → rules need permission → click "Grant declared access".

Goals:
- Make group active/inactive state clearly visible (visual distinction in sidebar).
- Make the badge/status message explain the attention reason with a fix step.
- Preserve all existing behavior (group-level enablement, permission flow, design-system tokens, accessibility).

## 2. Scope and Non-Goals

**In scope:**
- Sidebar group activation section visual improvement (active = highlighted/accented, inactive = muted).
- Badge/status message improvement: explain attention reason concisely (e.g., "needs permission — grant access" or "needs proxy — start runtime").
- Keep existing checkbox behavior (`data-groupToggle` event handler) unchanged.

**Non-goals (explicit):**
- No per-rule enable/disable toggle (group-level only remains).
- No new rules, actions, or schema changes.
- No new design-system tokens or colors.
- No new network/storage/telemetry behavior.
- No change to popup (`f21`) or editor (`f5`) behavior.

## 3. Actors, Entry Points, Supported Environments

- **Actor:** Chrome extension user viewing the management page (`index.html`) workspace.
- **Entry point:** Extension page entry (`packages/extension/src/extension-page-entry.ts`) renders sidebar and badge.
- **Environment:** Chrome MV3, current dark design system (`packages/extension/src/extension.css`), same build/test pipeline.

## 4. Design Tokens (Existing — No Change)

Use existing `f22` tokens:
- Success/active: `--rogatio-success` (`#4ADE80`)
- Warning/attention: `--rogatio-warning` (`#FBBF24`)
- Surface raised: `--rogatio-surface-raised` (`#1C222C`)
- Neutral: `--rogatio-neutral` (`#1E293B`)
- Primary accent: `--rogatio-primary` (`#007AFF`)

No new tokens. No new colors.

## 5. Functional Requirements (REQ-IDs)

### Sidebar Group Activation Visibility
- **REQ-GAV-001:** Each group in `GROUP ACTIVATION` shows a clear active/inactive visual state.
  - Active (checked, in `enabledGroupIds`): checkbox + label highlighted with `--rogatio-success` tint or primary accent border; label text remains readable.
  - Inactive (unchecked, not in `enabledGroupIds`): muted (`--rogatio-muted` or `--rogatio-neutral` surface), no success tint.
- **REQ-GAV-002:** Preserve existing checkbox `data-groupToggle` event behavior (sends `set-group-enabled` to service worker).
- **REQ-GAV-003:** Preserve accessibility: checkbox remains native `input[type="checkbox"]`, label remains native `label`, no drag-and-drop.

### Badge / Status Message Attention Explanation
- **REQ-GAV-004:** When `badge.attention === true`, the badge pill text explains the reason concisely and points to the fix.
  - Example patterns (derived from `ruleStatuses`):
    - Rules need permission: `"0 active (needs permission — grant access)"`
    - Rules unsupported (future): `"0 active (unsupported — no action)"`
    - Rules need proxy (future): `"0 active (needs proxy — start runtime)"`
    - Mixed attention: show the highest-precedence reason (same precedence as `f21`: `error > needs proxy > needs permission > unsupported > active`).
- **REQ-GAV-005:** The explanation must be brief (fits in pill/line) and safe (no raw user data, no untrusted text interpolation into HTML — use text nodes, same as current `extension-page-entry.ts`).
- **REQ-GAV-006:** The status line (`.rogatio-status`) should optionally echo the same explanation or link to the fix action (e.g., reference the permission summary or action buttons). Keep it minimal to avoid overload.

### Compatibility and Constraints
- **REQ-GAV-007:** No change to `packages/extension/src/service-worker.ts`, `popup-model.ts`, or popup (`f21`).
- **REQ-GAV-008:** No new dependencies; no change to build pipeline besides normal CSS/JS updates.
- **REQ-GAV-009:** All `data-*` attributes (`groupToggle`, `permissionSummary`, `badgeState`, `ruleStatuses`) preserved.

## 6. Acceptance Criteria (AC-IDs)

- **AC-GAV-001:** A group in `enabledGroupIds` renders with a visible active-state highlight; an inactive group does not. (Verified by visual inspection + browser smoke test if needed.)
- **AC-GAV-002:** Badge with `attention=true` includes a brief explanation string linking attention to the required user action (`needs permission` → grant access, etc.).
- **AC-GAV-003:** Existing keyboard interaction (checkbox toggle), event handling (`change` → `setGroupEnabled`), and screen-reader announcements (`aria-live` status) remain intact.
- **AC-GAV-004:** No unrelated files edited; only `packages/extension/src/extension-page-entry.ts` and optionally `packages/extension/src/extension.css` changed.
- **AC-GAV-005:** `pnpm validate` passes (format, lint, typecheck, build, tests).

## 7. Security, Privacy, Accessibility, Performance

- **Security:** No new user input surfaces; existing defensive snapshot behavior preserved (`snapshotOwnData` in editor, safe text nodes in extension page). No user-controlled regex or HTML interpolation.
- **Privacy:** No telemetry, no network, no storage change beyond existing `enabledGroupIds`.
- **Accessibility:** Native checkbox + label preserved; visible state not color-only (add text/style distinction, not rely solely on color). Forced-colors and 200% zoom remain functional.
- **Performance:** Minimal DOM change; no full-document replacement required; same bounded update pattern.

## 8. Migration, Rollout, Backward Compatibility

- No data/model migration (`enabledGroupIds` unchanged).
- Backward compatible: existing group toggles and permission flows unchanged.
- Rollback: revert `extension-page-entry.ts` and `extension.css` changes.

## 9. Open Questions and Assumptions

- Assumption: The design improvement is presentational only; no new product feature required.
- Open: Should the explanation also appear in the sidebar `GROUP ACTIVATION` legend or as a helper line? (Can be decided during implementation; spec allows either brief badge explanation + optional sidebar note.)
- Confirmed: Group-level activation only; no per-rule toggle.
