# F21 — Extension Toolbar Popup Workflow Log

## Tier and model assignment

- Tier: **free** (single-model session `opencode/hy3-free`; distinct role passes; fresh-context self-review at Stage 9).
- Brainstorm/architecture/specification: `opencode/nemotron-3-ultra-free` (synthesized by session model as the free primary).
- Plan / documentation: `opencode/hy3-free`.
- Tests / implementation: `openrouter/poolside/laguna-s-2.1:free`.
- Verification: `opencode/nemotron-3.5-lightning-free`.
- Independent review: `opencode/nemotron-3-ultra-free` (fresh-context self-review, single-model).

Fallback models recorded per SDD free-phase routing; none were required because the session
model served every role in a single-model environment.

## Stage status

| Stage | Status | Notes |
| --- | --- | --- |
| 0 Worktree | done | `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/popup-group-toggle`, branch `feature/popup-group-toggle` from `main` (clean). |
| 1 Brainstorm | done (ephemeral) | User-supplied approved design; no retained brainstorm files. |
| 2 Architecture | done | Reuses `set-group-enabled`; popup reads `get-state` envelope; per-group status aggregation precedence. |
| 3 Spec | done | `docs/specs/f21-popup-group-toggle.md` approved at Stage 4. |
| 4 Human review gate | done | User approved spec + architecture as written. Eligibility = popup lists only persisted active-project groups; every listed group eligible; no ineligible rows. |
| 5 Plan | done | `docs/plans/f21-popup-group-toggle.md`, tasks T1-T8 mapped to AC-001..AC-009. |
| 6 Tests first | done | `popup-model.test.ts`, `popup-envelope.test.ts`, `editor/test/navigate.test.ts`. |
| 7 Implementation | done | `popup-model.ts`, `popup.ts`, `popup.html`, editor `navigateToGroup`, manifest `default_popup`, `build.ts`, `validate.ts` contract update. |
| 8 Verification | done | `pnpm validate` green (format, lint 0 errors, tsc, build, 561 unit tests, MV3 manifest contract, forbidden-dep guard incl. `popup.js`, 15 browser E2E). |
| 9 Review | done | Fresh-context self-review: no actionable defects; one low-severity test-gap noted (popup DOM not auto-covered; covered by build/typecheck + manual). |
| 10 Docs | done | `docs/architecture.md` F21 note, `README.md` popup note. |
| 11 Release | pending | Awaiting user authorization. |

## Verification evidence (Stage 8)

Command: `node scripts/validate.ts` (canonical: Biome format + lint, `tsc --noEmit`,
`node scripts/build.ts`, Vitest, MV3 manifest contract, forbidden-dependency guard,
Playwright browser E2E).

- Format: clean.
- Lint: 0 errors (13 pre-existing warnings + 4 infos, unrelated).
- Typecheck: clean.
- Build: `Built 15 ESM artifact(s); manifest: build-manifest.json` (includes `dist/popup.js`, `dist/popup.html`).
- Unit/integration: `Test Files 76 passed (76)`, `Tests 561 passed (561)`.
- MV3 contract: `action.default_popup === "popup.html"`, `background.service_worker === "background.js"`, permissions include `storage`, optional host permissions `["http://*/*","https://*/*"]`, CSP `script-src 'self'; object-src 'self'`.
- Forbidden-dep guard: `popup.js` added and contains no `new Function`/`eval`/`node:`/`process.`/`Buffer`/`ajv`/`@rogatio/` runtime reference.
- Browser E2E: `15 passed (3 skipped)`.

## Review findings (Stage 9, round 1)

- No missing requirements, incorrect assumptions, security/privacy, or regression findings.
- Test gap (low): `popup.ts` DOM rendering is not covered by an automated test because `jsdom`
  is not installed in this repo; mitigated by pure `popup-model` unit tests, the
  `popup-envelope` data-source test, `tsc` strict typecheck, the build, and the manual
  checklist in the spec. No code change required.

## Known limitations

- Popup DOM interaction verified manually / via build + typecheck, not via an automated browser
  E2E (no jsdom; loading a real MV3 popup in Playwright was out of scope for this slice).
- Eligibility is defined as "appears in persisted active-project groups"; the approved design
  states there are no ineligible rows in the popup (new/dirty editor drafts never reach it).
