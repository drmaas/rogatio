# Workspace group enable — plan

Audience: hybrid

## Architecture note

- **Host only:** `packages/extension/src/extension-page-entry.ts` (+ CSS if needed). Reuse `setGroupEnabled` → `set-group-enabled`. No editor API, no browser-core invariant change.
- **Discoverability:** Move the existing Group activation fieldset to sit immediately after the active-project card, before runtime actions and secondary chrome.
- **Dirty-safe refresh:** After a successful enablement change, reload envelope state. If `editor?.isDirty()`, replace sidebar + update badge/status only (leave `[data-editor-root]` mounted). Otherwise call existing `refresh()` / `renderShell()`.
- **Rejected:** Editor enablement port (CLI has no DNR lifecycle); persist enablement on save (F4/F7 invariant → sdd); third toggle surface in the draft Groups list.

## Ordered tasks

1. **Extract enablement-refresh helper** (`packages/extension/src/workspace-enablement-refresh.ts`): `shouldRemountEditorAfterGroupEnablement(dirty: boolean)` — unit-tested. Covers AC-003/AC-004 decision seam.
2. **Promote Group activation in sidebar** (`extension-page-entry.ts` `renderSidebar`): render fieldset right after project card; keep `data-group-toggle` / `data-group-id` and active/inactive classes. Covers AC-001. Prove with browser assert on vertical order.
3. **Soft chrome update path** (`extension-page-entry.ts`): after `set-group-enabled` + envelope refresh, if dirty → patch sidebar/badge/status without `editor.destroy()`; else full remount. Covers AC-002–AC-004.
4. **Tests:** unit for helper; browser/workspace journey for order + dirty preserve (extend design-system or focused Selenium test). Covers AC-001–AC-004.
5. **Docs:** update `docs/architecture.md` Workspace sidebar order line. Covers AC-005 documentation. Then `pnpm validate` (AC-006).

## Verification

- `pnpm vitest run packages/extension/test/workspace-enablement-refresh.test.ts` (or package filter)
- Relevant browser test for Workspace group activation order / dirty toggle
- `pnpm validate`
