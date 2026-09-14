# Workflow: inline install-command copy icon

Workflow: `doit`. Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/inline-install-copy-icon` (branch `feature/inline-install-copy-icon`).

## Tier and models

Tier: `cursor-models` (user request; not the free/normal OpenCode chains).

| Phase | Model |
| --- | --- |
| Brainstorm | gpt-5.6-sol-medium |
| Adversarial | cursor-grok-4.6-high-fast |
| Architecture + plan | claude-fable-5-1-thinking-high |
| Tests + implementation | composer-2.5-fast |
| Verification | muse-spark-1.3-high |
| Independent review | claude-opus-5-thinking-high (PASS, round 1) |

## Locked decisions

1. Wrap install `<code>` + copy button in a flex `nowrap` row; icon immediately right of command.
2. Reuse glyph `⧉` + `.rogatio-copy-icon`; `aria-label` and `title` = "Copy install command".
3. `data-command="copy-install-command"` and `copyInstallCommand()` unchanged.
4. Do not use leftover `.rogatio-install-command` CSS as-is (flex-wrap + negative margin; `.rogatio-runtime-guidance code { display: block }` would push the icon below). Rewrite it to the `.rogatio-extension-id-row` pattern and override `code` display only inside the row.
5. Playwright keeps `getByRole("button", { name: "Copy install command" })`; minimal test touch, optional same-row assertion.
6. Out of scope: SVG icons, shared abstractions, frozen docs, `docs/architecture.md`, clipboard logic.

## Acceptance criteria

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC-001 | Failed runtime guidance shows install command and icon button inline, icon immediately right of command | `.rogatio-install-command` flex nowrap row wraps `code` + `.rogatio-copy-icon`; browser test same-row assertion passes |
| AC-002 | Button visible content is `⧉`, not "Copy install command" | `toHaveText("⧉")` in extension.spec.ts; `button("⧉", …)` in extension-page-entry.ts |
| AC-003 | Accessible name remains "Copy install command" (+ `title`) | `aria-label` + `title` set; `toHaveAttribute("title", …)`; `getByRole("button", { name: "Copy install command" })` still resolves |
| AC-004 | Click copies exact install command (existing behavior) | Clipboard + status assertions unchanged and pass |
| AC-005 | Long command wraps/shrinks without overlapping icon | CSS: `.rogatio-install-command code { flex: 1 1 auto; min-width: 0; display: inline-block; overflow-wrap/word-break }`; `.rogatio-copy-icon { flex: none }` |
| AC-006 | Extension-ID copy control unchanged | No edits to extension-ID row (~L361–371); copy-extension-ID assertions still pass |
| AC-007 | Browser test passes with accessible role/name | `pnpm exec playwright test test/browser/extension.spec.ts` — 6 passed |
| AC-008 | `pnpm validate` passes | `pnpm validate` — format, lint, typecheck, build, vitest (725), playwright (25 passed, 3 skipped) |

## Log

- Plan written: `plan.md` (architecture note + 5 ordered steps). Files in scope: `packages/extension/src/extension-page-entry.ts`, `packages/extension/src/extension.css`, `test/browser/extension.spec.ts`.
- Tests first: added `⧉` text, `title`, and `.rogatio-install-command` same-row assertions to runtime-failure journey in `extension.spec.ts`.
- Implementation: runtime-failed guidance now renders install command in `.rogatio-install-command` row with `⧉` copy icon (mirrors extension-ID pattern at L367–371); `copyInstallCommand()` and `data-command` unchanged.
- CSS: rewrote `.rogatio-install-command` / `code` to extension-ID-row semantics (flex nowrap, no negative margin, code flex-shrink + wrap override).
- Verify: `pnpm build` OK; `pnpm exec playwright test test/browser/extension.spec.ts` — 6 passed (red→green not captured; implementation landed in same pass after test authoring).
- Stage 5 (muse-spark): AC-001..006 mapped to file:line; scope clean (3 source files + decision docs).
- Stage 5/6 (opus review, independent re-run): `pnpm validate` green — 725 vitest, 25 playwright passed / 3 skipped; extension.spec alone 6 passed. REVIEW PASSED round 1.
- Stage 6 nits (non-blocking, not fixed): `display: inline-block` on flex item is inert; `overflow-wrap` on row code duplicates guidance rule; row geometry not asserted visually.
- Stage 7: no README/architecture/AGENTS updates (button text not documented; locked out of architecture.md).
- Stage 8: awaiting user auth for commit/push/PR (+ open issue `#NN`).
