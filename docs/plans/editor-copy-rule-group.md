> Status: frozen 2026-09-20

# Editor copy rule / copy group — plan

Audience: hybrid  
Issue: #196  
Workflow: doit

## Architecture note

- Ownership stays in `packages/editor`: private `copyRule` / `copyGroup`, `dispatchCommand` cases, UI buttons. No schema, CLI, or extension API change.
- Reuse `snapshotOwnData` (soft fail), `nextId`, `markChanged`, focus/route patterns from `addRule` / `addGroup`.
- IDs use short `"rule-new"` / `"group-new"` prefixes so copies stay within `LIMITS.maxIdLength`. Name suffix is length-gated by `LIMITS.maxLabelLength`.
- `copyGroup` clones once and remaps every nested rule id before push; it must not call `copyRule` (would push into the source group).
- Entity actions stay next to content (architecture command-bar policy): Copy beside Remove on group surfaces; Copy rule in `dataset.ruleActions`.

## Ordered tasks

1. **Helpers + `copyRule`** (`packages/editor/src/editor.ts`) — Soft-clone rule; assign `nextId("rule-new")`; length-safe name; insert after source; focus name; status; guard `saving`. Covers AC-196-01, AC-196-03. Prove via unit test.
2. **`copyGroup`** (`editor.ts`) — Soft-clone group; new group id; remap each rule id (keep rule names); length-safe group name; insert after source; navigate + focus; one `markChanged`/`render`. Covers AC-196-02, AC-196-03. Prove via unit test.
3. **Wire commands + UI** (`dispatchCommand`, `renderProject` group row, `renderGroup` heading, `renderRule` actions) — `copy-rule` / `copy-group`; disable while `saving`; aria-labels on overview Copy group. Covers AC-196-05.
4. **Unit tests** (`packages/editor/test/copy.test.ts`) — Happy paths, unique ids across project, mutate nested origins/action on copy and assert source unchanged, name suffix ≤100 / skip when overflow, soft-clone no-crash optional. Covers AC-196-01/02/04.
5. **Browser journey** (`test/browser/editor.test.ts`) — Extend CRUD test or add focused test: Copy rule after source; Copy group; assert new cards/ids. Covers AC-196-05.
6. **Docs** — Update `docs/architecture.md` entity-actions sentence to include Copy; skim package README if it lists CRUD actions.
