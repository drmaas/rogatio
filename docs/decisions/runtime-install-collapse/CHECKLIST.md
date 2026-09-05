# CHECKLIST — feat/collapse-runtime-install-and-trust

Implementation tracker. Phases map one-to-one to `PLAN.md`. Mark each task complete only after the canonical validation for that step passes (e.g. `pnpm --filter @rogatio/runtime test` for runtime-only edits).

## Phase 1 — Trust controller unification

- [ ] **1.1** Write `packages/runtime/test/trust.test.ts` AC-1 test: unified `install(extensionId)` succeeds when both `manifest` and `caTrust` capabilities are present; assert `result.ok === true && result.state === "installed"`, manifest file present, all three CA files present, `status.installed === true && status.trusted === true`, `caTrustInstaller` called exactly once.
- [ ] **1.2** Write `packages/runtime/test/trust.test.ts` AC-2 test (manifest cap absent): unified `install` returns `unsupported` with the capability reasons; assert no manifest file, no CA files, `status.installed === false && status.trusted === false`, `caTrustInstaller` not called.
- [ ] **1.3** Write `packages/runtime/test/trust.test.ts` AC-3 test (manifest ok, caTrust cap absent): unified `install` writes the manifest, then rolls it back when `caTrust` capability is absent; assert no manifest file after rollback, no CA files, `result.state === "unsupported"` with the `caTrust` reasons, `caTrustInstaller` not called.
- [ ] **1.4** Write `packages/runtime/test/trust.test.ts` AC-4 test (`caTrustInstaller` throws): inject a `vi.fn()` `caTrustInstaller` that throws; assert `result.state === "unsupported"` with the wrapped error code, no manifest file, no CA files. Then call `install(id)` again with a `vi.fn()` `caTrustInstaller` that does not throw, and assert the installer is invoked again — this proves the rollback cleared `installerCalled` (the flag is closure-private; the second-invocation observation is the only externally visible signal).
- [ ] **1.5** Write `packages/runtime/test/trust.test.ts` AC-5 test (idempotency): call `install(id)` twice in succession with the same `vi.fn()` `caTrustInstaller`; assert `caTrustInstaller` called exactly once across both calls (the second `install` does not re-invoke the installer — proves `installerCalled` is set and persists on the success path), CA file mtimes are not regenerated (or contents are byte-identical), manifest contents are byte-identical.
- [ ] **1.6** Run `pnpm --filter @rogatio/runtime test` to confirm the five new tests fail red (TDD red step).
- [ ] **1.7** Edit `packages/runtime/src/trust.ts:install` (L249-293): add the second-stage `await detect()` capability check for `caTrust` after the manifest capability check, returning `unsupportedResult(caps)` if absent (no rollback yet — nothing has been written). Wrap the manifest write + CA write + `caTrustInstaller` invocation in a `try/catch` with the rollback order described in PLAN.md Architecture. Keep `trust` as a private helper function closed over by the factory (do not duplicate its body inline).
- [ ] **1.8** Edit `packages/runtime/src/trust.ts:381` (factory return): change `{ install, uninstall, trust, untrust, status }` to `{ install, uninstall, untrust, status }` — drop `trust` from the public surface.
- [ ] **1.9** Run `pnpm --filter @rogatio/runtime test` to confirm the five new tests pass green and the existing tests (`trust.test.ts:108-232`) still pass (no regression in `install`/`uninstall`/`untrust`/`status` behavior).
- [ ] **1.10** Run `pnpm --filter @rogatio/runtime format:check && pnpm --filter @rogatio/runtime lint && pnpm --filter @rogatio/runtime typecheck` to confirm Biome and tsc are clean for Phase 1.

## Phase 2 — CLI dispatch

