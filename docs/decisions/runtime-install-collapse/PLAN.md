# PLAN — feat/collapse-runtime-install-and-trust

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-install-collapse`
**Branch:** `feat/runtime-install-collapse` @ `ecb0ff1` (= main; no commits yet)
**Base:** `origin/main` @ `ecb0ff1` (`fix(cli)!: remove broken runtime activate/deactivate/status (#72) (#73)`)
**Issue:** #69 — collapse `rogatio runtime install --extension-id <id>` + `rogatio runtime trust` into one transactional `rogatio runtime install`.
**Planning tier:** free (provider openrouter, primary `openrouter/thinkingmachines/inkling-small:free`, fallback `opencode/nemotron-3-ultra-free`).
**Research artifact:** [`RESEARCH.md`](./RESEARCH.md).

## Implementation strategy

**TDD (tests first).** The feature is fully testable through the existing injection seams in `packages/runtime/src/trust.ts` (`detectCapabilities`, `caTrustInstaller`, `caTrustRemover`) and through the CLI dispatch in `packages/cli/src/commands/runtime.ts`. Tests are written before each production change, run red, then made green. The implementation phase runs `pnpm --filter @rogatio/runtime test` and `pnpm --filter @rogatio/cli test` after each step to lock the regression surface, and `pnpm validate` at the end as the canonical gate.

## Plan-review gate decisions (locked 2026-09-03)

1. **Unified success message:** `"runtime install complete: manifest + device-local CA trusted"` (the recommended option). Replaces the current `"trust installed"` line at `runtime.ts:160-165`.
2. **Controller `trust` method:** keep as a **private (non-exported) helper** used by the new unified `install`. Do not inline its body into `install`. Public controller surface drops `trust` (factory return at `trust.ts:381` becomes `{ install, uninstall, untrust, status }`).
3. **Extension UI strings for `extension.request-body-needs-trust`:** rewrite both `packages/extension/src/diagnostics.ts:57` and `packages/extension/src/extension-page-entry.ts:825-828` to the longer wording — `"Run \`rogatio runtime install --extension-id <extension ID>\` to register the host and (on capable platforms) trust the device-local CA"`. (The user approved the recommended full-length variant over the shorter "Run \`rogatio runtime install --extension-id <extension ID>\`".)
4. **`docs/specs/cli-activate-deactivate-removal.md`:** append-only file (not formally frozen). Add `> Superseded by: feat/collapse-runtime-install-and-trust` footers at L42-43, L62-64, L82-83, L125. No body edits.
5. **CaTrust capability check ordering:** match the issue body (#69) verbatim — `manifest-cap → write manifest → caTrust-cap (rolls back manifest if absent) → CA → installer`. The caTrust check happens **after** the manifest write, and the rollback on `caTrust === false` removes the just-written manifest. This makes AC-2 (manifest atomicity), AC-3 (capability gating), and CHECKLIST 1.3 all internally consistent: the test for caTrust-cap-absent genuinely exercises a manifest rollback, not an early return.

## Goal

Collapse the two-step `rogatio runtime install --extension-id <id>` + `rogatio runtime trust` user flow into a single `rogatio runtime install --extension-id <32-char-id>` command that transactionally writes the Chrome native-messaging host manifest, generates the device-local CA, and invokes the capability-provided `caTrustInstaller` — rolling back every side effect (CA files, manifest, installer side effect) on any partial failure so nothing is left half-installed. Per the user's research-review gate decision, `rogatio runtime trust` is **removed** from the CLI surface entirely — no deprecation alias, no deprecation notice, no deprecation window, no removal version. Anyone running `rogatio runtime trust` after this change gets exit 2 via the existing `default:` branch, matching the post-#73 removal pattern for `activate | deactivate | status`.

## Non-goals

- **No deprecation alias.** `rogatio runtime trust` is not aliased to `install`, does not print a deprecation notice to stderr, and has no removal-version footnote. The verb is gone from the CLI surface, the type union, both copies of the help text, the top-level pipe list, the CLI README, all four docs-site files, `rogatio-overview.md`, the sample README, and the controller's public API. The user's "do not alias any runtime commands" decision is binding.
- **No return of `activate | deactivate | status` to the runtime subcommand surface.** Those verbs are already gone (commit `ecb0ff1`). The plan does not re-introduce them, even though the issue body still mentions them as non-goals to preserve.
- **No new packages.** The change is internal to `packages/runtime/src/trust.ts` and `packages/cli/src/commands/runtime.ts` (+ help text in `packages/cli/src/index.ts`). No new exports from `@rogatio/runtime`; the existing `export * from "./trust.js"` at `packages/runtime/src/index.ts:23` is unchanged.
- **No real X.509 generation.** `packages/runtime/src/x509.ts` remains the deterministic test stub. Real CA generation is a separate feature.
- **No F15/F17 rule behavior changes.** Request-body, response-body, header, redirect, query, and mock rule compilation and matching are untouched.
- **No traffic or body byte changes.** No request/response body handling anywhere; the trust module never touches bodies.
- **No dependency additions.** No new npm packages, no version bumps.
- **No schema/compiler changes.** `packages/schema` and `packages/compiler` are not touched.
- **No build manifest changes.** `build-manifest.json` does not change; no artifacts are added or removed.
- **No browser-core / editor / extension behavior changes** beyond the user-facing string updates in `packages/extension/src/extension-page-entry.ts` and `packages/extension/src/diagnostics.ts` (which currently tell users to run `rogatio runtime trust`; that branch must be deleted and the message updated to direct users to re-run `rogatio runtime install --extension-id <id>`).
- **No frozen F16 spec/plan body edits.** Only `> Superseded by: feat/collapse-runtime-install-and-trust` footers are appended to specific lines (see Architecture below). The frozen bodies remain byte-identical.
- **No frozen F16 workflow edits.** `docs/workflows/f16-workflow.md` does not enumerate the verb surface; no footer is added.
- **No removal of `rogatio runtime install --extension-id` validation rules** (32 chars from `a..p`). The CLI gate at `packages/cli/src/commands/runtime.ts:150` and the controller gate at `packages/runtime/src/trust.ts:250` remain in place.
- **No removal of capability gating semantics** (F16 REQ-015..017). The unified `install` keeps the two-stage capability check (`manifest` then `caTrust`) with the same `trust.unsupported` exit-0-on-failure behavior.

## Architecture

### The new `install` method on the trust controller (`packages/runtime/src/trust.ts:249`)

The current `install(extensionId)` writes only the manifest (`trust.ts:249-293`); the current `trust()` writes only the CA and calls `caTrustInstaller` (`trust.ts:308-340`). The feature widens `install` to perform both steps transactionally, in this order (matching issue #69's explicit step list — confirmed at the plan-review human gate):

1. Validate `extensionId` against `/^[a-p]{32}$/` (existing `trust.ts:250-256`; kept verbatim).
2. Build `allowedOrigins = ["chrome-extension://<id>/"]` and call `generateNativeMessagingManifest(...)` (existing `trust.ts:257-272`; kept verbatim).
3. Reject `manifest-too-large` (`> TRUST_LIMITS.manifestMaxBytes`; existing `trust.ts:273-280`; kept verbatim).
4. **Capability check, stage 1: `manifest`.** `await detect()`; if `!caps.manifest` return `unsupportedResult(caps)` and write nothing. (Existing `trust.ts:281-282`; kept verbatim.)
5. **Write manifest atomically** via `writeFileAtomic(manifestPath(), data)`. On throw, return `unsupported` with `codeOf(error, "trust.write-failed")`. (Existing `trust.ts:283-291`; kept verbatim.)
6. **Capability check, stage 2: `caTrust`.** `await detect()` again; if `!caps.caTrust` **roll back the just-written manifest** (`rm(manifestPath(), { force: true })`) and return `unsupportedResult(caps)`. (This is the new gate; without it, the unified `install` would leave the manifest installed while reporting "trust unsupported", which violates REQ-015's "no partial trust state" rule and AC-2 of the issue body. The `installerCalled` flag is not yet `true`, so no installer side effect to roll back; only the manifest file is removed.)
7. **Write CA material (key, pub, cert).** If `caKeyFile` or `caCertFile` is missing (idempotency per REQ-010/012), call `generateCaKeyPair(TRUST_LIMITS.caKeyBits)` and `createCertificate(...)` then `writeFileAtomic` each file. (Mirrors `trust.ts:312-327`.)
8. **Invoke `caTrustInstaller`** with `await readFile(caCertFile, "utf8")`, gated by the `installerCalled` flag (closed over at `trust.ts:247`) so a repeated call is idempotent. (Mirrors `trust.ts:328-331`.)
9. Return `{ ok: true, state: "installed" }`. (Existing `trust.ts:292`; kept — see success-message decision below.)

The try/catch wraps steps 6–8. On any thrown error from steps 6–8, the rollback runs before the `unsupported` return, in this order:

- **Step 8 failure (`caTrustInstaller` throws):** attempt to roll back the installer side effect (best-effort — there is no rollback API on `caTrustInstaller` today; the only action is to clear `installerCalled` so the next call can re-invoke), then `rm(caKeyFile, { force: true })`, `rm(caPubFile, { force: true })`, `rm(caCertFile, { force: true })`, then `rm(manifestPath(), { force: true })`. Reset `installerCalled = false`. Each `rm` is `force: true` so the rollback succeeds even if a file is absent.
- **Step 7 failure (CA write throws):** same as step 8 but skip the installer rollback; just remove whatever CA files were written (use `force: true` so files that don't exist are skipped), then remove the manifest, then reset `installerCalled`.
- **Step 6 failure (caTrust capability absent, after manifest write):** roll back the just-written manifest (`rm(manifestPath(), { force: true })`); no CA files have been written; `installerCalled` is `false`. Return `unsupported` with the `caTrust` reasons.
- **Step 5 failure (manifest write throws):** no CA files have been written yet; just return `unsupported` with the code. Nothing to roll back.

Each rollback step is wrapped in its own try/catch so a rollback failure (e.g. permission denied on the manifest path) does not mask the original failure — the original error code is returned and a console error is logged, but the function still returns `unsupported` with the original code. This is the post-#73 discipline: never throw from a trust mutator (REQ-015).

### Recommendation: keep `trust` as a private helper

`trust()` on the controller (`trust.ts:308-340`) already does exactly the CA-write + `caTrustInstaller` work that the unified `install` needs. **The plan recommends keeping `trust` as a private (non-exported) helper** called by the new `install` on the success path, and dropping it from the controller factory's return value (`trust.ts:381`). Rationale:

- The CA + `caTrustInstaller` logic is not duplicated. The new `install` reuses the existing file-presence check (`trust.ts:312`), the existing `installerCalled` flag (`trust.ts:247`), the existing idempotency test at `trust.test.ts:160-179`, and the existing no-leak test at `trust.test.ts:217-232`.
- The rollback order in `install` can reuse the existing per-step cleanup shape (`rm(path, { force: true })` for each CA file plus `rm(manifestPath, { force: true })`).
- The public controller surface drops `trust` (per the "no alias" decision). The factory return at `trust.ts:381` becomes `{ install, uninstall, untrust, status }` — four methods, no `trust`.
- This is not over-engineering: it is the minimum change that lets the unified `install` reuse the verified CA-write logic.

The alternative (delete `trust` outright and inline its body into `install`) is rejected because it would force the implementer to re-test the CA-write + `caTrustInstaller` idempotency and no-leak behavior from scratch, increasing regression risk.

### `trust` becomes unreachable from the CLI

Because `trust` is dropped from the controller's public return and the CLI dispatch drops the `trust` case (next section), `rogatio runtime trust` no longer has any caller. Anyone invoking it post-release hits the `default:` branch in `packages/cli/src/commands/runtime.ts:184-188`, prints `"Error: unknown runtime subcommand: trust"`, prints the help text, and returns 2 — matching the post-#73 `activate | deactivate | status` pattern (`runtime-command.test.ts:31-47`).

### CLI dispatch (`packages/cli/src/commands/runtime.ts`)

- **`runtimeCommand` overload signature** at `runtime.ts:295-310`: drop `"trust"` from the first union. New signature: `["install" | "untrust" | "uninstall" | "host", ...string[]]`. The generic `string[]` fallback remains (it catches anything else and routes to the `default:` branch).
- **`runtimeCommand` routing** at `runtime.ts:321-336`: drop the `first === "trust"` branch (already absent — `trust` was never a top-level branch; it was a sub-branch inside `trustRuntimeCommand`). The error message at `runtime.ts:332` must drop `trust` from the pipe list: `"Use 'rogatio runtime install|untrust|uninstall' to manage the host manifest and request-body trust, or 'rogatio runtime host [path]' to run the native-messaging host."` (The error message currently says `install|trust|untrust|uninstall`; post-change it must not mention `trust`.)
- **`trustRuntimeCommand` switch** at `runtime.ts:159-188`: drop the `case "trust":` branch. The `install`, `untrust`, `uninstall`, and `default:` branches remain. The `subcommand === "install"` block at `runtime.ts:141-156` is kept verbatim (the `--extension-id` parsing is unchanged).
- **Help text in `runtime.ts:20-51` (`showRuntimeHelp`):** drop the `trust   Provision and trust the device-local CA` line. Keep the four lines: `install`, `untrust`, `uninstall`, and `host [path]`. The trailing prose at L49-50 stays (`The device-local CA / PAC routing capability only affects request-body interception, not the host control plane.`) but the wording implies trust is now part of `install` — adjust to mention the unified semantics.
- **Help text in `packages/cli/src/index.ts:162-198` (`showRuntimeHelp` second copy):** same edits as above; both copies must stay byte-identical (per the existing duplication, e.g. L116 in `index.ts` references `runtime <install|trust|untrust|uninstall|host>` and must become `runtime <install|untrust|uninstall|host>`).
- **Top-level help line** at `packages/cli/src/index.ts:116`: `"runtime <install|trust|untrust|uninstall|host>"` becomes `"runtime <install|untrust|uninstall|host>"`.
- **`reportTrust` success message** at `runtime.ts:160-165`: the `install` case currently prints `"trust installed"` on success. Change to a unified message: `"runtime install complete: manifest + device-local CA trusted"` (proposed default; alternative `"trust installed: manifest + device-local CA trusted"` is acceptable per RESEARCH OQ-1). The controller's success `state` stays `"installed"` to keep `status.installed === true` after a successful unified install (the RESEARCH OQ-1 alternative of `state: "trusted"` is rejected because the same controller instance is also used by `untrust`/`uninstall`, where `"trusted"` would be inconsistent).
- **`trustRuntimeCommand` export:** the export at `runtime.ts` (top of file) is not separately exported; the function is module-private. No export to drop.

### CLI tests

- **`packages/cli/test/runtime-command.test.ts:31-47`** (the `activate | deactivate | status` exit-2 tests): unchanged. They still pass because `activate | deactivate | status` remain exit-2.
- **New test** in `packages/cli/test/runtime-command.test.ts`: assert that `runtimeCommand(["trust"])` returns exit 2 and the error message contains `"unknown runtime subcommand: trust"` and that the help text is printed. This is the post-collapse replacement for the post-#73 pattern: a removed subcommand returns 2 with the help text.
- **`packages/cli/test/runtime-command.test.ts:22-29`** (`help text does not advertise activate/deactivate/status`): extend to also assert `not.toMatch(/trust/)` and that the help text now lists `install | untrust | uninstall | host`.
- **`packages/cli/test/runtime-command-gating.test.ts:49-54`** (`trust command remains explicit and capability-gated`): delete. The verb is gone. The other four tests in that file (extension-id gating) stay — they exercise the unified `install` path and must keep passing.
- **`packages/cli/test/runtime.test.ts`** (175 lines): unchanged. None of its assertions reference `trust` directly.

### Frozen F16 spec/plan footers

Append `> Superseded by: feat/collapse-runtime-install-and-trust` to these specific lines (no body edits):

- `docs/specs/f16-request-body-trust.md`:
  - **L18-19** (the line `F16 establishes the trust lifecycle: rogatio runtime install | status | trust | untrust | uninstall`) — `status` and `trust` are stale.
  - **L28-31** (`rogatio runtime install | status | trust | untrust | uninstall` CLI surface) — stale.
  - **L100-102** (REQ-004: `install`, `status`, `trust`, `untrust`, `uninstall` plus `start | stop | status`) — stale.
  - **L207-216** (`RequestBodyTrustControllerOptions` lists `clock` instead of `caTrustInstaller`/`caTrustRemover`) — pre-existing drift; out of spec but in scope of "spec lines that no longer match the code at HEAD".
  - **L218-226** (factory return type lists `install()` with no args; code has `install(extensionId)`) — pre-existing drift.
  - **L239-246** (spec names `F16ErrorCode`; code names `ErrorCode`) — pre-existing drift.
  - **L270-280** (CLI Surface block lists `install | status | trust | untrust | uninstall`) — stale.
  - **L310-312** (AC-008 lists `install | status | trust | untrust | uninstall`) — stale.
- `docs/plans/f16-request-body-trust.md`:
  - **L44-50** (T6: `install|trust|untrust|uninstall` and the `status` reference) — stale.
  - **L77-79** (Rollback: "reversible by removing the module export and CLI routing" — incomplete after collapse) — stale.
- `docs/specs/f17-request-body-rules.md`:
  - **L406** (REQ-103: "`runtime trust` remains explicit and capability-gated") — stale; `runtime trust` is being removed, not retained.

Each footer is a single line appended immediately below the affected line range, not at the end of the file. The frozen bodies remain byte-identical.

### Live documentation updates

These are source-of-truth files (not frozen decision records), per AGENTS.md:

- **`docs/architecture.md:335-365`** (Request-Body Trust Lifecycle section):
  - **L341** drops `status` from the subcommand list.
  - **L343-347** (the five-bullet list of operations): drop the `status` bullet; rewrite the `trust` bullet to describe the unified `install` semantics (`trust is performed as part of install on capable platforms; the dedicated trust verb is removed`). Rewrite the `install` bullet to mention that it also provisions the device-local CA in one call.
  - The three layers block (L349-353), authority/confidentiality block (L355-357), and alternatives-rejected block (L359-363) are unchanged.
  - The footer at L365 (`docs/specs/f16-request-body-trust.md`; the staged workflow record is in `docs/f16-workflow.md`) stays.
- **`rogatio-overview.md:33-35`** (the trust-lifecycle sentence): rewrite to drop `trust` and describe the unified `install`. Proposed wording: `"Request-body rules use the trust lifecycle \`rogatio runtime install\` (which provisions both the native-messaging host and the device-local CA, capability-gated), \`rogatio runtime untrust\` to remove the CA trust, and \`rogatio runtime uninstall\` to remove the host registration. The native-messaging host itself runs as \`rogatio runtime host <path>\`."`
- **`samples/basic/README.md:101-122`** (step 6): the `rogatio runtime trust` invocation at L116 is removed; the surrounding prose is rewritten to say the same `install` invocation also provisions the device-local CA on capable platforms. The `install` invocation at L104 is kept verbatim. The `rogatio runtime untrust` and `rogatio runtime uninstall` references at L121-122 stay. The "If `install` or `trust` reports `unsupported`" sentence at L119 becomes "If `install` reports `unsupported`".
- **`packages/cli/README.md:42`** (command table row): the `rogatio runtime <install|trust|untrust|uninstall>` row becomes `rogatio runtime <install|untrust|uninstall>` (drop `trust` from the pipe list).
- **`packages/docs-site/src/content/docs/guides/runtime.md:16`**: `rogatio runtime install | trust | untrust | uninstall` becomes `rogatio runtime install | untrust | uninstall`. The surrounding sentence is rewritten to describe the unified semantics.
- **`packages/docs-site/src/content/docs/reference/cli.md:34`**: same pipe-list edit.
- **`packages/docs-site/src/content/docs/reference/platforms.md:25`**: same pipe-list edit.
- **`packages/docs-site/src/content/docs/rules/request-body.md:26`**: "the device-local CA trust installed via `rogatio runtime install | trust`" becomes "the device-local CA trust installed via `rogatio runtime install`" with a brief note that the install command now also provisions the CA.
- **`README.md:179`** (root README's "If the project has request-body rules..." sentence): `rogatio runtime trust` becomes `rogatio runtime install --extension-id <your extension ID>` (re-run install provisions the CA too on capable platforms).
- **`packages/extension/src/diagnostics.ts:57`** (`extension.request-body-needs-trust` message): the message currently says "Run `rogatio runtime trust` in a terminal, then click Start runtime again." This is now a broken instruction (`rogatio runtime trust` returns exit 2 post-collapse). Rewrite to "Run `rogatio runtime install --extension-id <extension ID>` in a terminal, then click Start runtime again. The same install command provisions the device-local CA on capable platforms."
- **`packages/extension/src/extension-page-entry.ts:825-828`** (the `code === "extension.request-body-needs-trust"` branch): the `installCommand = "rogatio runtime trust"` assignment is replaced with `installCommand = \`rogatio runtime install --extension-id ${id}\`` (using the browser-assigned `id` already available in scope from L816). The status message is rewritten to match the new `diagnostics.ts` message.
- **`docs/specs/cli-activate-deactivate-removal.md`** is **not** frozen (it's a recent append-only spec at `docs/specs/`); per AGENTS.md, frozen spec bodies are not edited but append-only specs are. The decision to remove `trust` supersedes the "We are not removing `rogatio runtime install|trust|untrust|uninstall`" line at L42 and the "`rogatio runtime install|trust|untrust|uninstall` → unchanged" line at L64 and the related references at L82-83 and L125. Add `> Superseded by: feat/collapse-runtime-install-and-trust` to those specific lines (L42-43, L62-64, L82-83, L125). This is consistent with the durable-documentation rule that the spec body is not edited but a footer is appended.

### Post-#73 reconciliation

The issue body still mentions `activate | deactivate | status` as non-goals to preserve, but the post-#73 tree (`ecb0ff1`) has already removed them. The corrected AC list (dropped from issue body) is recorded in the **Acceptance criteria** section below. The plan-review subagent verifies the corrected AC list against the code at the gate.

The issue body also says "no change to `status`" as a non-goal. Since `status` is no longer a runtime subcommand, "no change" is trivially true at the CLI level; no action is required. The frozen F16 spec line at L271 (`runtime status       Show trust standing (installed / trusted)`) is stale; the footer added per the Frozen F16 spec/plan footers section captures this.

## Phases

Each phase maps to a contiguous checklist range in `CHECKLIST.md` and is small enough to review in one human-gate pass (≤ 10 tasks). The plan-review subagent may adjust ordering; phases are not allowed to be merged across the gate.

### Phase 1 — Trust controller unification (`CHECKLIST.md` Phase 1)

Convert `packages/runtime/src/trust.ts:install(extensionId)` from "manifest-only" to "manifest + CA + `caTrustInstaller` with explicit rollback." Keep `trust` as a private helper closed over by the factory; remove `trust` from the factory return (`trust.ts:381`). Add the two-stage capability check (`manifest` then `caTrust`), the new rollback order, and the `installerCalled` reset on failure. Add the five new test cases (AC-1, AC-2, AC-3, AC-4, AC-5 idempotency) in `packages/runtime/test/trust.test.ts`: unified success, manifest-cap-absent → no writes, manifest-ok-but-caTrust-cap-absent → manifest rolled back, `caTrustInstaller` throws → manifest + CA rolled back, and idempotent re-call. Verify `pnpm --filter @rogatio/runtime test` is green.

### Phase 2 — CLI dispatch (`CHECKLIST.md` Phase 2)

Update `packages/cli/src/commands/runtime.ts`: drop the `case "trust":` branch from `trustRuntimeCommand`, drop `"trust"` from the `runtimeCommand` overload union at L296, drop the `trust` line from `showRuntimeHelp` at L29-32, drop `trust` from the error message at L332, and update the success message for `install` to the unified wording. Update `packages/cli/src/index.ts`: drop `trust` from `showRuntimeHelp` (the second copy at L162-198), drop `trust` from the top-level help line at L116, drop `trust` from the top-level help's `runtime <...>` pipe list, and update the install-line copy. Update `packages/cli/test/runtime-command.test.ts`: add the new "trust → exit 2" test, extend the "help text does not advertise ..." test to also assert `not.toMatch(/trust/)`. Update `packages/cli/test/runtime-command-gating.test.ts`: delete the now-impossible "trust command remains explicit and capability-gated" test. Verify `pnpm --filter @rogatio/cli test` is green.

### Phase 3 — Frozen F16 spec/plan footers (`CHECKLIST.md` Phase 3)

Append `> Superseded by: feat/collapse-runtime-install-and-trust` to the specific lines enumerated in the **Frozen F16 spec/plan footers** subsection of Architecture. No body edits. `docs/workflows/f16-workflow.md` is not amended. `docs/specs/cli-activate-deactivate-removal.md` (append-only, not frozen) gets the footer on the lines enumerated in the **Live documentation updates** subsection.

### Phase 4 — Live documentation updates (`CHECKLIST.md` Phase 4)

Edit each source-of-truth file in place per the **Live documentation updates** subsection of Architecture. Each file is decomposed as a separate checklist task so the implementation review can spot-check each one. The docs-site files are excluded from `tsc`/`biome` per AGENTS.md, so the implementation review must visually verify the rendered markdown and the internal cross-links (e.g. `/guides/runtime/` from `reference/cli.md`, `/reference/cli.md` from `rules/request-body.md`).

### Phase 5 — Final verification (`CHECKLIST.md` Phase 5)

Run `pnpm validate` (the canonical sequence: format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright). Fix mechanical failures in place (e.g. Biome-format a freshly-added line). Do not change semantics to make `pnpm validate` pass. The gate is `pnpm validate` green.

## Risks

1. **`caTrustInstaller` throw path is the only place the new rollback logic is exercised.** The `try/catch` rollback in Phase 1 is verified by exactly one test (AC-4 in `packages/runtime/test/trust.test.ts`). If that test seam is too narrow (e.g. only catches one throw site, not all of step 8), the rollback could regress silently on a different throw path. The Phase 1 checklist should add an explicit test for each rollback step (manifest-write failure does not roll back CA — there is no CA yet; CA-write failure rolls back manifest; `caTrustInstaller` throw rolls back both). The implementation review must verify the test covers every rollback path, not just the happy-path throw.
2. **Idempotency of the unified `install`.** The unified `install` must remain idempotent: a second call with the same extension ID and capabilities must not rewrite the manifest (existing REQ-010 + existing test at `trust.test.ts:108-123`), must not regenerate the CA (existing file-presence check at `trust.ts:312`), and must not re-invoke `caTrustInstaller` (existing `installerCalled` flag at `trust.ts:247`). The Phase 1 checklist must add a test (AC-5 / CHECKLIST 1.5) that calls `install` twice in succession with the same `vi.fn()` `caTrustInstaller` and asserts the installer is called exactly once across both calls (the second-call non-invocation is the externally visible signal that `installerCalled` was set on the first call), the manifest file's mtime does not change (or the contents are byte-identical), and `caKeyFile` is not regenerated. This is load-bearing for REQ-010/012.
3. **Removing `trust` from the controller's public surface is a breaking change to `@rogatio/runtime`'s API.** Any consumer of `@rogatio/runtime` (none today other than the CLI; verified by `packages/runtime/src/index.ts:23` exporting only `trust` symbols) loses access to `controller.trust()`. The Phase 4 docs updates (`docs/architecture.md`, `rogatio-overview.md`, sample README, CLI README, four docs-site files) and the Phase 4 diagnostics/extension-page-entry updates are the load-bearing user-facing notification. The implementation review must grep for any remaining `controller.trust` or `runtime trust` reference and confirm there are none.
4. **Over-engineering risk.** Any new abstraction, helper, configuration option, or seam beyond what the user asked for is over-engineering. The plan specifically rejects: a new `installAll` helper alongside `install` (overlapping semantics), a generic rollback helper class (the inline `rm(..., { force: true })` calls are sufficient), a new CLI flag (no flag is needed — the unified `install` replaces both verbs), a new `install --skip-ca-trust` flag (out of scope; capability gating already handles the "CA trust unavailable" path), a migration guide document (the docs updates are inline), and a new test helper for trust-controller rollback (the existing `mkdtemp`/`rm` setup is sufficient). The implementation review must flag any of these and the human gate must approve before they ship.
5. **Docs-site edits do not run through `tsc`/`biome`.** Per AGENTS.md, `packages/docs-site` is excluded from the root `tsc`/`biome` and isolated by design. The four docs-site files (`guides/runtime.md`, `reference/cli.md`, `reference/platforms.md`, `rules/request-body.md`) will not be caught by the canonical `pnpm validate` sequence. The Phase 4 implementation review must visually verify each file: the pipe list drops `trust`, the surrounding prose is internally consistent, and the cross-links (`/guides/runtime/`, `/reference/cli.md`) still resolve. `pnpm site:build` is the optional smoke check (not run by `pnpm validate`).
6. **Extension UI strings reference the now-removed `rogatio runtime trust`.** `packages/extension/src/diagnostics.ts:57` (`extension.request-body-needs-trust`) and `packages/extension/src/extension-page-entry.ts:825-828` both tell users to run `rogatio runtime trust`. Post-collapse that command exits 2 with the help text, which is a UX regression the user would notice immediately. The Phase 4 implementation review must grep `runtime trust` across `packages/extension/src/` and confirm zero remaining references; the two edits in the **Live documentation updates** subsection are the fix.
7. **The `installerCalled` flag is reset by `untrust` only.** After the unified `install` sets `installerCalled = true`, a subsequent `untrust` resets it. The next `install` will then re-invoke `caTrustInstaller`. That is the desired behavior for the "re-install" path (force re-trust). The implementation must not also reset `installerCalled` on manifest-write or CA-write failures (that would prevent a retry from re-invoking the installer). The implementation review must verify `installerCalled = false` is set only in the `untrust` path and in the rollback path of step 8. The CHECKLIST 1.4 test proves the rollback reset by observing that a subsequent `install` re-invokes `caTrustInstaller`; the CHECKLIST 1.5 test proves the success-path set by observing that a subsequent `install` does not re-invoke.
8. **The `reportTrust` exit-code semantics must be preserved.** `install`/`trust` returning `unsupported` exits 0 (per `runtime.ts:125-130`); only a real write failure exits 1 (per `runtime.ts:131-135`). The unified `install`'s new "caTrust capability absent after manifest write" rollback returns `unsupported` from the controller; `reportTrust` prints `trust unsupported: <reasons>` and exits 0. The existing test at `runtime-command-gating.test.ts:38-47` (which runs `install` with a valid ID against the default capability provider and expects `code !== 2`) must continue to pass — the default capability provider returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }`, so `install` returns `unsupported` (stage-1 capability gate), and `reportTrust` exits 0. The implementation review must verify this exit code path is preserved.
9. **`packages/cli/test/runtime-command.test.ts:22-29` (the `not.toMatch(/activate|deactivate/)` test) is now load-bearing for `trust` too.** The Phase 2 checklist extends that test to also assert `not.toMatch(/trust/)` and `not.toMatch(/status/)`. The implementation review must verify the test catches a regression where the help text re-adds any of the three removed verbs.
10. **Conventional-commit discipline.** Per AGENTS.md, every commit must reference an open issue. The work is for #69; the implementer must confirm the issue number with the user before committing and follow the Conventional Commits format (`feat:` for the unified install, `fix!:` or `chore:` for the spec/plan footers, `docs:` for the live documentation updates).

## Acceptance criteria

The issue body proposes four acceptance criteria; the post-#73 reconciliation drops the `activate | deactivate | status` preservation clause. The plan-review subagent records this corrected AC list at the gate.

**AC-1 (transactional unified install):** `rogatio runtime install --extension-id <32-char-id>` writes the native-messaging host manifest, provisions the device-local CA, and invokes the capability-provided `caTrustInstaller` in one call. On success, `status.installed === true` and `status.trusted === true`. On any partial failure (capability absent at either stage, manifest write error, CA write error, `caTrustInstaller` throw), every side effect — manifest, CA files, installer side effect — is rolled back so `status.installed === false` and `status.trusted === false`. Verified by `packages/runtime/test/trust.test.ts` AC-1, AC-3 (manifest rolled back when caTrust cap absent), and AC-4 (`caTrustInstaller` throw rolls back both) cases (see Phase 1).

**AC-2 (manifest atomicity preserved):** The manifest write uses `writeFileAtomic` (`packages/runtime/src/trust.ts:192-198`); a crash or write failure leaves no partial manifest file. The caTrust capability-absent path (step 6 in Architecture) rolls back the just-written manifest so the system returns to the pre-install state. Verified by the existing idempotency test at `trust.test.ts:108-123` (which asserts the second call is a no-op success) and the new AC-3 test at `trust.test.ts` (which asserts no manifest file exists after a `caTrust`-capability-absent rollback).

**AC-3 (capability gating preserved):** The unified `install` performs the two-stage capability check: `manifest` first (returns `unsupported` and writes nothing if absent), then `caTrust` (returns `unsupported` and rolls back the manifest if absent). `caTrustInstaller` is not called when `caTrust === false`. Verified by `packages/runtime/test/trust.test.ts` AC-2 (manifest cap absent; installer not called) and AC-3 (manifest-ok-but-caTrust-cap-absent; installer not called).

**AC-4 (status non-leakage preserved):** `controller.status()` after a successful unified `install` returns `{ installed: true, trusted: true, platform, capabilityReasons }` with no manifest path, host path, or CA material in the serialized output. Verified by extending the existing test at `packages/runtime/test/trust.test.ts:217-232` to call `status()` after a unified `install` instead of separate `install()` + `trust()` calls.

**AC-5 (CLI verb removal):** `rogatio runtime trust` exits 2 with `"Error: unknown runtime subcommand: trust"` and prints the help text. The `runtimeCommand` overload union at `packages/cli/src/commands/runtime.ts:296` no longer contains `"trust"`. The `trustRuntimeCommand` switch at `runtime.ts:159-188` no longer has a `case "trust":` branch. Both copies of `showRuntimeHelp` (in `runtime.ts:20-51` and `index.ts:162-198`) drop the `trust` line. The top-level help line at `packages/cli/src/index.ts:116` drops `trust` from the pipe list. Verified by the new "trust → exit 2" test in `packages/cli/test/runtime-command.test.ts`, the extended help-text test at `runtime-command.test.ts:22-29`, and the deleted `trust command remains explicit` test in `runtime-command-gating.test.ts`.

**AC-6 (docs alignment):** All 11 live documentation files (`docs/architecture.md:335-365`, `rogatio-overview.md:35`, `samples/basic/README.md:101-122`, `packages/cli/README.md:42`, four docs-site files, root `README.md:179`, `packages/extension/src/diagnostics.ts:57`, and `packages/extension/src/extension-page-entry.ts:825-828`) drop `trust` from their user-facing verb lists and use the unified `install` wording. The frozen F16 spec/plan footers are appended at the specific lines enumerated in the Architecture section. `docs/workflows/f16-workflow.md` is unchanged. Verified by `grep -n "runtime trust" packages/docs-site/src/content/docs/{guides/runtime.md,reference/cli.md,reference/platforms.md,rules/request-body.md} docs/architecture.md rogatio-overview.md samples/basic/README.md packages/cli/README.md README.md packages/extension/src/{diagnostics.ts,extension-page-entry.ts} packages/cli/src/{commands/runtime.ts,index.ts}` returning **zero matches in those 11 live files**. The frozen-spec files (`docs/specs/f16-request-body-trust.md`, `docs/specs/cli-activate-deactivate-removal.md`, `docs/specs/f17-request-body-rules.md`) retain `runtime trust` references that are footnoted but not edited; their matches are explicitly excluded from the zero-match criterion (the implementation review runs the grep without those paths).

**AC-7 (validation gate):** `pnpm validate` is green on `feat/runtime-install-collapse` after the implementation. The canonical sequence (`format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright`) all pass. The build manifest, package boundaries, and negative typecheck fixtures are not changed by this feature. Verified by `pnpm validate` exit 0.
