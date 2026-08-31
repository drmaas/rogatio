# F25 Workflow Log — Popup Larger Surface + Project Entry Actions

## Scope and Approval

- **Feature:** F25 — toolbar popup: fixed 420px surface, larger type scale, internally
  scrolling group list, and New project / Import project entry actions. Supersedes the
  F21 popup non-goal "no create/import" for the popup surface only; all other F21
  non-goals remain in force.
- **Branch:** `feature/popup-project-actions`
- **Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/popup-project-actions`
- **Base commit:** `main` at `55afe1e`
- **Tracking issue:** #52 (created automatically for the commit-msg hook reference)
- **Approval:** the user requested the change directly (popup too small; needs
  create/import entry actions) and authorized commit, push, and PR ("commit push pr");
  merge and cleanup followed the user's confirmation that the PR was merged.

## Model and Tier

- **Tier:** single-model session; no subagent delegation. Spec, tests, implementation,
  verification, and documentation passes were performed inline by the session model with
  distinct role passes; the commit hook's Biome check and `pnpm validate` served as the
  independent gates. No brainstorm files were retained (ephemeral by policy).

## Stage Status

- [x] Stage 0 — isolated worktree `feature/popup-project-actions` from `main` @ `55afe1e`
- [x] Stage 1 — brainstorm condensed into issue #52 (problem, goal, constraints); nothing
  ephemeral retained in the repo
- [x] Stage 2 — architecture updated (`docs/architecture.md` F25 popup paragraph); no
  structural change — both actions reuse the existing `create-project`/`import-project`
  service-worker lifecycle unchanged
- [x] Stage 3 — specification: `docs/specs/f25-popup-project-actions.md`
  (`REQ-001`..`007`, `AC-001`..`005`)
- [x] Stage 4 — user approval: scope requested directly; behavior verified visually
  against the loaded extension (user-provided screenshot)
- [x] Stage 5 — plan tracked as in-session todos (8 steps); no durable plan file, kept
  proportionate to the small UI slice
- [x] Stage 6 — tests mapped to the ACs before coding: `popup-model.test.ts` F25 block
  (command shapes, empty-name guard, truthful failures) and
  `test/browser/design-system.spec.ts` (card width, actions row, create flow, import flow)
- [x] Stage 7 — implementation: `popup-model.ts` (`createProject`, `importProject`,
  duplicate-interface cleanup), `popup.ts` (actions row, inline create form — no
  `window.prompt`, hidden file input, `role="status"` line, draft preservation),
  `popup.css` (fixed 420px, type scale, internal list scroll, forced-colors/reduced-motion)
- [x] Stage 8 — verification (see evidence below)
- [x] Stage 9 — fresh-context review pass over the merged state (see Review below):
  PASS with four low-severity findings and one coverage recommendation, none blocking;
  dispositions recorded as follow-up candidates.
- [x] Stage 10 — documentation: F25 spec, `docs/architecture.md`, `README.md`
- [x] Stage 11 — release (see Release State)

## Verification Evidence

- `pnpm typecheck` (`tsc --noEmit`): PASS
- `pnpm --filter @rogatio/extension test`: PASS (F25 popup-model cases included)
- `pnpm build`: PASS
- `pnpm validate` (format, Biome, typecheck, build, unit tests, MV3 manifest contract,
  forbidden-dependency guard): PASS
- Browser `design-system.spec.ts`: PASS — popup card > 400px, actions row visible,
  create form flow ("Project created."), import via `setInputFiles`
  ("Project imported.")
- Manual: exercised against the loaded extension; 420px popup renders, create and import
  report success, group list and toggles intact (user-confirmed screenshot)
- AC mapping: AC-001 width/internal scroll (CSS + browser spec); AC-002/AC-003 exact
  command shapes and guards (popup-model tests); AC-004 unchanged F21 behavior (existing
  popup tests still pass); AC-005 keyboard operability, visible focus, forced colors,
  reduced motion, `aria-expanded`/`aria-controls`, `role="status"` (popup.css + popup.ts)
- No new dependencies; no generated output committed

## Decisions

- **D1:** Inline name form instead of `window.prompt` — unavailable inside Chrome action
  popups; input capped at the schema label limit (100 chars).
- **D2:** Import dispatches immediately after `file.text()` parse, before any UI work —
  Chrome may close the popup right after the file picker resolves (known Chromium
  behavior, cf. issue 364825891 research during scoping).
- **D3:** No popup-side schema validation — the repository fails closed on invalid data;
  the popup only reports the truthful outcome from the service-worker response.
- **D4:** Fixed 420px body instead of content-sized width so rows stay readable in every
  project; long lists scroll inside the list, bounded under Chrome's 600px popup cap.

## Review (2026-08-31, post-merge fresh-context pass)

Distinct review pass by the session model over the merged F25 state (`f68196c`), re-read
from source rather than from the implementation context. Contracts re-verified:

- `MAX_PROJECT_NAME_LENGTH` (100) matches `LIMITS.maxLabelLength` (`browser-schema.ts`).
- `create-project` / `import-project` message shapes are identical to the management
  page's own sends (`extension-page-entry.ts`), so both actions genuinely reuse the
  existing lifecycle.
- The service worker routes both commands to the repository (`service-worker.ts`);
  `refresh()` re-queries `get-state` and rebuilds the model, so the list reflects the
  new active project after create/import.
- Hygiene: no `innerHTML` anywhere (all `textContent`); group links use
  `encodeURIComponent`; the repository stays the only validator — the popup passes the
  parsed file value through unchanged and reports the service worker's verdict.

Findings (none blocking; dispositions are follow-up candidates, not shipped changes):

- **F-1 (low, truthfulness):** if `get-state` fails inside the post-action `refresh()`,
  the already-set status line is never rendered and the list stays stale (the early
  return skips `render()`). The same pattern pre-exists in the management page.
- **F-2 (low, UX):** no in-flight guard on the Create submit — a rapid double-submit
  can send two `create-project` commands and create two empty projects (the second
  stays inactive per the repository's first-project rule).
- **F-3 (low, robustness):** no size cap before `JSON.parse(await file.text())` on the
  untrusted import file; a very large file could freeze the popup.
- **F-4 (nit, accessibility):** after a successful create the form is removed while
  focus sits on its detached submit button (focus falls to `<body>`); `aria-controls`
  references the form id while the form is collapsed.
- **F-5 (recommendation, tests):** add an adversarial popup-model case asserting that a
  parsed non-object payload (e.g. `null`, an array) is dispatched unchanged and reported
  truthfully as a failure — the repository already fails closed.

Observations, no action (outside F25 scope): a second file-picker selection during an
in-flight import races the first; a failed initial `get-state` leaves the popup blank
(pre-existing F21 behavior); `toggle` ignores the response `ok` flag (F21, unchanged per
AC-004).

Verdict: PASS. REQ-001..007 and AC-001..005 hold against the merged implementation; the
findings above are hardening candidates for a follow-up slice.

## Release State

- Commit `4f8adfd` pushed to `origin/feature/popup-project-actions`; PR #53 opened
  against `main` (`Closes #52`).
- Merged: PR #53, squash commit `f68196c` (2026-08-31T03:24:04Z); tree parity
  `4f8adfd` ≡ `f68196c` verified (0 diff lines) before branch deletion.
- Released: tag `v1.9.0` = `f68196c`; GitHub Release v1.9.0 published with asset
  `rogatio-extension.zip` via the F20 semantic-release pipeline.
- Post-merge: `main` synced to `f68196c`; worktree removed; local branch deleted
  (squash merge, so `-D` after parity proof); remote branch auto-deleted on merge;
  tracking issue #52 closed by the merge.
- Residual: closed — a post-merge fresh-context review pass ran on 2026-08-31 (see
  Review); four low-severity hardening findings remain as follow-up candidates.
