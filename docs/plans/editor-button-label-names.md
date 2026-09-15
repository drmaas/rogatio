> Status: frozen 2026-09-14

# Plan: editor button/label name cleanup

**Base:** `dc3bacd` (main) · **Branch:** `fix/editor-button-label-names`  
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/fix-editor-button-label-names`  
**Tier:** cursor

## Architecture note

- Change lives only in `packages/editor` DOM render strings (`editor.ts`).
- Button/label accessible names are public UI contracts consumed by Playwright selectors.
- Confirmation dialogs keep entity names (identity needed before destructive confirm); toolbar/field chrome does not.
- Rule cards name themselves via `aria-labelledby` on the article → position-stable `h3` id (`${instanceId}-rule-title-${groupIndex}-${ruleIndex}`), so short shared button/label text still has per-rule screen-reader context without depending on editable group/rule id strings.
- No schema, compiler, storage, or package-boundary change.

## Behavioral notes / acceptance

- **AC-001** Group command-bar buttons: `Move group up`, `Move group down`, `Remove group` (no group name).
- **AC-002** Rule card buttons: `Move rule up`, `Move rule down`, `Remove rule` (no rule name).
- **AC-003** Rule field labels drop `for {ruleName}`: Rule ID, Rule name, URL regular expression, Priority, Method.
- **AC-004** Fieldset legends drop rule name: `Rule type`, `Resource types`.
- **AC-005** Confirm dialogs and status messages still name the entity (unchanged).
- **AC-006** Browser tests use the simplified accessible names.

## Plan

1. Update `test/browser/editor.spec.ts` selectors for new button/label names (AC-001–003, AC-006).
2. Strip name interpolation from group/rule command buttons and rule field labels/legends in `packages/editor/src/editor.ts` (AC-001–004); drop unused `ruleName` param on `renderResourceTypes` if unused.
3. Run editor-focused browser tests, then `pnpm validate`.
4. Fresh-context review; docs only if user-facing README mentions these strings (unlikely).
