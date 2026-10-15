> Status: frozen 2026-10-14

# Test console modal

Audience: hybrid.

## Architecture note

- The editor keeps project and group routes. Test console is overlay state, not a route.
- The rail control sits left of search. Validate, Cancel, and Save sit on the project title row. AI Assist stays with those actions when the host supplies it.
- The group-page ledger still repeats project actions. The dialog does not.
- Close, Escape, and the backdrop dismiss the dialog. A rule link closes it and opens that rule. A field diagnostic closes it and focuses the field.

## Plan

1. Put Console left of search in `packages/editor/src/editor.ts` and drop the command bar.
2. Move Validate, Cancel, and Save onto the title row.
3. Render the existing test panel inside a large dialog. Keep the page underneath.
4. Cover the layout in `packages/editor/test/` and `test/browser/editor.test.ts`.
5. Update the living editor docs to match the dialog.
