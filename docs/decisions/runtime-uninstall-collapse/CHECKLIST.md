# CHECKLIST — feat/runtime-uninstall-collapse

Initial checklist. Phases map one-to-one to `PLAN.md`. Each task is small enough to check off in one focused edit or test run.

## Phase 1 — Trust controller unification (`packages/runtime/src/trust.ts`)

- [ ] **1.1** Add new `removeCa()` private closure helper in `trust.ts` (file `rm` calls for `caKeyFile`, `caPubFile`, `caCertFile`; then best-effort `caTrustRemover` invocation guarded by `existsFile(caKeyFile)` after the rm).
- [ ] **1.2** Replace the existing `uninstall` body at `trust.ts:352-363` with the new body that calls `removeCa()` then `rm(manifestPath())` then resets `installerCalled = false`.
- [ ] **1.3** Delete the `untrust` method at `trust.ts:378-395` (no private helper kept).
- [ ] **1.4** Update the factory return at `trust.ts:417` to `{ install, uninstall, status }` (drop `untrust`).
- [ ] **1.5** Add AC-1 test in `trust.test.ts`: after `install` + `uninstall`, manifest absent + three CA files absent + `caTrustRemover` called exactly once.
- [ ] **1.6** Add AC-2 test: call `uninstall` twice in sequence; second call is no-op exit-0; `caTrustRemover` call count remains 1.
- [ ] **1.7** Add AC-3 test: call `uninstall` against the default capability provider (returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }`); assert success (uninstall is unconditional, not capability-gated).
- [ ] **1.8** Add AC-4 test: inject `caTrustRemover: vi.fn()` that throws; call `uninstall`; assert `result.state === "unsupported"`, manifest + CA files absent on disk, `result.reasons` contains the throw message.
- [ ] **1.9** Add AC-5 (status non-leakage) test: extend `trust.test.ts:203-217` to call `status()` after `install()` + `uninstall()` and re-assert non-leakage; also assert factory return keys are exactly `["install", "uninstall", "status"]` (public-surface narrowing).
- [ ] **1.10** Delete `trust.test.ts:183-201` (the now-obsolete `untrust` test).
- [ ] **1.11** Run `pnpm --filter @rogatio/runtime test` and confirm green.

## Phase 2 — CLI dispatch (`packages/cli/src/commands/runtime.ts`, `packages/cli/src/index.ts`)

- [x] **2.1** Drop `"untrust"` from the `runtimeCommand` overload union at `runtime.ts:289-304`. Final: `["install" | "uninstall" | "host", ...string[]]`.
- [x] **2.2** Delete the `case "untrust":` branch from `trustRuntimeCommand` at `runtime.ts:159-182`.
- [x] **2.3** Rewrite the `case "uninstall":` branch to call the new unified `controller.uninstall()` and use the locked success message: `"runtime uninstall complete: manifest + device-local CA removed"`.
- [x] **2.4** Drop `first === "untrust"` from the routing clause at `runtime.ts:315-320`.
- [x] **2.5** Update the long-form error at `runtime.ts:325-326` to `install|uninstall`.
- [x] **2.6** Edit `showRuntimeHelp` at `runtime.ts:20-51`: delete the `untrust` line; rewrite the `uninstall` line to `uninstall Remove the native-messaging host manifest and the device-local CA trust (idempotent)`.
- [x] **2.7** Edit the second copy of `showRuntimeHelp` at `packages/cli/src/index.ts:162-198`: identical edits to 2.6 (must stay byte-identical to the first copy).
- [x] **2.8** Update the top-level help at `packages/cli/src/index.ts:116` to `runtime <install|uninstall|host>`.
- [x] **2.9** Add new test in `runtime-command.test.ts` (sibling of the existing `trust → exit 2` test): `runtimeCommand(["untrust"])` returns 2, error contains `"rogatio runtime"` (long-form error path per R-3), help text printed.
- [x] **2.10** Extend the help-text negative assertion at `runtime-command.test.ts:22-31` to also assert `not.toMatch(/^ {2}untrust\b/m)`.
- [x] **2.11** `diff` the two `showRuntimeHelp` copies to confirm byte-identical (trust-commands block + uninstall line confirmed identical; only Options order and `Exit codes:` block differ — pre-existing).
- [x] **2.12** Run `pnpm --filter @rogatio/cli test` and confirm green (80/81 pass; pre-existing `editor-asset-paths.test.ts` failure is locked decision #5b's responsibility, Phase 5).

## Phase 3 — Frozen F16 spec/plan footers (append-only)

- [ ] **3.1** Append `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` to `docs/specs/f16-request-body-trust.md:18-19` (verb-list enumeration).
- [ ] **3.2** Append footer to `docs/specs/f16-request-body-trust.md:30-31` (CLI surface enumeration).
- [ ] **3.3** Append footer to `docs/specs/f16-request-body-trust.md:58-59` (`CLI operator` enumeration).
- [ ] **3.4** Append footer to `docs/specs/f16-request-body-trust.md:104-106` (REQ-004 enumeration).
- [ ] **3.5** Append footer to `docs/specs/f16-request-body-trust.md:134-136` (REQ-011: `uninstall()` semantic widens).
- [ ] **3.6** Append footer to `docs/specs/f16-request-body-trust.md:141-143` (REQ-013: `untrust()` removed).
- [ ] **3.7** Append footer to `docs/specs/f16-request-body-trust.md:289-291` (`uninstall/untrust are idempotent` clause).
- [ ] **3.8** Append footer to `docs/specs/f16-request-body-trust.md:316-318` (AC-006: `untrust()` reference).
- [ ] **3.9** Append footer to `docs/specs/f16-request-body-trust.md:324-326` (AC-008 enumeration).
- [ ] **3.10** Append footer to `docs/plans/f16-request-body-trust.md:29-40` (T4 controller lifecycle).
- [ ] **3.11** Append footer to `docs/plans/f16-request-body-trust.md:45-51` (T6 CLI surface).
- [ ] **3.12** Append footer to `docs/plans/f16-request-body-trust.md:79-81` (Rollback note).
- [ ] **3.13** Append footer to `docs/specs/cli-activate-deactivate-removal.md:33` (trust lifecycle enumeration).
- [ ] **3.14** Append footer to `docs/specs/cli-activate-deactivate-removal.md:42` ("We are not removing `install|trust|untrust|uninstall`").
- [ ] **3.15** Append footer to `docs/specs/cli-activate-deactivate-removal.md:66` ("`install|trust|untrust|uninstall` → unchanged").
- [ ] **3.16** Append footer to `docs/specs/cli-activate-deactivate-removal.md:131` ("`install|trust|untrust|uninstall|host` continue to work").
- [ ] **3.17** Append footer to `docs/specs/f19-docs-site.md:68` (NEW — verb-list enumeration).
- [ ] **3.18** Append footer to `docs/specs/consolidated-native-runtime.md:119` (NEW — CA verb list).
- [ ] **3.19** Append footer to `docs/plans/consolidated-native-runtime.md:61` (NEW — `trust.ts` controller surface).
- [ ] **3.20** Append footer to `docs/plans/cli-activate-deactivate-removal.md:96` (NEW — `keep install|trust|untrust|uninstall and host`).
- [ ] **3.21** Append footer to `docs/plans/f17-request-body-rules.md:201` (NEW — `Preserve explicit trust, untrust, install, uninstall`).
- [ ] **3.22** Append footer to `docs/plans/f17-request-body-rules.md:460` (NEW — `untrust and uninstall remain explicit user actions`).
- [ ] **3.23** Verify by grepping `untrust` across `docs/specs/*.md` and `docs/plans/*.md`; every match must sit on a `> Superseded by:` footer line (PR #79's or this PR's).

## Phase 4 — Live documentation updates

- [ ] **4.1** Update `README.md:128`: pipe list `<install|trust|untrust|uninstall>` → `<install|uninstall>`; rewrite the description to reflect the unified `uninstall` semantic. **(locked decision #5a — the one Phase 4 task PR #79 missed)**
- [ ] **4.2** Update `docs/architecture.md:341`: pipe list `install | untrust | uninstall` → `install | uninstall`.
- [ ] **4.3** Update `docs/architecture.md:344`: delete the `untrust` bullet.
- [ ] **4.4** Update `docs/architecture.md:345`: rewrite the `uninstall` bullet to describe the unified semantic.
- [ ] **4.5** Update `docs/architecture.md:352`: `install/uninstall/untrust/status` → `install/uninstall/status`.
- [ ] **4.6** Update `rogatio-overview.md:35`: drop `rogatio runtime untrust to remove the CA trust, and` clause.
- [ ] **4.7** Update `samples/basic/README.md:117-118`: `remove trust/host with rogatio runtime untrust and rogatio runtime uninstall` → `remove the host and CA trust with rogatio runtime uninstall`.
- [ ] **4.8** Update `packages/cli/README.md:42`: `<install|untrust|uninstall>` → `<install|uninstall>`.
- [ ] **4.9** Update `packages/docs-site/src/content/docs/guides/runtime.md:16`: drop `untrust` from pipe list.
- [ ] **4.10** Update `packages/docs-site/src/content/docs/reference/cli.md:34`: drop `untrust` from pipe list.
- [ ] **4.11** Update `packages/docs-site/src/content/docs/reference/platforms.md:25`: drop `untrust` from pipe list.
- [ ] **4.12** Verify `packages/docs-site/src/content/docs/rules/request-body.md:26` already post-#79 wording (no edit needed; research confirms).
- [ ] **4.13** Update `AGENTS.md:26`: drop `activate | deactivate | status | trust | untrust |` from the verb list; the remaining verbs are `install | uninstall | host`. **(added per plan-review human-gate decision)**
- [ ] **4.14** Grep `untrust` across all live documentation files; confirm zero matches.

## Phase 5 — Final verification

- [ ] **5.1** **Dedicated `editor-asset-paths.test.ts` investigation** (per locked decision #5b): run `pnpm --filter @rogatio/cli build` to materialize `dist/editor/`; run the test in isolation; if it fails, capture the cause and determine whether this PR caused it (it should not — this PR doesn't touch the editor package); fix if regression, document as known-failure otherwise.
- [ ] **5.2** Run `pnpm validate` end-to-end (canonical sequence: format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright).
- [ ] **5.3** Confirm `pnpm --filter @rogatio/runtime test` and `pnpm --filter @rogatio/cli test` pass.
- [ ] **5.4** Grep `untrust` across the live documentation files (allow substrings like `uninstall` and `distrust`; reject the verb `untrust` as a top-level CLI subcommand). Per AC-6, **zero matches**.
- [ ] **5.5** Grep `untrust` across `docs/specs/*.md` and `docs/plans/*.md`; every match must sit on a `> Superseded by:` footer line.
- [ ] **5.6** Document any remaining known-failures in the verify output (capture stdout/stderr evidence).
- [ ] **5.7** Fix mechanical failures in place (formatting, imports, unused-variable warnings).
- [ ] **5.8** Confirm no new exports from `@rogatio/runtime` (factory return narrows from 4 to 3 methods; `export * from "./trust.js"` at `packages/runtime/src/index.ts:23` is unchanged).
- [ ] **5.9** Confirm `editor-asset-paths.test.ts` final state — pass, fixed, or documented.