- [ ] **2.1** Write `packages/cli/test/runtime-command.test.ts` new test: `runtimeCommand(["trust"])` returns exit 2; assert `console.error` contains `"unknown runtime subcommand: trust"` and `console.log` contains the help text (matching the post-#73 pattern at `runtime-command.test.ts:31-47`).
- [ ] **2.2** Edit `packages/cli/test/runtime-command.test.ts:22-29`: extend the "help text does not advertise the removed activate/deactivate/status subcommands" test to also assert `not.toMatch(/trust/)` and `not.toMatch(/status/)`.
- [ ] **2.3** Delete `packages/cli/test/runtime-command-gating.test.ts:49-54` (the "trust command remains explicit and capability-gated" test) — the verb is gone.
- [ ] **2.4** Run `pnpm --filter @rogatio/cli test` to confirm the new test fails red and the deleted test's removal leaves a clean red baseline (TDD red step).
- [ ] **2.5** Edit `packages/cli/src/commands/runtime.ts:159-188` (`trustRuntimeCommand` switch): delete the `case "trust":` branch (L166-171). Keep `case "install":`, `case "untrust":`, `case "uninstall":`, and `default:`.
- [ ] **2.6** Edit `packages/cli/src/commands/runtime.ts:296` (`runtimeCommand` overload signature): drop `"trust"` from the first union — `["install" | "untrust" | "uninstall" | "host", ...string[]]`.
- [ ] **2.7** Edit `packages/cli/src/commands/runtime.ts:20-51` (`showRuntimeHelp`): delete the `trust   Provision and trust the device-local CA` line at L30. Update the trailing prose at L49-50 to mention the unified `install` semantics (the install command also provisions the device-local CA on capable platforms).
- [ ] **2.8** Edit `packages/cli/src/commands/runtime.ts:332` (top-level error message): change `"Use 'rogatio runtime install|trust|untrust|uninstall' to manage the host manifest and request-body trust"` to `"Use 'rogatio runtime install|untrust|uninstall' to manage the host manifest and request-body trust"`.
- [ ] **2.9** Edit `packages/cli/src/commands/runtime.ts:160-165` (`install` case in the switch): change the `okMessage` from `"trust installed"` to the locked unified message: `"runtime install complete: manifest + device-local CA trusted"`.
- [ ] **2.10** Edit `packages/cli/src/index.ts:116` (top-level help): change `"runtime <install|trust|untrust|uninstall|host>"` to `"runtime <install|untrust|uninstall|host>"`.
- [ ] **2.11** Edit `packages/cli/src/index.ts:162-198` (`showRuntimeHelp` second copy): mirror the same edits as 2.7 — delete the `trust   Provision and trust the device-local CA` line at L172 and update the trailing prose at L191-192.
- [ ] **2.12** Run `pnpm --filter @rogatio/cli test` to confirm: the new "trust → exit 2" test passes; the extended help-text test passes; the remaining tests in `runtime-command-gating.test.ts` (extension-id gating) still pass; `runtime.test.ts` and `runtime-command.test.ts` other tests still pass.
- [ ] **2.13** Run `pnpm --filter @rogatio/cli format:check && pnpm --filter @rogatio/cli lint && pnpm --filter @rogatio/cli typecheck` to confirm Biome and tsc are clean for Phase 2.

## Phase 3 — Frozen F16 spec/plan footers

- [ ] **3.1** Append `> Superseded by: feat/collapse-runtime-install-and-trust` to `docs/specs/f16-request-body-trust.md` at L18-19 (the lifecycle line that lists `status | trust`).
- [ ] **3.2** Append the footer to `docs/specs/f16-request-body-trust.md` at L28-31 (the CLI surface line).
- [ ] **3.3** Append the footer to `docs/specs/f16-request-body-trust.md` at L100-102 (REQ-004 with the `start | stop | status` list).
- [ ] **3.4** Append the footer to `docs/specs/f16-request-body-trust.md` at L207-216 (`RequestBodyTrustControllerOptions` drift: `clock` vs `caTrustInstaller`/`caTrustRemover`).
- [ ] **3.5** Append the footer to `docs/specs/f16-request-body-trust.md` at L218-226 (factory return type drift: `install()` vs `install(extensionId)`).
- [ ] **3.6** Append the footer to `docs/specs/f16-request-body-trust.md` at L239-246 (`F16ErrorCode` vs `ErrorCode` name drift).
- [ ] **3.7** Append the footer to `docs/specs/f16-request-body-trust.md` at L270-280 (the CLI Surface block).
- [ ] **3.8** Append the footer to `docs/specs/f16-request-body-trust.md` at L310-312 (AC-008).
- [ ] **3.9** Append the footer to `docs/plans/f16-request-body-trust.md` at L44-50 (T6 CLI surface).
- [ ] **3.10** Append the footer to `docs/plans/f16-request-body-trust.md` at L77-79 (Rollback note).
- [ ] **3.11** Append the footer to `docs/specs/cli-activate-deactivate-removal.md` at L42-43 ("We are not removing `rogatio runtime install|trust|untrust|uninstall`" — now stale).
- [ ] **3.12** Append the footer to `docs/specs/cli-activate-deactivate-removal.md` at L62-64 (the "`install|trust|untrust|uninstall` → unchanged" line and the related `install`/`trust` flow reference).
- [ ] **3.13** Append the footer to `docs/specs/cli-activate-deactivate-removal.md` at L82-83 (the extension UI suggestion to run `rogatio runtime trust`).
- [ ] **3.14** Append the footer to `docs/specs/cli-activate-deactivate-removal.md` at L125 (the AC reference to "`install|trust|untrust|uninstall|host` continue to work").
- [ ] **3.15** Append the footer to `docs/specs/f17-request-body-rules.md` at L406 (REQ-103: "`runtime trust` remains explicit and capability-gated" — now stale; the verb is being removed, not retained).
- [ ] **3.16** Verify `docs/workflows/f16-workflow.md` is unchanged (no footer added — the workflow file does not enumerate the verb surface).

## Phase 4 — Live documentation updates

- [ ] **4.1** Edit `docs/architecture.md:335-365`: drop `status` from the subcommand list at L341; rewrite the `trust` bullet at L345 to describe the unified `install` semantics; rewrite the `install` bullet at L343 to mention that it also provisions the device-local CA in one call; leave the three layers, authority, and alternatives blocks unchanged.
- [ ] **4.2** Edit `rogatio-overview.md:35` (the trust-lifecycle sentence at the end of L35): rewrite to drop `trust` and describe the unified `install` (proposed wording in PLAN.md Architecture). L33-34 are unrelated to runtime.
- [ ] **4.3** Edit `samples/basic/README.md:101-122` (step 6): remove the `rogatio runtime trust` invocation at L116; rewrite the surrounding prose to say the same `install` invocation also provisions the device-local CA on capable platforms; update the "If `install` or `trust` reports `unsupported`" sentence at L119 to "If `install` reports `unsupported`"; keep the `install` invocation at L104, the `untrust` and `uninstall` references at L121-122, and the rest of the step unchanged.
- [ ] **4.4** Edit `packages/cli/README.md:42` (command table row): change `rogatio runtime <install|trust|untrust|uninstall>` to `rogatio runtime <install|untrust|uninstall>`.
- [ ] **4.5** Edit `packages/docs-site/src/content/docs/guides/runtime.md:16`: change `rogatio runtime install | trust | untrust | uninstall` to `rogatio runtime install | untrust | uninstall`; rewrite the surrounding sentence to describe the unified semantics.
- [ ] **4.6** Edit `packages/docs-site/src/content/docs/reference/cli.md:34`: same pipe-list edit; update the surrounding sentence.
- [ ] **4.7** Edit `packages/docs-site/src/content/docs/reference/platforms.md:25`: same pipe-list edit; update the surrounding sentence.
- [ ] **4.8** Edit `packages/docs-site/src/content/docs/rules/request-body.md:26`: change "the device-local CA trust installed via `rogatio runtime install | trust`" to "the device-local CA trust installed via `rogatio runtime install`" with a brief note that the install command also provisions the CA.
- [ ] **4.9** Edit root `README.md:179`: change the "the message points to `rogatio runtime trust` instead" sentence to direct users to re-run `rogatio runtime install --extension-id <your extension ID>` (which provisions both the host and the CA on capable platforms).
- [ ] **4.10** Edit `packages/extension/src/diagnostics.ts:57` (`extension.request-body-needs-trust` message): replace the `rogatio runtime trust` instruction with `rogatio runtime install --extension-id <extension ID>` and add the "same install command provisions the device-local CA on capable platforms" note.
- [ ] **4.11** Edit `packages/extension/src/extension-page-entry.ts:825-828` (the `extension.request-body-needs-trust` branch): replace `installCommand = "rogatio runtime trust"` with `installCommand = \`rogatio runtime install --extension-id ${id}\`` (using `id` from L816) and rewrite the `statusMessage` to match the new `diagnostics.ts` message.
- [ ] **4.12** Spot-check: `grep -n "runtime trust" packages/docs-site/src/content/docs/{guides/runtime.md,reference/cli.md,reference/platforms.md,rules/request-body.md} docs/architecture.md rogatio-overview.md samples/basic/README.md packages/cli/README.md README.md packages/extension/src/{diagnostics.ts,extension-page-entry.ts} packages/cli/src/{commands/runtime.ts,index.ts}` returns zero matches in those 11 live files. Frozen-spec files (`docs/specs/f16-request-body-trust.md`, `docs/specs/cli-activate-deactivate-removal.md`, `docs/specs/f17-request-body-rules.md`) are explicitly excluded from the grep — their original `runtime trust` references remain in the body but are footnoted per Phase 3 and are out of scope for AC-6.
- [ ] **4.13** Spot-check: visually verify the four docs-site files for internal consistency (e.g. `reference/cli.md` still links to `/guides/runtime/`, `rules/request-body.md` still links to `/guides/runtime/`, the pipe-list is consistent across all four). `pnpm site:build` is the optional smoke check.

## Phase 5 — Final verification

- [ ] **5.1** Run `pnpm validate` from the worktree root. This executes the canonical sequence in `scripts/validate.ts`: `format:check` → `lint` → `typecheck` → `build` → `vitest run` → `checkArtifacts` → `checkEmittedModules` → `checkBoundaries` → three negative-typecheck fixtures (`invalid-type`, `undeclared-import`, `forbidden-direction`) → `playwright`. Record the failing step number (if any) in the implementation review so the implementer can scope any later fix.
- [ ] **5.2** If `pnpm validate` reports a mechanical failure (e.g. Biome formatting drift, a missed `export`, a stale typecheck fixture) fix it in place. Do not change semantics to make the gate pass.
- [ ] **5.3** Confirm the gate is green: `pnpm validate` exits 0. Record the final exit code in the implementation review.
