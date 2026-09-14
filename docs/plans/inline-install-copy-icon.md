# Plan: inline install-command copy icon

## Architecture note

- Change is confined to the `packages/extension` management-page boundary: `extension-page-entry.ts` (runtime-guidance render) and `extension.css`. No compiler, browser-core, runtime, or clipboard changes.
- Reuse the existing Extension-ID copy pattern (`.rogatio-copy-icon`, glyph `⧉`, `aria-label` + `title`) so both copy controls share one visual/accessibility idiom without introducing a shared abstraction.
- The unused `.rogatio-install-command` CSS class is rewritten (not reused as-is) into a `flex; flex-wrap: nowrap` row mirroring `.rogatio-extension-id-row`. `.rogatio-runtime-guidance code { display: block }` is overridden only inside the row (`.rogatio-install-command code { display: inline-block; flex: 1 1 auto; min-width: 0; }`) so the icon stays right of the command.
- `data-command="copy-install-command"`, `copyInstallCommand()`, and `[data-runtime-install-command]` are unchanged; the Playwright locator `getByRole("button", { name: "Copy install command" })` keeps working via the preserved accessible name.

## Ordered plan

1. **Test first (browser).** In `test/browser/extension.spec.ts` (runtime-failure journey, ~L185), keep the existing `getByRole("button", { name: "Copy install command" })` click/clipboard assertions. Add minimal assertions: button visible text is `⧉`; button has `title="Copy install command"`; button and `[data-runtime-install-command]` share the same parent `.rogatio-install-command` row. Run to confirm it fails before implementation.
2. **Render change.** In `packages/extension/src/extension-page-entry.ts` (~L753–760): create `const row = document.createElement("div"); row.className = "rogatio-install-command";`; build the button as `button("⧉", "copy-install-command")`, set `className = "rogatio-copy-icon"`, `aria-label` and `title` to `"Copy install command"`; `row.append(guidanceCommand, copyButton); guidance.append(row);`. Follow the `copyId` construction at ~L367–370 exactly.
3. **CSS.** In `packages/extension/src/extension.css` (~L345–361): rewrite `.rogatio-install-command` to `display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 0.35rem; min-width: 0;` (drop the negative margin; the guidance grid `gap` already spaces it). Rewrite `.rogatio-install-command code` to add `flex: 1 1 auto; min-width: 0; display: inline-block;` alongside the existing mono/inset/border styling and `overflow-wrap: anywhere` so long commands wrap inside the code box, never under the icon. `.rogatio-copy-icon` already sets `flex: none`.
4. **Verify.** Build (`rtk pnpm build`), run the extension browser spec (`rtk playwright test test/browser/extension.spec.ts`), then `rtk pnpm validate`. Record AC evidence in `workflow.md`.
5. **Docs sync.** Only if `packages/extension/README.md` describes the install-command copy button text; otherwise no doc changes (architecture.md and frozen records are out of scope).
