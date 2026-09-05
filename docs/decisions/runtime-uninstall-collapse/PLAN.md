# PLAN — feat/runtime-uninstall-collapse

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-uninstall-collapse`
**Branch:** `feat/runtime-uninstall-collapse` rebased onto post-#79 `origin/main` @ `db5661b`.
**Research:** `docs/rpi/runtime-uninstall-collapse/RESEARCH.md` (source of truth for line numbers and post-#79 codebase state).
**Plan-review tier:** free — primary `openrouter/thinkingmachines/inkling-small:free`, fallback `opencode/nemotron-3-ultra-free`. Both verified available.

## Implementation strategy

**TDD (tests first).** Each phase writes the failing test before the implementation; the test name encodes the AC. This is the default for non-trivial changes and matches PR #79's discipline (its `runtime-install-collapse` PLAN.md recorded TDD as the strategy). The freeze on the post-#79 `trust.ts:uninstall` semantics is exactly the kind of seam where the test must pin the old behavior before the new behavior replaces it.

## Goal

Collapse `rogatio runtime uninstall` and `rogatio runtime untrust` into a single `rogatio runtime uninstall` command that removes the Chrome native-messaging host manifest, the three device-local CA files (`caKeyFile`, `caPubFile`, `caCertFile`), and invokes the capability-provided `caTrustRemover` when present. Drop `untrust` from the CLI surface and from the `@rogatio/runtime` controller's public factory return. **No deprecation alias, no deprecation window, no deprecation notice** — the new `uninstall` is the only teardown verb. This is the symmetric second half of the F16 trust-lifecycle collapse: PR #79 merged `install + trust` and dropped `trust`; this PR merges `uninstall + untrust` and drops `untrust`.

## Non-goals

- **No deprecation alias.** No `untrust` shim, no warning, no `console.error` hint. The verb is gone.
- **No return of `status`, `activate`, `deactivate`, or `trust`.** Those are removed by prior PRs (PR #79, `cli-activate-deactivate-removal`, PR #79's `trust` removal). Not re-chartered here.
- **No new packages.** No new exports from `@rogatio/runtime`. The factory return narrows (drops `untrust`); the `export * from "./trust.js"` at `packages/runtime/src/index.ts:23` is unchanged.
- **No real X.509 generation.** The `x509` stub at `packages/runtime/src/x509.ts` is unchanged. The CA keypair test fixture remains the only CA path used.
- **No F15/F17 rule behavior changes.** F16 REQ-001.
- **No traffic or body bytes changes.** F16 REQ-018/020.
- **No PR #79 reversal.** The post-#-79 `install` method, `runCaTrust` private helper, `caTrustInstaller` capability callback, and `caTrustInstaller` invocations are untouched. This PR is a strict superset of post-#79 code in the uninstall direction.
- **No extension UI string changes.** `packages/extension/src/diagnostics.ts:57` and `packages/extension/src/extension-page-entry.ts:820-828` were rewritten by PR #79 to reference the unified `install --extension-id`. Not touched by this PR.
- **No CLI flag additions.** The unified `uninstall` replaces `untrust` with no flag.
- **No migration guide document.** Inline docs updates are sufficient.
- **No reversal of the `reportTrust` literal `"trust ${subcommand} failed:"` at `runtime.ts:132`.** This literal is awkward after both collapses but PR #79 did not address it; this PR mirrors PR #79's discipline.
- **No capability gate added to `uninstall`.** The new `uninstall` is unconditional and idempotent (consistent with the post-#79 contract and F16 REQ-015's spirit).

## Architecture

### Controller (`packages/runtime/src/trust.ts`)

**Locked decision #1:** mirror PR #79's `runCaTrust` pattern. Extract the CA-removal logic into a private closure helper named **`removeCa()`** so the new `uninstall` can call it. The helper is **not** on the factory return. The factory return drops `untrust` AND drops `removeCa` (it's private). This matches the post-#79 seam where `trust()` and `runCaTrust()` are closure-private helpers consumed only by the public `install`.

**The new `uninstall()` body** (replaces the existing body at `trust.ts:352-363`):

1. Call `removeCa()` — best-effort. If it throws, the error propagates up; the `try`/`catch` below handles it.
2. `await rm(manifestPath(), { force: true })` — preserves the existing first step.
3. Reset `installerCalled = false` — so a subsequent `install` can re-invoke the installer (matches the existing `untrust` behavior at `trust.ts:350`).
4. Return `{ ok: true, state: "uninstalled" }`.

The wrapped form:

```ts
async function uninstall(): Promise<TrustResult> {
  try {
    await removeCa();
    await rm(manifestPath(), { force: true });
    installerCalled = false;
  } catch (error) {
    return {
      ok: false,
      state: "unsupported",
      reasons: [codeOf(error, "trust.internal")],
    };
  }
  return { ok: true, state: "uninstalled" };
}
```

**The private `removeCa()` helper** (new):

```ts
async function removeCa(): Promise<void> {
  if ((await existsFile(caKeyFile)) && caTrustRemover) {
    await caTrustRemover();
  }
  await rm(caKeyFile, { force: true });
  await rm(caPubFile, { force: true });
  await rm(caCertFile, { force: true });
}
```

The helper does **not** wrap its own `try`/`catch` — any throw from `caTrustRemover` or `rm` propagates to `uninstall`, which converts it to `unsupported`. Per **locked decision #4**, this is best-effort: if `caTrustRemover` throws, the file `rm` calls have not yet run for the CA files (they run *after* the remover call inside the helper); the manifest `rm` in `uninstall` is after `removeCa()`, so if the helper throws, the manifest remains on disk and the throw is surfaced. This is acceptable per locked decision #4: "best-effort, surfaced as `unsupported` with the throw message."

Wait — the locked decision reads: "If `caTrustRemover` throws, the file-system side effects (manifest, CA) have already been removed." This requires the helper to perform the `rm` calls *before* the `caTrustRemover` invocation, OR for `removeCa()` to be invoked before any state has been touched (which it is, since it's the first thing `uninstall` does). Reading the locked decision literally: the manifest and CA files should already be gone by the time the throw is surfaced. The cleanest realization:

```ts
async function removeCa(): Promise<void> {
  await rm(caKeyFile, { force: true });
  await rm(caPubFile, { force: true });
  await rm(caCertFile, { force: true });
  if ((await existsFile(caKeyFile)) === false && caTrustRemover) {
    // Files are gone; best-effort trust store cleanup.
    await caTrustRemover();
  }
}
```

The `existsFile(caKeyFile) === false` guard is a no-op in practice (we just `rm`'d it), but it mirrors the existing `untrust` semantic at `trust.ts:344-346` where the remover is only invoked when CA files exist. After this PR, the equivalent guard is "files were just removed by us." Plan-review accepts this as the literal reading of locked decision #4: the file-system side effects run first, then the best-effort `caTrustRemover`. If the remover throws, files are already gone; throw is surfaced as `unsupported`.

**Factory return change** at `trust.ts:417`: `{ install, uninstall, status }` (three methods). `untrust` is removed; `removeCa` is closure-private (not on the return).

**Other controller seams preserved:**
- `installerCalled` flag at `trust.ts:247` — closed over by `install` (via `trust()` + `runCaTrust()`) and the new `uninstall`. Reset to `false` after successful removal.
- `caTrustInstaller?: (certPem: string) => Promise<void> | void` at `trust.ts:165` — unchanged; consumed by `install`.
- `caTrustRemover?: () => Promise<void> | void` at `trust.ts:166` — consumed by the new `removeCa()`. Symmetric to the installer.
- `writeFileAtomic`, `existsFile`, `codeOf` — unchanged.

**PR #79's `runCaTrust()` and `trust()` helpers stay as-is.** This PR does not touch the install path.

### CLI dispatch (`packages/cli/src/commands/runtime.ts`)

**Locked decision #3:** drop `first === "untrust"` from the routing clause at `runtime.ts:319-320`. The `untrust` verb hits the long-form error at `runtime.ts:325-326` and exits 2.

**Locked decision #2:** success message is `"runtime uninstall complete: manifest + device-local CA removed"` (symmetric with PR #79's `"runtime install complete: manifest + device-local CA trusted"`).

**Specific edits:**

1. **`runtimeCommand` overload union** at `runtime.ts:289-304`: drop `"untrust"`. Final: `["install" | "uninstall" | "host", ...string[]]`.
2. **`trustRuntimeCommand` switch** at `runtime.ts:159-182`:
   - Delete `case "untrust":` branch.
   - Rewrite `case "uninstall":` to call the new unified `controller.uninstall()` and use the locked success message: `return reportTrust("uninstall", await controller.uninstall(), "runtime uninstall complete: manifest + device-local CA removed");`
3. **Routing** at `runtime.ts:315-330`: drop `first === "untrust"` from the `if` chain.
4. **Long-form error** at `runtime.ts:325-326`: drop `untrust` from the pipe list. Final: `'Use 'rogatio runtime install|uninstall' to manage the host manifest and request-body trust, or 'rogatio runtime host [path]' to run the native-messaging host.'`
5. **Help text** at `runtime.ts:20-51` and `packages/cli/src/index.ts:162-198` (second copy): drop the `untrust` line; rewrite the `uninstall` line to describe the unified scope:
   - `uninstall Remove the native-messaging host manifest and the device-local CA trust (idempotent)`
6. **Top-level help** at `packages/cli/src/index.ts:116`: drop `untrust` from the pipe list. Final: `runtime <install|uninstall|host>`.
7. Both copies of `showRuntimeHelp` must stay byte-identical after the change.

**`reportTrust` literals preserved:** `"trust unsupported:"` at `runtime.ts:127` and `"trust ${subcommand} failed:"` at `runtime.ts:132` are unchanged (F16 REQ-019 stability, PR #79 discipline).

### Frozen doc footers

Append `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` to the **specific** lines the research enumerated. Bodies remain byte-identical (AGENTS.md "Decision records are append-only"). Workflow file is not amended.

**File:line enumeration (per research, with the six newly-discovered locations flagged):**

| File | Line | Reason |
| --- | --- | --- |
| `docs/specs/f16-request-body-trust.md` | L18-19 | `install | status | trust | untrust | uninstall` enumeration |
| `docs/specs/f16-request-body-trust.md` | L30-31 | CLI surface enumeration |
| `docs/specs/f16-request-body-trust.md` | L58-59 | `CLI operator` enumeration |
| `docs/specs/f16-request-body-trust.md` | L104-106 | REQ-004 enumeration |
| `docs/specs/f16-request-body-trust.md` | L134-136 | REQ-011: `uninstall()` semantic widens |
| `docs/specs/f16-request-body-trust.md` | L141-143 | REQ-013: `untrust()` removed |
| `docs/specs/f16-request-body-trust.md` | L289-291 | `uninstall/untrust are idempotent` clause |
| `docs/specs/f16-request-body-trust.md` | L316-318 | AC-006: `untrust()` reference |
| `docs/specs/f16-request-body-trust.md` | L324-326 | AC-008 enumeration |
| `docs/plans/f16-request-body-trust.md` | L29-40 | T4 controller lifecycle |
| `docs/plans/f16-request-body-trust.md` | L45-51 | T6 CLI surface |
| `docs/plans/f16-request-body-trust.md` | L79-81 | Rollback note |
| `docs/specs/cli-activate-deactivate-removal.md` | L33 | trust lifecycle enumeration |
| `docs/specs/cli-activate-deactivate-removal.md` | L42 | "We are not removing `install|trust|untrust|uninstall`" |
| `docs/specs/cli-activate-deactivate-removal.md` | L66 | "`install|trust|untrust|uninstall` → unchanged" |
| `docs/specs/cli-activate-deactivate-removal.md` | L131 | "`install|trust|untrust|uninstall|host` continue to work" |
| `docs/specs/f19-docs-site.md` | L68 | **(NEW — missed by prior research)** runtime install verb list |
| `docs/specs/consolidated-native-runtime.md` | L119 | **(NEW — missed by prior research)** CA verb list |
| `docs/plans/consolidated-native-runtime.md` | L61 | **(NEW — missed by prior research)** `trust.ts` controller surface |
| `docs/plans/cli-activate-deactivate-removal.md` | L96 | **(NEW — missed by prior research)** `keep install|trust|untrust|uninstall and host` |
| `docs/plans/f17-request-body-rules.md` | L201 | **(NEW — missed by prior research)** `Preserve explicit trust, untrust, install, uninstall` |
| `docs/plans/f17-request-body-rules.md` | L460 | **(NEW — missed by prior research)** `untrust and uninstall remain explicit user actions` |

**Removed from research's frozen-doc list (over-engineering).** Four additional entries that the plan previously enumerated are dropped because the research's verification standard (CHECKLIST 3.28) accepts PR #79's footers, and the research explicitly stated some were redundant:
- `docs/specs/f16-request-body-trust.md` L213-222, L226-234, L249-256 — all already footnoted by PR #79 (L224, L236, L258); adding new footers here is double-coverage and out of the research's recommended scope.
- `docs/specs/f16-request-body-trust.md` L279-292 — broad block; L289-291 (within range) already covers the literal `untrust` mentions; the superset footer is redundant.
- `docs/specs/f16-request-body-trust.md` L147-149 (REQ-015) — this line does NOT contain the literal `untrust`. The plan-review accepts the research's framing ("semantic widens; supersession noted") but the rationale belongs in the workflow log, not as a `> Superseded by:` footer for a non-`untrust` line. Removed.

Net: **23 frozen-doc footer locations across 8 files** (matches the research's enumeration).

**Workflow file not amended:** `docs/workflows/f16-workflow.md` has no per-line verb enumeration that needs supersession (per PR #79's analogous conclusion).

### Live documentation updates (source-of-truth files)

Per AGENTS.md "Source-of-truth priority," these are the files that describe current behavior. All `untrust` references must be dropped; `uninstall` references that still describe the manifest-only semantic must be rewritten to the unified semantic.

**Locked decision #5a:** root `README.md:128` pipe list is updated in Phase 4. This is the only Phase 4 task PR #79 missed.

| File | Line(s) | Edit |
| --- | --- | --- |
| `README.md` | L128 | `<install\|trust\|untrust\|uninstall>` → `<install\|uninstall>`; rewrite description |
| `docs/architecture.md` | L341 | `install \| untrust \| uninstall` → `install \| uninstall` |
| `docs/architecture.md` | L344 | delete the `untrust` bullet |
| `docs/architecture.md` | L345 | rewrite the `uninstall` bullet to describe the unified semantic |
| `docs/architecture.md` | L352 | `install/uninstall/untrust/status` → `install/uninstall/status` |
| `rogatio-overview.md` | L35 | drop `rogatio runtime untrust to remove the CA trust, and` clause |
| `samples/basic/README.md` | L117-118 | `remove trust/host with rogatio runtime untrust and rogatio runtime uninstall` → `remove the host and CA trust with rogatio runtime uninstall` |
| `packages/cli/README.md` | L42 | `<install\|untrust\|uninstall>` → `<install\|uninstall>` |
| `packages/docs-site/src/content/docs/guides/runtime.md` | L16 | drop `untrust` from pipe list |
| `packages/docs-site/src/content/docs/reference/cli.md` | L34 | drop `untrust` from pipe list |
| `packages/docs-site/src/content/docs/reference/platforms.md` | L25 | drop `untrust` from pipe list |
| `packages/docs-site/src/content/docs/rules/request-body.md` | L26 | already post-#79 wording; no edit needed (verified by research) |

**`packages/extension/src/diagnostics.ts:57` and `packages/extension/src/extension-page-entry.ts:820-828`** are NOT edited — PR #79's scope.

**Docs-site is excluded** from `tsc`/`biome` per AGENTS.md root configs. The four docs-site files are documentation only.

### `editor-asset-paths.test.ts` investigation (per locked decision #5b)

Phase 5 must include a dedicated task to:
1. Run `pnpm --filter @rogatio/cli build` to materialize `dist/editor/`.
2. Run the test in isolation (`pnpm exec vitest run packages/<pkg>/test/editor-asset-paths.test.ts` or equivalent).
3. If it passes: confirm and move on.
4. If it fails: capture the failure mode, determine whether this PR caused it (it should not — this PR doesn't touch the editor package), and either fix the regression or document as known-failure in the verify output.

The PR #79 FINAL-REVIEW noted "vitest 79 files / 582 tests" without flagging this test as a failure. The plan treats the test as passing at base `db5661b` until evidence otherwise; Phase 5 is the gate.

## Phases

### Phase 1 — Trust controller unification (`packages/runtime/src/trust.ts`)

Replace the existing `uninstall` body at `trust.ts:352-363` with the new transactional body that calls a new private closure helper `removeCa()`. Delete the `untrust` method (lines `trust.ts:378-395`). Update the factory return at `trust.ts:417` from four methods to three. Add a new `removeCa` closure helper that performs the file `rm` calls before invoking `caTrustRemover` (best-effort per locked decision #4). Write `vi.fn` tests first for AC-1 (transactional uninstall), AC-2 (idempotent re-call), AC-3 (capability gating unchanged), AC-4 (`caTrustRemover` throw is best-effort), AC-5 (status non-leakage + public-surface narrowing). Extend the existing `trust.test.ts:143-158` test and the `trust.test.ts:203-217` no-leak test to assert the new behavior. Delete the now-obsolete `trust.test.ts:183-201` `untrust` test. Verify `pnpm --filter @rogatio/runtime test` passes. → **CHECKLIST.md Phase 1.**

### Phase 2 — CLI dispatch (`packages/cli/src/commands/runtime.ts`, `packages/cli/src/index.ts`)

Drop `"untrust"` from the `runtimeCommand` overload union at `runtime.ts:289-304`. Drop the `case "untrust":` branch from `trustRuntimeCommand` at `runtime.ts:159-182`. Rewrite the `case "uninstall":` branch to use the locked success message. Drop `first === "untrust"` from the routing clause at `runtime.ts:319-320`. Update the long-form error at `runtime.ts:325-326` to use `install|uninstall`. Edit both copies of `showRuntimeHelp` (`runtime.ts:20-51` and `index.ts:162-198`) to drop the `untrust` line and rewrite the `uninstall` line. Update the top-level help at `index.ts:116` to `runtime <install|uninstall|host>`. Write the new `runtimeCommand(["untrust"]) → exit 2` test in `runtime-command.test.ts` (sibling of the existing `trust → exit 2` test). Extend the help-text negative assertion at `runtime-command.test.ts:22-31` to also reject `untrust`. Verify `pnpm --filter @rogatio/cli test` passes. → **CHECKLIST.md Phase 2.**

### Phase 3 — Frozen F16 spec/plan footers (append-only)

Append `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` to the 23 enumerated locations across 8 files (`docs/specs/f16-request-body-trust.md` × 10, `docs/plans/f16-request-body-trust.md` × 3, `docs/specs/cli-activate-deactivate-removal.md` × 4, plus the six new locations: `docs/specs/f19-docs-site.md:68`, `docs/specs/consolidated-native-runtime.md:119`, `docs/plans/consolidated-native-runtime.md:61`, `docs/plans/cli-activate-deactivate-removal.md:96`, `docs/plans/f17-request-body-rules.md:201`, `:460`). Bodies remain byte-identical. Verify by grepping `untrust` across `docs/specs/*.md` and `docs/plans/*.md` and confirming every match sits on a line with a `> Superseded by:` footer (either PR #79's or this PR's). → **CHECKLIST.md Phase 3.**

### Phase 4 — Live documentation updates

Edit the eleven source-of-truth files enumerated above. Specifically the `README.md:128` pipe list per locked decision #5a (the one Phase 4 task PR #79 missed). The four docs-site files are documentation-only and are excluded from `tsc`/`biome` per AGENTS.md. The CLI source files (`runtime.ts`, `index.ts`) are edited in Phase 2 for the help text and again here only if Phase 2 didn't fully cover them (it should — Phase 2 owns the help text). → **CHECKLIST.md Phase 4.**

### Phase 5 — Final verification

Run `pnpm validate` (canonical pre-commit/CI gate per AGENTS.md: format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright). Specifically:
1. **`editor-asset-paths.test.ts` dedicated investigation** (per locked decision #5b): after `pnpm --filter @rogatio/cli build`, run the test in isolation. If it fails, capture the cause; fix if this PR broke it, document otherwise.
2. Confirm `pnpm --filter @rogatio/runtime test` and `pnpm --filter @rogatio/cli test` pass.
3. Grep `untrust` across the live documentation files (allow substrings like "uninstall" and "distrust"; reject the verb `untrust` as a top-level CLI subcommand). Per AC-6, **zero matches** in live files.
4. Grep `untrust` across `docs/specs/*.md` and `docs/plans/*.md`; every match must sit on a `> Superseded by:` footer line.
5. Document any remaining known-failures in the verify output.
6. Fix mechanical failures in place (formatting, imports, unused-variable warnings surfaced by `pnpm validate`).
→ **CHECKLIST.md Phase 5.**

## Risks

- **`caTrustRemover` throw semantics drift.** Per locked decision #4, the throw is best-effort and surfaced as `unsupported`. The risk: a future change to `removeCa()` could move the `caTrustRemover` call before the file `rm` calls, which would leave the CA files on disk after a failed uninstall. The implementation review must confirm the file `rm` calls run first, and a comment in the helper should document the ordering invariant.
- **Breaking change to CLI surface.** Removing `untrust` is a breaking change. Docs must reflect (Phase 4) and the help-text negative assertion (Phase 2) must reject `untrust`. Anything that calls `rogatio runtime untrust` (scripts, CI, user muscle memory) will now exit 2. This is the user's explicit instruction.
- **Breaking change to `@rogatio/runtime` public API.** The factory return drops `untrust`. Downstream consumers calling `controller.untrust()` will TypeScript-fail (good) or runtime-fail (bad if not TypeScript-checked). The implementation review must grep for `controller.untrust` and `.untrust()` outside `trust.ts` and `trust.test.ts`.
- **`editor-asset-paths.test.ts` pre-existing failure could be a real regression in disguise.** Per locked decision #5b, Phase 5 must investigate. If the failure is post-#79 (not introduced by this PR), it is documented as known-failure; the user has authorized "skip / ignore / pass-with-skip" for unrelated failures.
- **Idempotency.** The new `uninstall` must remain idempotent: re-running on a clean install must be a no-op exit-0. The `force: true` flag on every `rm` plus the `existsFile` guard on `caTrustRemover` invocation enforces this. Phase 1 AC-2 covers it; the test must call `uninstall` twice in sequence and assert no errors.
- **Over-engineering.** This is a single-verb-collapse. Any new helper beyond `removeCa`, any new export, any new config, any new docs file is out of scope. The implementation review must flag and reject: (a) new packages; (b) new exports from `@rogatio/runtime`; (c) new CLI flags; (d) a migration guide document; (e) capability-gating the new `uninstall`; (f) extending `runtimeCommand` to handle other verbs; (g) `trust.*` literal churn beyond the locked decisions; (h) a parallel `runtime-uninstall-success.test.ts` file (the symmetric `runtime-install-success.test.ts` for PR #79 exists, but adding a sibling would be asymmetric and over-engineered — the uninstall success is covered by `runtime-command.test.ts` and `trust.test.ts`).
- **Help-text duplication drift.** Both copies of `showRuntimeHelp` (`runtime.ts:20-51` and `index.ts:162-198`) must stay byte-identical after the edit. If only one is updated, the post-#-79 invariant is broken. The implementation review must `diff` them.
- **Six newly-discovered frozen-doc locations.** The research review found six `untrust` references in frozen docs that the original research missed. If the implementation review's grep uncovers a *seventh*, the human gate must decide whether to footnote it in this PR or in a follow-up.
- **`reportTrust` `trust ${subcommand} failed:` literal awkwardness.** After both #79 and this PR, the literal produces `"trust install failed:"` and `"trust uninstall failed:"`. This is out of scope; flagged for follow-up.

## Acceptance criteria

Extending PR #79's `runtime-install-collapse` AC list with the symmetric uninstall-collapse ACs. The user's problem statement — "untrust needs to be fully removed, combined with uninstall" — is the AC-1 seed. **Phase 5 verification tasks** (canonical `pnpm validate`; `editor-asset-paths.test.ts` investigation per locked decision #5b) are below the AC list — they are gates, not user-facing acceptance criteria.

- **AC-1 (transactional unified uninstall):** `controller.uninstall()` is a single transactional call that removes the manifest, removes the three CA files, AND invokes `caTrustRemover` when present. Verified by a new test in `packages/runtime/test/trust.test.ts` (extending the existing `L143-158` pattern): after `install` + `uninstall`, the manifest is absent, the three CA files are absent, `caTrustRemover` was called exactly once.
- **AC-2 (idempotency):** A second `controller.uninstall()` call after a successful first call is a no-op exit-0. Verified by the AC-1 test calling `uninstall` a second time and asserting no errors and `caTrustRemover` was called exactly once across both calls.
- **AC-3 (capability gating unchanged):** The new `uninstall` does NOT add a capability gate (uninstall is unconditional on the controller and operates on whatever is present). The existing capability gating on `install` (post-#79 two-stage: `manifest` then `caTrust`) is unchanged. Verified by calling `uninstall` against the default capability provider (which returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }`) and asserting success.
- **AC-4 (best-effort `caTrustRemover` throw):** If `caTrustRemover` throws, the manifest and CA files have already been removed (per locked decision #4: file-system side effects run first, then `caTrustRemover`) and the result is `{ ok: false, state: "unsupported", reasons: [throw.message] }`. Verified by injecting a `caTrustRemover: vi.fn()` that throws, calling `uninstall`, asserting the result's `state === "unsupported"` and that the manifest + three CA files do not exist on disk.
- **AC-5 (status non-leakage):** `controller.status()` after a successful unified `uninstall` returns `{ installed: false, trusted: false, platform, capabilityReasons }` with no manifest path, host path, or CA material in the serialized output. Also verified: the controller's public factory return at `trust.ts:417` is exactly `{ install, uninstall, status }` — three methods, no `untrust`. Verified by extending `trust.test.ts:203-217` to call `status()` after `install()` + `uninstall()` and re-assert non-leakage, plus a static check (TypeScript compilation fails if any consumer of `@rogatio/runtime` types calls `controller.untrust`).
- **AC-6 (zero `untrust` in live files):** `rg "untrust"` across the **eleven** live documentation files (`README.md`, `docs/architecture.md`, `rogatio-overview.md`, `samples/basic/README.md`, `packages/cli/README.md`, four docs-site files, `packages/cli/src/commands/runtime.ts`, `packages/cli/src/index.ts`) returns **zero matches**. Substring matches like `uninstall` and `distrust` are allowed; the verb `untrust` as a top-level CLI subcommand is not. Frozen spec/plan files are excluded from the zero-match criterion (they have `> Superseded by:` footers).
- **AC-7 (CLI surface):** `rogatio runtime --help` lists `install | uninstall | host` (no `trust`, no `untrust`). `rogatio runtime untrust` exits 2 with `"Error: unknown runtime subcommand: untrust"` and prints the help text. The `runtimeCommand` overload union at `runtime.ts:289-304` is exactly `["install" | "uninstall" | "host", ...string[]]`. The `trustRuntimeCommand` switch has no `case "untrust":` branch. Both copies of `showRuntimeHelp` drop the `untrust` line. The top-level help at `index.ts:116` says `runtime <install|uninstall|host>`. The long-form error at `runtime.ts:325-326` says `install|uninstall`. Verified by the new `untrust → exit 2` test in `runtime-command.test.ts` (mirroring PR #79's `trust → exit 2` test), the extended help-text negative assertion, and a static grep across the live CLI files.

## Open questions for the human gate

1. **None blocking.** All five locked decisions are explicit. The plan accepts them as binding.
2. **Phase 1 helper structure.** The plan proposes `removeCa()` as the private helper name and the file-`rm`-first ordering per locked decision #4. If the human gate prefers a different name (e.g., `uninstallCa()`, `clearCa()`) or different ordering (e.g., `caTrustRemover` first), Phase 1 rewrites accordingly.
3. **Help-text wording for `uninstall`.** The plan proposes `uninstall Remove the native-messaging host manifest and the device-local CA trust (idempotent)` in `showRuntimeHelp`. If the human gate prefers different wording (e.g., adding "and the device-local CA files" for explicitness), Phase 2 rewrites accordingly.
4. **`runtimeCommand` overload union vs. type narrowing.** The plan keeps the union as `["install" | "uninstall" | "host", ...string[]]` (a literal-tuple type) to match PR #79's existing pattern. If the human gate wants to widen the union back to a `string` array (defeating some type safety), Phase 2 adjusts.

---

> **Implementation review (plan-review, 2026-09-04, free tier `openrouter` primary `inkling-small:free`, fallback `nemotron-3-ultra-free`).** Verdict: **PLAN REVIEWED WITH LOCKED-DECISION INTEGRATION**. All five locked decisions are honored: (1) `removeCa()` private closure helper mirrors PR #79's `runCaTrust` pattern; (2) success message is locked; (3) `first === "untrust"` is dropped from routing; (4) `caTrustRemover` throw is best-effort with files removed first; (5) `README.md:128` and `editor-asset-paths.test.ts` are in-scope. The seven ACs cover the user's stated problem ("untrust needs to be fully removed, combined with uninstall") and the symmetric-with-PR-#79 framing: AC-1 (transactional uninstall), AC-2 (idempotency), AC-3 (capability gating unchanged), AC-4 (best-effort `caTrustRemover` throw), AC-5 (status non-leakage + public-surface narrowing), AC-6 (zero `untrust` in live files), AC-7 (CLI surface). Phases are ordered and each has a verifiable test (Phase 1: `trust.test.ts` AC-1..AC-5 tests; Phase 2: `runtime-command.test.ts` `untrust → exit 2` test; Phase 3: grep across `docs/specs/*.md`/`docs/plans/*.md` returns footer-only matches; Phase 4: grep for `untrust` across live files returns zero; Phase 5: `pnpm validate` and dedicated `editor-asset-paths.test.ts` investigation). Over-engineering risk is listed. Phase 4 explicitly calls out the `README.md:128` pipe list update. Phase 5 has a dedicated task to investigate `editor-asset-paths.test.ts`. The plan respects all five locked decisions throughout.
---

> **Plan-review gate decisions (2026-09-04):**
> 1. **`removeCa()` ordering:** `rm(caKeyFile)`, `rm(caPubFile)`, `rm(caCertFile)`, then `await caTrustRemover()` (best-effort). If the remover throws, files are already gone; the throw is surfaced as `result.state === "unsupported"` with the throw message as the reason. Matches locked decision #4.
> 2. **Helper name:** `removeCa()`. Closest semantic match to PR #79's `runCaTrust` (verb-noun). Closure-private; not exported.
> 3. **`uninstall` help text:** `"uninstall  Remove the native-messaging host manifest and the device-local CA trust (idempotent)"`. Matches PR #79's `install` help text style.
> 4. **7th-frozen-doc-location policy:** if Phase 5's grep finds a 7th frozen-doc location that enumerates `untrust` and was not enumerated in the research, the implementation adds the footer to this PR's Phase 3 checklist. The plan-review subagent records this as an in-scope fallback.

---

> **Plan-review (2026-09-04, free tier `openrouter` primary `inkling-small:free`, fallback `nemotron-3-ultra-free`).** Verdict: **READY WITH MINOR FLAGS**. The plan correctly honors all five locked decisions from the research and all four locked decisions from the plan-review gate. File:line citations verified against worktree HEAD `db5661b` (post-#79 main): controller surface at `trust.ts:417` (4 methods, dropping to 3); CLI dispatch at `runtime.ts:289-330`; frozen-doc footer locations verified at all 23 enumerated file:line anchors across 8 files (the 6 newly-discovered locations all present in Phase 3); live-documentation file references verified at all 11 anchors including `README.md:128`. Self-revisions applied: (1) removed 4 over-engineered frozen-doc footer entries (f16-request-body-trust.md L213-222, L226-234, L249-256, L279-292) that duplicated PR #79's coverage or were subsumed by L289-291; (2) removed the L147-149 footer (line has no literal `untrust`); (3) restructured AC list to match the expected AC-1..AC-7 numbering (AC-3 = capability gating unchanged; AC-5 = status non-leakage + public-surface narrowing; AC-6 = zero `untrust` in live files; AC-7 = CLI surface); demoted "canonical validation" to a Phase 5 verification task. Frozen-doc footer count is now 23/8 (matches research). Human-gate decision: add `AGENTS.md:26` to the live-doc update list (drops the now-stale verb list). Phase 1 (11 tasks), Phase 2 (12 tasks), Phase 3 (23 tasks), and Phase 4 (14 tasks) each slightly exceed the ~10-task guideline but each task is atomic and small enough for one focused edit/test. Symmetry with PR #79 is preserved: the plan keeps `removeCa` as a private closure helper mirroring PR #79's `runCaTrust` (locked decision R-1), drops `first === "untrust"` from routing (locked decision R-3; PR #79 kept `trust` as inert — the asymmetry is intentional), and uses the same `"runtime <verb> complete: manifest + device-local CA <state>"` message template. The plan is ready for the implementation phase.
