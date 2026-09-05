# RESEARCH — feat/collapse-runtime-uninstall-and-untrust

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-uninstall-collapse`
**Branch:** `feat/runtime-uninstall-collapse` rebased onto post-#79 `origin/main` @ `db5661b` (`feat(cli)!: collapse runtime install and trust into a single install command (#69) (#79)`).
**Base branch:** `origin/main` @ `db5661b` (PR #79 has merged; this research was originally written at pre-#79 HEAD `5f31788` and re-verified against post-#79 `db5661b`).
**Investigator:** research subagent (`opencode/nemotron-3-ultra-free`, fresh context). Fallback `openrouter/thinkingmachines/inkling-small:free` available.
**Pattern reference:** `docs/rpi/runtime-install-collapse/{RESEARCH.md,PLAN.md,IMPLEMENTATION-REVIEW.md,FINAL-REVIEW.md}` (in the sibling worktree `~/.local/share/opencode/worktree/rogatio/feat/runtime-install-collapse`).

## Problem restatement (verbatim from the issue body)

> `untrust` needs to be fully removed Since it should now be combined with uninstall. Concretely: `rogatio runtime uninstall` should do what `rogatio runtime uninstall` does today **AND** what `rogatio runtime untrust` does today (remove manifest, remove CA, invoke `caTrustRemover`). The verb `untrust` is removed from the CLI surface entirely — no deprecation alias, no deprecation window, matching the prior `trust` removal pattern (PR #79). The controller's `untrust` method is also removed (no public surface); the new unified `uninstall` does the work.

This is the second half of the F16 trust-lifecycle surface collapse. The first half (PR #79, in the sibling worktree) merged `install + trust` into one verb and dropped `trust`; this PR merges `uninstall + untrust` into one verb and drops `untrust`. The two collapses are structurally symmetric: both widen one verb to do the work of two, both drop the second verb with no deprecation alias, both require a frozen-doc footer pass.

Source: `packages/{cli,runtime}/src/...` and `docs/specs/f16-request-body-trust.md` (frozen), `docs/plans/f16-request-body-trust.md` (frozen), `docs/workflows/f16-workflow.md` (frozen) at HEAD `db5661b` (post-PR-#79).

---

## Codebase findings

All paths are relative to the worktree root `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-uninstall-collapse/`.

### 1. Trust controller (`packages/runtime/src/trust.ts`)

The controller surface at HEAD `db5661b` (post-PR-#79) is **four methods** (`install`, `uninstall`, `untrust`, `status`) on the factory return at `trust.ts:417`. PR #79 widened `install` to also do the CA work and dropped `trust` from the factory return (kept as a closure-private helper used by `install` via a `runCaTrust()` private helper at `trust.ts:321-350`); this PR widens `uninstall` to also do the CA removal and drops `untrust`. Because the branch is rebased onto post-#79 main, the controller already exposes the post-#79 `install`; this PR does not need to touch it. There is **no rebase reconciliation** open question — that was resolved when the worktree was rebased.

#### Current controller surface at HEAD `db5661b` (post-PR-#79)

| Method | File:line | Current behavior | After this PR |
| --- | --- | --- | --- |
| `install(extensionId)` | `trust.ts:249-319` | Validates extensionId, writes manifest only as step 1; PR #79 widened this to do CA + installer work transactionally with rollback; calls private `trust()` helper which calls private `runCaTrust()` helper at `trust.ts:321-350`. | (Untouched by this PR.) |
| `uninstall()` | `trust.ts:352-363` | `rm(manifestPath(), { force: true })`, returns `uninstalled`. No-op when absent. | **WIDENED**: removes manifest + calls `caTrustRemover` (if present) + `rm` for the three CA files. Idempotent. |
| `trust()` | `trust.ts:365-376` | Now a private closure helper (called by `install` via `runCaTrust()` at `trust.ts:301`). Generates CA, writes key/pub/cert, invokes `caTrustInstaller`. | (Untouched by this PR.) |
| `untrust()` | `trust.ts:378-395` | If CA files exist, calls `caTrustRemover()`; `rm` key, pub, cert; resets `installerCalled`. Returns `untrusted`. Idempotent. | **REMOVED from public surface**. No private helper kept — the new `uninstall` does the work directly. |
| `status()` | `trust.ts:397-415` | `installed` from manifest presence + well-formedness; `trusted` from CA key + cert file presence. Never leaks paths. | (Unchanged.) |

Factory return at `trust.ts:417` becomes `{ install, uninstall, status }` (three methods) after both #79 and this PR land.

#### `uninstall` body at `trust.ts:352-363`

```ts
async function uninstall(): Promise<TrustResult> {
  try {
    await rm(manifestPath(), { force: true });
  } catch (error) {
    return {
      ok: false,
      state: "unsupported",
      reasons: [codeOf(error, "trust.write-failed")],
    };
  }
  return { ok: true, state: "uninstalled" };
}
```

This is the seam that grows. The new body mirrors the existing `untrust` body at `trust.ts:378-395` plus a manifest removal:

```ts
async function uninstall(): Promise<TrustResult> {
  try {
    if ((await existsFile(caKeyFile)) && caTrustRemover) {
      await caTrustRemover();
    }
    await rm(caKeyFile, { force: true });
    await rm(caPubFile, { force: true });
    await rm(caCertFile, { force: true });
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

**Rollback order question (open).** `untrust` does: remover → CA files (no manifest). The new `uninstall` does: remover → CA files → manifest. The order matters when a step throws: doing the manifest `rm` last means the `rm` calls for the CA files have already succeeded by the time the manifest `rm` runs. If the manifest `rm` throws (extremely unlikely with `force: true`), the function returns `unsupported` with the CA files already gone — that is "no partial state" (we want to leave the device as un-installed as possible). If the CA `rm` calls throw (even more unlikely), the `remover` may have already been called, leaving the OS trust store un-trusted but the files still on disk. The plan phase should commit to a rollback semantics for the `caTrustRemover` throw path — see AC-7 below and Open questions.

#### `untrust` body at `trust.ts:378-395` (to be deleted)

```ts
async function untrust(): Promise<TrustResult> {
  try {
    if ((await existsFile(caKeyFile)) && caTrustRemover) {
      await caTrustRemover();
    }
    await rm(caKeyFile, { force: true });
    await rm(caPubFile, { force: true });
    await rm(caCertFile, { force: true });
    installerCalled = false;
  } catch (error) {
    return {
      ok: false,
      state: "unsupported",
      reasons: [codeOf(error, "trust.internal")],
    };
  }
  return { ok: true, state: "untrusted" };
}
```

Per the user's "the new unified `uninstall` does the work" instruction, this method is **deleted from the controller factory return at `trust.ts:417`**. No private helper is kept — the new `uninstall` body inlines the work. This is a divergence from the prior PR #79's decision to keep `trust` as a private helper used by the new `install`; the user explicitly stated "the new unified `uninstall` does the work" so the plan should follow that direction. See Open questions.

#### `status()` body at `trust.ts:397-415` (unchanged)

`installed` derives from `manifestPath()` file presence + `isWellFormedManifest` parse (`trust.ts:399-404`); `trusted` derives from `(await existsFile(caKeyFile)) && (await existsFile(caCertFile))` (`trust.ts:406-407`). After a successful `uninstall`, both `installed` and `trusted` must be `false`; the existing tests at `trust.test.ts:143-158` and `trust.test.ts:183-201` already cover the "post-remove state" assertions. The new AC-4 (status non-leakage) re-asserts both `installed: false` and `trusted: false` plus the no-path-leak invariant.

#### Capability gate (`trust.ts:145-150`) and capability seam

`detectTrustCapabilities({ platform, manifestDir })` is pure and injectable. Default is `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` (`DEFAULT_CAPABILITIES` at `trust.ts:76-80`). The new `uninstall` does NOT need a capability gate — uninstall is unconditional on the controller. (The current `uninstall` and `untrust` do not call `detect()`; this PR preserves that. Capability gating for uninstall is not in F16 REQ-015, which mandates gating for **mutating** operations that touch the device in non-idempotent ways — uninstall is idempotent removal.) See Open questions.

#### Seams preserved at HEAD `db5661b`

- `installerCalled` flag at `trust.ts:247` — closed over by `install` (via `trust()` + `runCaTrust()`) and `untrust`. After this PR: still closed over by `install` (and not by `untrust`, since `untrust` is removed). The new `uninstall` resets it (`installerCalled = false` at the end of the success path) so a subsequent `install` can re-invoke the installer.
- `caTrustInstaller?: (certPem: string) => Promise<void> | void` at `trust.ts:165` — used by the install path (via `runCaTrust`); not used by the new `uninstall`.
- `caTrustRemover?: () => Promise<void> | void` at `trust.ts:166` — used by the new `uninstall`; symmetric to the installer. **Note:** this is the post-#-79 `caTrustRemover` capability callback that mirrors the new `caTrustInstaller`. PR #79 introduced this seam for symmetric install/removal — the new `uninstall` consumes it directly.
- `writeFileAtomic(path, data)` at `trust.ts:192-198` — used by the install path only; the uninstall path uses `rm(..., { force: true })`.
- `existsFile(path)` at `trust.ts:200-206` — used by both install (via `runCaTrust`) and uninstall.
- `codeOf(error, fallback)` at `trust.ts:208-210` — used by both paths.
- **New private helper `runCaTrust()` at `trust.ts:321-350`** — added by PR #79 as a closure-private seam inside the post-#79 `install`; performs the capability check + CA generation + `caTrustInstaller` invocation. Not used by the new `uninstall`.

#### Tests in `packages/runtime/test/trust.test.ts`

- L143-158: `uninstall is a no-op when absent and removes the manifest otherwise`. After this PR, this is now testing the unified uninstall; the existing assertions still pass (`noop.ok === true && state === "uninstalled"`, `removed.ok === true`, `status.installed === false`). The new AC-4 extends it to assert `status.trusted === false` and no CA files exist after `uninstall`. **Note:** the test at L143-158 uses `detectCapabilities: capable` but no `caTrustInstaller`, so it never provisions the CA — the test passes both before and after the unification because there are no CA files to remove.
- L183-201: `untrust removes the CA material and is a no-op when absent`. After this PR, `controller.untrust` no longer exists; this test must be **deleted** (mirrors PR #79's deletion of the analogous `trust ... capability absent` test if any).
- L203-217: `status leaks no manifest path, host path, or CA material`. Extended by AC-4 to also assert no leak after `uninstall`. (PR #79 rewrote this test from `install()` + `trust()` to a single `install()`; the new behavior matches the post-#79 unified install.)
- L219-235: AC-1 (added by PR #79) — `unified install: manifest + CA + installer all run when both capabilities present`. **Not directly relevant to this PR but confirms the install-side post-#79 contract.**
- L317-335: AC-5 (added by PR #79) — `unified install: idempotent re-call does not re-invoke installer`. **Not directly relevant to this PR but confirms the install-side post-#79 contract.**

### 2. CLI dispatch (`packages/cli/src/commands/runtime.ts`)

#### Help text at `runtime.ts:20-51`

```ts
function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime <command> [options]
       rogatio runtime host [path]

Native messaging runtime control for response-body and request-body rules. The
runtime no longer serves an HTTP mock server; mock delivery happens in the
consolidated native-messaging host (spec REQ-001..REQ-005).

Request-body trust commands:
  install   Install the native-messaging host manifest and (on capable
            platforms) provision the device-local CA (requires --extension-id)
  untrust   Remove the device-local CA trust (idempotent)
  uninstall Uninstall the native-messaging host manifest (idempotent)

Native host command:
  host [path]  Run the consolidated native-messaging runtime host. The browser
               launches this process via the native-messaging manifest; it reads
               pairing/authorization/mock envelopes from stdin and writes
               responses to stdout.

The lifecycle of the runtime (start/stop) is driven from the extension's
Start/Stop controls, not the CLI. Run 'rogatio runtime install --extension-id
<id>' once to register the host, then use the extension.

Options:
  --extension-id    Extension ID for native messaging manifest (required for install)
  --root <dir>      Root for confined file mocks (default: project directory)
  --help, -h        Show this help

The device-local CA / PAC routing capability is invoked from the unified
install command on capable platforms; it does not have a separate verb.`);
}
```

This is the post-#79 state. PR #79 already removed the `trust` line and rewrote the `install` line to mention CA provisioning. After this PR (post-#79 + this PR), the four trust commands collapse to three: `install | uninstall | host`. Specifically:
- L29-30: `install` line — kept (post-#79 wording now mentions CA provisioning on capable platforms). Not touched by this PR.
- L31: `untrust   Remove the device-local CA trust (idempotent)` line — **deleted by this PR**.
- L32: `uninstall Uninstall the native-messaging host manifest (idempotent)` — **rewritten by this PR** to: `uninstall Remove the native-messaging host manifest and the device-local CA trust (idempotent)`.
- L41-42: `"...Run 'rogatio runtime install --extension-id <id>' once to register the host, then use the extension."` — kept verbatim.
- L49-50: post-#79 prose about unified install handling CA — kept verbatim.

The duplicate copy at `packages/cli/src/index.ts:162-198` (`showRuntimeHelp` second copy) gets the same edits at L173-174. Both copies must stay byte-identical after the change.

#### `runtimeCommand` overload signature at `runtime.ts:289-304`

```ts
export function runtimeCommand(
  args: ["install" | "untrust" | "uninstall" | "host", ...string[]],
  options?: { stdinInput?: string },
): Promise<number>;
```

After PR #79: `["install" | "untrust" | "uninstall" | "host", ...string[]]` (this is the post-#79 state).
After PR #79 + this PR: `["install" | "uninstall" | "host", ...string[]]`.

#### `runtimeCommand` routing at `runtime.ts:315-330`

```ts
const first = args[0];
if (
  first === "install" ||
  first === "trust" ||
  first === "untrust" ||
  first === "uninstall"
)
  return trustRuntimeCommand(args);
if (first === "host") return runtimeHostCommand(args.slice(1));

console.error(
  `Error: 'rogatio runtime' no longer starts or stops the runtime. Use 'rogatio runtime install|untrust|uninstall' to manage the host manifest and request-body trust, or 'rogatio runtime host [path]' to run the native-messaging host. Start/stop is driven from the extension's controls.`,
);
showRuntimeHelp();
return 2;
```

The post-#-79 `if` chain at `runtime.ts:316-321` **still retains the `first === "trust"` clause** (per PR #79's IMPLEMENTATION-REVIEW.md, this was flagged as "functionally inert because the inner switch's `default:` branch handles `trust` identically" and the human gate accepted it as inert). After this PR: the analogous `first === "untrust"` clause should be dropped (the open question is whether to keep it for symmetry or drop it for cleanliness). The error message at `runtime.ts:325-326` currently says `install|untrust|uninstall`; after this PR it becomes `install|uninstall`.

#### `trustRuntimeCommand` at `runtime.ts:137-183`

Single function handles all four trust verbs via a `switch (subcommand)` at L159-182:

```ts
switch (subcommand) {
  case "install": return reportTrust("install", await controller.install(extensionId ?? ""), "runtime install complete: manifest + device-local CA trusted");
  case "untrust": return reportTrust("untrust", await controller.untrust(),                     "trust removed");
  case "uninstall": return reportTrust("uninstall", await controller.uninstall(),               "trust manifest uninstalled");
  default: console.error(`Error: unknown runtime subcommand: ${subcommand ?? ""}`); showRuntimeHelp(); return 2;
}
```

After this PR:
- `case "untrust":` is **deleted**. `untrust` falls through to `default:` and exits 2 with the unknown-subcommand error + help text. (Mirrors PR #79's deletion of `case "trust":`.)
- `case "uninstall":` is **rewritten** to call the new unified `controller.uninstall()` and to print the new success message (see Open questions for the three wording candidates).

The function name `trustRuntimeCommand` is module-private (no `export`); the export surface does not change.

#### `reportTrust` at `runtime.ts:116-135`

```ts
function reportTrust(
  subcommand: string,
  result: { ok: boolean; state: string; reasons?: readonly string[] },
  okMessage: string,
): number {
  if (result.ok) {
    console.log(okMessage);
    return 0;
  }
  if (result.state === "unsupported") {
    console.error(`trust unsupported: ${(result.reasons ?? ["unknown"]).join(", ")}`);
    return 0;
  }
  console.error(`trust ${subcommand} failed: ${(result.reasons ?? ["unknown"]).join(", ")}`);
  return 1;
}
```

The literal string `"trust unsupported:"` (L127) and the template literal `"trust ${subcommand} failed:"` (L132) embed the word `trust` in the user-facing error strings. F16 REQ-019 mandates stable error wording ("independent of third-party error wording or incidental iteration order"). The user's instruction is to remove `untrust` references but not to re-charter the F16 error vocabulary. The plan should:
- Keep L127 verbatim (`"trust unsupported: <reasons>"`) — the F16-mandated stable string for the unsupported branch.
- Consider whether to keep L132 (`"trust ${subcommand} failed: <reasons>"`) or to change the prefix. After both PR #79 and this PR, the `subcommand` parameter is only ever `"install"` or `"uninstall"`. The current wording produces `"trust install failed:"` and `"trust uninstall failed:"`. This is awkward (the word `trust` no longer matches the verb), but it is the post-collapse natural rendering of the legacy template. See Open questions.

The `okMessage` parameter is the per-verb success message; this PR changes the `uninstall` case's `okMessage` to a unified message (see Open questions for the three candidates).

#### `runRuntimeHostEntry` at `runtime.ts:337-340` (unchanged)

Calls `runtimeHostCommand(process.argv.slice(2))` and sets `process.exitCode`. Not affected by the collapse.

### 3. CLI top-level help (`packages/cli/src/index.ts`)

- **L116** (`showHelp` top-level): post-#79: `"runtime <install|untrust|uninstall|host>  Native messaging runtime control and request-body trust management"`. This PR drops `untrust`. Final: `"runtime <install|uninstall|host>"`.
- **L162-198** (`showRuntimeHelp` second copy) — same edits as `runtime.ts:20-51` (L173-174).
- **L188** (Options block): `--extension-id  Extension ID for native messaging manifest (required for install)` — unchanged.

### 4. CLI tests at HEAD `db5661b` (post-#79)

#### `packages/cli/test/runtime-command.test.ts` (68 lines)

- L14-20: `--help` exits 0 and contains "rogatio runtime". Passes after the change.
- L22-31: help text does not advertise `activate | deactivate | status | trust`. Passes (PR #79 already added the `/trust/` assertion at L30). The test will need to be extended by this PR to also assert `not.toMatch(/untrust/)`.
- L33-49: `activate`, `deactivate`, `status` rejected with exit 2. Passes (still true).
- L51-61 (added by PR #79): `trust` rejected with exit 2, error contains `"unknown runtime subcommand: trust"`, help text printed. Passes (still true post-#79; this PR mirrors it for `untrust`).
- L63-67: unknown subcommand returns 2. Passes.

**The new AC-6 needs a new test that mirrors PR #79's pattern for `trust`:** `runtimeCommand(["untrust"])` returns 2 and the error contains `"unknown runtime subcommand: untrust"` and the help text is printed. Recommended location: this same file (L51-61 sibling test for `untrust`). The help-text negative assertion at L22-31 must also be extended to include `not.toMatch(/untrust/)`.

#### `packages/cli/test/runtime-command-gating.test.ts` (48 lines, post-#79)

- L14-20: `install` without `--extension-id` → exit 2. Unchanged.
- L22-28: `install --extension-id invalid` → exit 2. Unchanged.
- L30-36: `install --extension-id *` → exit 2. Unchanged.
- L38-47: `install --extension-id <valid>` exits not 2. Unchanged.
- **Note:** The pre-#79 L49-54 "trust command remains explicit and capability-gated" test was already absent in the post-#79 file (PR #79 did not modify this file; the test was already removed by an earlier commit, possibly by `ecb0ff1`/`#73`). PR #79's commit message claims "Deleted the now-redundant trust test from packages/cli/test/runtime-command-gating.test.ts" — this likely refers to the entire 5-test file being re-organized post-#79, but the `git show --stat` for `db5661b` confirms this file is NOT in PR #79's diff. The "trust command remains explicit and capability-gated" test was already removed before PR #79. This PR does NOT need to touch this file.

#### `packages/cli/test/runtime-install-success.test.ts` (40 lines, post-#79)

Added by PR #79. Tests that `runtimeCommand(["install", "--extension-id", "<valid-id>"])` returns exit 0 and prints `"runtime install complete: manifest + device-local CA trusted"`. Not affected by this PR (it tests the `install` verb, which is outside this PR's scope). The new feature does NOT need to create a parallel `runtime-uninstall-success.test.ts` — the prior PR's analogous test for the unified install is sufficient; creating a new file would be asymmetric. The new AC tests belong in `runtime-command.test.ts` (CLI surface) and `trust.test.ts` (controller behavior).

#### `packages/cli/test/runtime.test.ts` (175 lines)

Verified via grep: no references to `untrust` or `uninstall` in this file. The tests cover `runtime <path>` (start) rejection, `runtime host` schema/compile/file-mock paths, and the native-host envelope round-trip. None affected.

### 5. Frozen F16 spec/plan/workflow

#### `docs/specs/f16-request-body-trust.md` (367 lines, post-#79) — frozen

PR #79 added 8 `> Superseded by: feat/collapse-runtime-install-and-trust` footers at L24, L35, L108, L224, L236, L258, L294, L328. The file is no longer 351 lines (research's pre-#79 figure); it is now 367 lines.

Lines that reference `untrust` and need `> Superseded by: feat/runtime-uninstall-collapse` footers appended (the existing PR #79 footers are NOT replaced; new footers are appended in addition to the existing ones, since the new collapse further supersedes these specific lines):

- **L18-19** (`F16 establishes the trust lifecycle: rogatio runtime install | status | trust | untrust | uninstall`) — existing PR #79 footer at L24 already covers `status`/`trust`; this PR appends a footer for `untrust`.
- **L30-31** (`A rogatio runtime install | status | trust | untrust | uninstall CLI surface`) — existing PR #79 footer at L35 covers `status`/`trust`; this PR appends a footer for `untrust`.
- **L31** (the line "`uninstall()`, `trust()`, `untrust()`, `status()`" — listing controller methods) — existing PR #79 footer at L35 covers it; this PR appends a footer for `untrust` specifically.
- **L58-59** (`CLI operator runs rogatio runtime install | status | trust | untrust | uninstall`) — `untrust` removed by this PR; needs a footer (no existing PR #79 footer here).
- **L104-106** (REQ-004: `install`, `status`, `trust`, `untrust`, `uninstall` plus `start | stop | status`) — existing PR #79 footer at L108 covers `status`/`trust`; this PR appends a footer for `untrust`.
- **L134-136** (REQ-011: "`uninstall()` shall remove the manifest file...") — the new `uninstall()` removes the manifest AND the CA AND invokes the remover. The semantic widens; a footer is needed (no existing PR #79 footer).
- **L141-143** (REQ-013: "`untrust()` shall remove the device-local CA trust from the OS trust store and remove the confined CA material when present...") — `untrust()` is removed; a footer is needed (no existing PR #79 footer).
- **L147-149** (REQ-015: "All mutating operations are capability-gated") — the new `uninstall()` is still idempotent and removes material unconditionally; no capability gate. This is consistent with F16 REQ-015's spirit (no partial state, no uncontrolled throw) but the spec text now no longer fully describes `uninstall`. Footer is needed (no existing PR #79 footer).
- **L226-234** (factory return type: `install(): Promise<TrustResult>; uninstall(); trust(); untrust(); status();` — five methods, but code at post-#-79 only has `install`, `uninstall`, `untrust`, `status` (`trust` is a closure-private helper)). The spec/code drift is **wider now** post-#79 (research's "factory return type lists `install()` with no args" is still true at L229; but `trust` is also wrong post-#79). Existing PR #79 footer at L236 covers it. This PR's footer is not strictly needed here because the `untrust()` reference at L232 is in a block that PR #79 already footnoted.
- **L248-256** (spec's `F16ErrorCode` named type; code names `ErrorCode`) — pre-existing drift; existing PR #79 footer at L258 covers it. No new footer needed.
- **L279-292** (CLI Surface block: lists `install | status | trust | untrust | uninstall`) — existing PR #79 footer at L294 covers `status`/`trust`; this PR appends a footer for `untrust`. The per-verb help text at L283-286 lists `runtime status`, `runtime trust`, `runtime untrust`, `runtime uninstall` — `untrust` removed by this PR.
- **L289-291** ("`install`/`trust` print success or `trust unsupported:` ... `uninstall`/`untrust` are idempotent and print success") — `untrust` removed by this PR; needs a footer (no existing PR #79 footer).
- **L316-318** (AC-006: "`trust()` provisions the CA and reports trusted... `untrust()` is a no-op success when not trusted...") — `untrust()` removed by this PR; needs a footer (no existing PR #79 footer).
- **L324-326** (AC-008: "`rogatio runtime install | status | trust | untrust | uninstall` run") — existing PR #79 footer at L328 covers it; this PR appends a footer for `untrust`.

Spec/code drift beyond the verb-list (pre-existing from #73 / main; out of scope for this PR but worth footnoting for accuracy, mirroring PR #79's pattern):

- **L213-222** (`RequestBodyTrustControllerOptions` lists `clock` instead of `caTrustInstaller`/`caTrustRemover`) — pre-existing drift; existing PR #79 footer at L224.
- **L226-234** (factory return type lists `install()` with no args; code has `install(extensionId)`; ALSO lists `trust()` as public but code now keeps `trust` as private closure helper) — pre-existing + new drift; existing PR #79 footer at L236.
- **L249-256** (spec names `F16ErrorCode`; code names `ErrorCode`) — pre-existing drift; existing PR #79 footer at L258.

The PR #79 footer list added 8 footers to this file. This PR does NOT re-add them; it appends new `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` footers to the specific lines the new collapse affects.

#### `docs/plans/f16-request-body-trust.md` (83 lines, post-#79) — frozen

PR #79 added 2 footers at L52 and L83.

- **L29-40** (T4: controller lifecycle) — `untrust` reference at L36 ("untrust: remove confined CA + call injectable caTrustRemover; no-op when absent (REQ-013, AC-006)") needs a footer. Existing PR #79 footer at L52 covers `trust` references in T6; this PR appends a footer for `untrust` specifically.
- **L45-51** (T6: CLI surface) — existing PR #79 footer at L52 covers `status`/`trust`/`start|stop`; this PR appends a footer for the `untrust` mention at L46.
- **L79-81** (Rollback: "reversible by removing the module export and CLI routing") — the rollback path now also requires reverting the `uninstall` widening. PR #79 noted this rollback note is "now incomplete" after the install+trust collapse; this PR further expands the surface. Existing PR #79 footer at L83; this PR appends a footer.

#### `docs/workflows/f16-workflow.md` — frozen

Verified via grep: this file contains `untrust` references at L71 ("README.md: `rogatio runtime` table extended with `install|trust|untrust|uninstall`...") and L86 ("(b) separate `install/status/trust/untrust/uninstall` surface — selected") but does NOT enumerate the verb surface as a per-line statement that needs updating. PR #79's RESEARCH.md concluded no footer was needed for this file (the analogous check for `trust`); same conclusion for this PR: no `> Superseded by:` footer needed. The references at L71 and L86 are workflow log entries recording past decisions, not current verb-surface specs.

#### `docs/specs/cli-activate-deactivate-removal.md` (143 lines, post-#79) — append-only

PR #79 added 4 footers at L46, L68, L90, L134.

- **L33** — "the trust lifecycle (`install|trust|untrust|uninstall`)" — `untrust` is about to be removed. **New footer needed** (no existing PR #79 footer here).
- **L42-44** — "We are not removing `rogatio runtime install|trust|untrust|uninstall`." — `untrust` is being removed (this PR). Existing PR #79 footer at L46 covers the `trust` portion; a new footer for this PR covers the `untrust` portion.
- **L66** — "`rogatio runtime install|trust|untrust|uninstall` → unchanged." — existing PR #79 footer at L68 covers `trust`; new footer for `untrust`.
- **L131** — "`rogatio runtime install|trust|untrust|uninstall|host` continue to work" — existing PR #79 footer at L134 covers it; new footer for `untrust`.

#### `docs/specs/f17-request-body-rules.md` (870 lines, post-#79) — frozen

PR #79 added 1 footer at L408 (covering L405-406's "`runtime trust` remains explicit and capability-gated").

Verified via grep: no `untrust` references in this file. This PR does NOT add a footer here — the only verb-list mention is the `trust` line, which PR #79 already footnoted.

#### `docs/specs/f19-docs-site.md` (129 lines) — frozen **(MISSED BY PRIOR RESEARCH)**

**New drift discovered during this re-verification.** L68 contains the verb-list: `Reference: CLI (\`edit\`, \`verify\`, \`runtime install|status|trust|untrust|uninstall\`), extension, supported platforms & capabilities, security & privacy model, architecture.` — `untrust` is about to be removed. PR #79 did NOT add a footer here. **This PR's footer list must include L68** (with reason: "verb-list enumeration; `untrust` removed by this PR").

#### `docs/specs/consolidated-native-runtime.md` (261 lines) — frozen **(MISSED BY PRIOR RESEARCH)**

**New drift discovered during this re-verification.** L119 contains: `Device-local CA install/uninstall/trust/untrust/status continues to work; no unsupported state from adapter absence.` — `untrust` is about to be removed. PR #79 did NOT add a footer here. **This PR's footer list must include L119** (with reason: "verb-list enumeration; `untrust` removed by this PR").

#### `docs/plans/consolidated-native-runtime.md` (123 lines) — frozen **(MISSED BY PRIOR RESEARCH)**

**New drift discovered during this re-verification.** L61 contains: `\`trust.ts\`: keep CA install/uninstall/trust/untrust/status; manifest stays \`v1\`.` — `untrust` is about to be removed. PR #79 did NOT add a footer here. **This PR's footer list must include L61** (with reason: "verb-list enumeration; `untrust` removed by this PR").

#### `docs/plans/cli-activate-deactivate-removal.md` — frozen **(MISSED BY PRIOR RESEARCH)**

**New drift discovered during this re-verification.** L96 contains: `keep \`install|trust|untrust|uninstall\` and \`host\`` — `untrust` is about to be removed. PR #79 did NOT add a footer here. **This PR's footer list must include L96** (with reason: "verb-list enumeration; `untrust` removed by this PR").

#### `docs/plans/f17-request-body-rules.md` — frozen **(MISSED BY PRIOR RESEARCH)**

**New drift discovered during this re-verification.**
- **L201** — `Preserve explicit \`trust\`, \`untrust\`, \`install\`, \`uninstall\`; do not auto-run from \`runtime start\`.` — `untrust` is about to be removed. PR #79 did NOT add a footer here. **This PR's footer list must include L201**.
- **L460** — `\`untrust\` and \`uninstall\` remain explicit user actions.` — `untrust` is about to be removed. **This PR's footer list must include L460**.

### 6. Live documentation updates

These are source-of-truth files (not frozen decision records), per AGENTS.md.

- **`docs/architecture.md:335-365`** (Request-Body Trust Lifecycle section):
  - **L341**: `@rogatio/runtime gains a trust module with a createRequestBodyTrustController controller and pure helper functions. @rogatio/cli extends rogatio runtime with install | untrust | uninstall.` — `untrust` is dropped by this PR. Final: `install | uninstall`.
  - **L343-346**: 4-bullet list (PR #79 deleted the `trust` bullet but KEPT the `status` bullet — the research's claim that PR #79 deleted the `status` bullet was wrong). The `untrust` bullet at L344 is deleted (this PR); the `uninstall` bullet at L345 is rewritten to describe the unified uninstall (removes manifest + CA + invokes remover). The `install` bullet (L343) and the `status` bullet (L346) are not this PR's scope.
  - **L352**: `Trust controller: install/uninstall/untrust/status` — drop `untrust`. Final: `install/uninstall/status`.
- **`rogatio-overview.md:35`**: post-#79 says `Request-body rules use the trust lifecycle rogatio runtime install (a single command that provisions both the native-messaging host and, on capable platforms, the device-local CA), rogatio runtime untrust to remove the CA trust, and rogatio runtime uninstall to remove the host registration; the native-messaging host itself runs as rogatio runtime host <path>.` — drop `untrust` (this PR). Final: `rogatio runtime install` and `rogatio runtime uninstall`.
- **`samples/basic/README.md:101-118`** (step 6; PR #79 condensed the section from L101-122 to L101-118):
  - **L107**: `rogatio runtime install --extension-id <your extension ID>` — kept.
  - **L115-116**: `If install reports unsupported on your platform, request-body interception cannot activate there — you can still verify, edit, import, export, and dry-run the rule.` — kept verbatim (PR #79 already removed `trust`).
  - **L117-118**: `Stop the runtime from the extension; remove trust/host with rogatio runtime untrust and rogatio runtime uninstall.` — This PR changes to: `Stop the runtime from the extension; remove the host and CA trust with rogatio runtime uninstall.` (drops the `untrust` mention).
- **`README.md:128`** (root README's command table row): `rogatio runtime <install|trust|untrust|uninstall>` — PR #79 did NOT update this line (it still says `install|trust|untrust|uninstall`); this PR drops both `trust` and `untrust`. Final: `rogatio runtime <install|uninstall>`.
- **`README.md:179`**: `rogatio runtime install --extension-id <your extension ID>` — already updated by PR #79; this PR does not touch this line.
- **`packages/cli/README.md:42`**: post-#79 says `rogatio runtime <install|untrust|uninstall>`. PR #79 dropped `trust`; this PR drops `untrust`. Final: `rogatio runtime <install|uninstall>`.
- **`packages/docs-site/src/content/docs/guides/runtime.md:16`**: post-#79 says `rogatio runtime install | untrust | uninstall`. PR #79 dropped `trust`; this PR drops `untrust`. Final: `rogatio runtime install | uninstall`.
- **`packages/docs-site/src/content/docs/reference/cli.md:34`**: post-#79 says `rogatio runtime install | untrust | uninstall`. Same edit.
- **`packages/docs-site/src/content/docs/reference/platforms.md:25`**: post-#79 says `rogatio runtime install | untrust | uninstall`. Same edit.
- **`packages/docs-site/src/content/docs/rules/request-body.md:26`**: post-#79 says `Requires the device-local CA trust installed via rogatio runtime install (the same install command provisions the CA on capable platforms...)`. PR #79 dropped `trust`; this PR does not touch this line.
- **`packages/extension/src/diagnostics.ts:57`**: post-#79 says `"...Run rogatio runtime install --extension-id <extension ID> to register the host and (on capable platforms) trust the device-local CA..."`. PR #79 changed this to reference the unified `install`. This PR does not touch this line.
- **`packages/extension/src/extension-page-entry.ts:820-828`**: post-#79 the `installCommand = "rogatio runtime install --extension-id ${id}"` assignment (L821). PR #79 replaced the prior `installCommand = "rogatio runtime trust"`. This PR does not touch this code.

**Net effect of this PR on live documentation:** nine live files drop `untrust` references (docs/architecture.md L341/L344/L345/L352, rogatio-overview.md L35, samples/basic/README.md L117-118, README.md L128, packages/cli/README.md L42, three docs-site files at lines 16/34/25). After both #79 and this PR, the surface is `install | uninstall`.

**Correction to prior research's net-effect count:** the research said "three files drop `untrust` references (docs/architecture.md L341/L346/L347, ...)". Post-#79, the architecture.md references are at L341, L344, L345, L352 (not L346/L347 as the research said). The total count is **nine** files (not three), plus README.md L128 which the research correctly identified but understated as already partially updated by PR #79.

### 7. `scripts/validate.ts` — the canonical pre-commit/CI gate

Per PR #79's PLAN.md L347-361, the canonical sequence is `format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright`. The collapse:
- **format:check / lint / typecheck / build:** No new files; only the controller's `uninstall` body changes and the CLI dispatch's `case "untrust":` is deleted. Biome and tsc pass.
- **checkArtifacts:** No artifact list change (`build-manifest.json` is unchanged). Pass.
- **checkEmittedModules:** Smoke/sanity/schema/compiler/core/editor modules all unchanged at the public boundary. Pass.
- **checkBoundaries:** No package manifest change. Pass.
- **Negative typecheck fixtures:** No boundary change. Pass.
- **playwright:** Browser journeys unchanged. Pass (subject to chromium availability; see Open questions on the `editor-asset-paths.test.ts` pre-existing failure).

This PR does not require any change to `scripts/validate.ts`.

### 8. `packages/runtime/src/index.ts`

L23: `export * from "./trust.js";` — re-exports the entire trust module. Removing `untrust` from the controller factory return (`trust.ts:381`) does NOT change the export shape: `untrust` is not a separate exported function; it's a method on the factory return. The change is internal to the factory return type. The `trust.test.ts:143-158` test that calls `controller.uninstall()` continues to work because `uninstall` is still on the factory return.

---

## The unification design

### The new `uninstall` method on the controller

A single method that:

1. **Removes the CA trust via `caTrustRemover`** (if `caKeyFile` exists AND `caTrustRemover` is defined). Mirrors `untrust` at `trust.ts:344-346`.
2. **Removes the three CA files** via `rm(..., { force: true })`. Mirrors `untrust` at `trust.ts:347-349`.
3. **Removes the manifest** via `rm(manifestPath(), { force: true })`. Mirrors the existing `uninstall` at `trust.ts:297`.
4. **Resets `installerCalled = false`** (so a subsequent install can re-invoke the installer). Mirrors `untrust` at `trust.ts:350`.
5. Returns `{ ok: true, state: "uninstalled" }` on success; returns `unsupported` with `codeOf(error, "trust.internal")` on any thrown error.

Order is **remover → CA files → manifest → installerCalled reset**. Rationale: removing the manifest last means the CA removal (and the remover call) is the "outermost" side effect and completes first. If the manifest `rm` throws (extremely unlikely with `force: true`), the CA files are already gone — that is the desired post-uninstall state. The reverse order would leave the manifest on disk while the CA is gone, which violates the new unified semantics ("uninstall removes everything").

### Old `uninstall` body

The current body (`trust.ts:295-306`) does one thing: `rm(manifestPath())`. The new body inlines this as step 3 above. No private helper is needed because the new body is small and the existing `untrust` body (also small) is already inlined in the same function block.

### Old `untrust` method

Removed from the controller factory return at `trust.ts:381`. No private helper kept. The user explicitly stated "the new unified `uninstall` does the work" — this is a divergence from PR #79's "keep `trust` as private helper" pattern (see Open questions).

### CLI dispatch

- `uninstall` and `untrust` both go through the same handler (`trustRuntimeCommand`).
- The `case "untrust":` branch at `runtime.ts:166-171` is **deleted**. `untrust` falls through to `default:` (L178-182) and exits 2 with `"Error: unknown runtime subcommand: untrust"` + help text.
- The `runtimeCommand` overload union at `runtime.ts:289-304` drops `"untrust"`. Final: `["install" | "uninstall" | "host", ...string[]]`.
- The routing clause at `runtime.ts:316-321` drops `first === "untrust"`. (Open: keep or drop for parallelism with PR #79's retained `first === "trust"` clause.)
- The error message at `runtime.ts:325-326` drops `untrust` from the pipe list. Final: `'Use 'rogatio runtime install|uninstall' to manage the host manifest and request-body trust, or 'rogatio runtime host [path]' to run the native-messaging host.'`
- Both copies of `showRuntimeHelp` (`runtime.ts:20-51` and `index.ts:162-198`) drop the `untrust` line at L31 / L173 and rewrite the `uninstall` line at L32 / L174 to the unified wording.
- The top-level help line at `index.ts:116` drops `untrust` from the pipe list. Final: `runtime <install|uninstall|host>`.

### Success message wording

The current `case "uninstall":` at `runtime.ts:172-177` prints `"trust manifest uninstalled"` on success. After the unification, the message must describe the wider scope. Three candidates:

1. **`"runtime uninstall complete"`** — minimal; mirrors PR #79's minimal candidate for `install`. Loses the explicit "manifest + CA" content.
2. **`"runtime uninstall complete: manifest + device-local CA removed"`** — explicit; mirrors PR #79's chosen wording for the unified install (`"runtime install complete: manifest + device-local CA trusted"`). Recommended for parallelism.
3. **`"trust uninstalled: manifest + device-local CA removed"`** — retains the legacy `trust` prefix in the user message (matching the F16-mandated `trust unsupported:` prefix at L127). Asymmetric with PR #79's chosen wording.

The plan phase picks one; recommendation: **#2** for symmetry with PR #79.

### Frozen-doc footers (append-only)

Append `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` to:

| File | Line | Reason |
| --- | --- | --- |
| `docs/specs/f16-request-body-trust.md` | L18-19 | `install | status | trust | untrust | uninstall` enumeration; `untrust` about to be removed |
| `docs/specs/f16-request-body-trust.md` | L30-31 | CLI surface enumeration; `untrust` removed |
| `docs/specs/f16-request-body-trust.md` | L58-59 | `CLI operator` enumeration |
| `docs/specs/f16-request-body-trust.md` | L104-106 | REQ-004 enumeration |
| `docs/specs/f16-request-body-trust.md` | L134-136 | REQ-011: `uninstall()` semantic widens |
| `docs/specs/f16-request-body-trust.md` | L141-143 | REQ-013: `untrust()` is removed |
| `docs/specs/f16-request-body-trust.md` | L147-149 | REQ-015: `uninstall()` no longer capability-gated |
| `docs/specs/f16-request-body-trust.md` | L289-291 | `uninstall/untrust are idempotent` clause |
| `docs/specs/f16-request-body-trust.md` | L316-318 | AC-006: `untrust()` reference |
| `docs/plans/f16-request-body-trust.md` | L29-40 | T4 controller lifecycle; `untrust` removed |
| `docs/plans/f16-request-body-trust.md` | L45-51 | T6 CLI surface |
| `docs/plans/f16-request-body-trust.md` | L79-81 | Rollback note; rollback now also covers uninstall widening |
| `docs/specs/cli-activate-deactivate-removal.md` | L33 | `install|trust|untrust|uninstall` enumeration |
| `docs/specs/cli-activate-deactivate-removal.md` | L42 | "We are not removing `rogatio runtime install|trust|untrust|uninstall`" |
| `docs/specs/cli-activate-deactivate-removal.md` | L66 | "`rogatio runtime install|trust|untrust|uninstall` → unchanged" |
| `docs/specs/cli-activate-deactivate-removal.md` | L131 | "`rogatio runtime install|trust|untrust|uninstall|host` continue to work" |
| `docs/specs/f19-docs-site.md` | L68 | (NEW — missed by prior research) `runtime install|status|trust|untrust|uninstall` enumeration |
| `docs/specs/consolidated-native-runtime.md` | L119 | (NEW — missed by prior research) `install/uninstall/trust/untrust/status` enumeration |
| `docs/plans/consolidated-native-runtime.md` | L61 | (NEW — missed by prior research) `install/uninstall/trust/untrust/status` enumeration |
| `docs/plans/cli-activate-deactivate-removal.md` | L96 | (NEW — missed by prior research) `keep install|trust|untrust|uninstall and host` |
| `docs/plans/f17-request-body-rules.md` | L201 | (NEW — missed by prior research) `Preserve explicit trust, untrust, install, uninstall` |
| `docs/plans/f17-request-body-rules.md` | L460 | (NEW — missed by prior research) `untrust and uninstall remain explicit user actions` |

`docs/workflows/f16-workflow.md` is **not** footnoted (no per-line verb enumeration; same conclusion as PR #79).
`docs/specs/f17-request-body-rules.md` (spec, not plan) has no `untrust` references outside of the L405-406 line already footnoted by PR #79 (the `trust` line, not `untrust`); this PR does not add new footers to the F17 spec.

### Live documentation updates

Same pattern as PR #79, restricted to lines that reference `untrust` or the `uninstall`-as-manifest-only semantic. See the section "Live documentation updates" above for the complete list.

---

## Acceptance criteria

Extending the prior `runtime-install-collapse` AC list with the analog for the uninstall collapse:

**AC-1 (transactional unified uninstall):** `rogatio runtime uninstall` removes the native-messaging host manifest AND the CA files (`caKeyFile`, `caPubFile`, `caCertFile`) AND invokes the capability-provided `caTrustRemover` (if present) in one call. Verified by extending `packages/runtime/test/trust.test.ts:143-158` to assert that after a successful `install` + `uninstall` sequence, the manifest file is absent, the three CA files are absent, and the `caTrustRemover` was called exactly once. (Note: post-#79, `install` already provisions the CA via the unified transaction; the test sequence is `install` then `uninstall`, not `install` + `trust` + `uninstall`.)

**AC-2 (idempotency):** A second `rogatio runtime uninstall` call is a no-op (manifest + CA already removed, `caTrustRemover` not re-invoked). Verified by extending the AC-1 test to call `uninstall` a second time and assert no errors and `caTrustRemover` was called exactly once across both calls.

**AC-3 (capability gating unchanged):** The new `uninstall` does NOT add a capability gate (uninstall is unconditional on the controller). The existing capability gating on `install` (post-#79 two-stage: `manifest` then `caTrust`) is unchanged. Verified by calling `uninstall` against the default capability provider (which returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }`) and asserting success.

**AC-4 (status non-leakage):** `controller.status()` after a successful unified `uninstall` returns `{ installed: false, trusted: false, platform, capabilityReasons }` with no manifest path, host path, or CA material in the serialized output. Verified by extending `packages/runtime/test/trust.test.ts:203-217` to call `status()` after `uninstall` (the post-#-79 test at L203-217 already uses the unified `install()`; the new extension adds an `uninstall()` call after the `install()` to verify post-uninstall status non-leakage).

**AC-5 (no `untrust` references in live files):** grep for `untrust` and `runtime untrust` across the **11** live documentation files (`docs/architecture.md`, `rogatio-overview.md`, `README.md`, `samples/basic/README.md`, `packages/cli/README.md`, four docs-site files, `packages/cli/src/commands/runtime.ts`, `packages/cli/src/index.ts`) returns **zero matches**. Frozen spec/plan files are excluded from the zero-match criterion. **Additionally**, grep for `untrust` across all `docs/specs/*.md` and `docs/plans/*.md` returns matches only on lines that have a `> Superseded by:` footer added by either PR #79 or this PR; no unmatched references remain.

**AC-6 (CLI surface):** `rogatio runtime --help` lists `install | uninstall | host` (no `trust`, no `untrust`). `rogatio runtime untrust` exits 2 with `"Error: unknown runtime subcommand: untrust"` and prints the help text. The `runtimeCommand` overload union at `packages/cli/src/commands/runtime.ts:289-304` no longer contains `"untrust"`. The `trustRuntimeCommand` switch at `runtime.ts:159-182` no longer has a `case "untrust":` branch. Both copies of `showRuntimeHelp` drop the `untrust` line. The top-level help line at `packages/cli/src/index.ts:116` drops `untrust` from the pipe list. The long-form error at `runtime.ts:325-326` drops `untrust` from the pipe list. Verified by the new "untrust → exit 2" test in `packages/cli/test/runtime-command.test.ts` (mirroring PR #79's `trust → exit 2` test at L51-61), the extended help-text test (extending L22-31 to also assert `not.toMatch(/untrust/)`), and a grep across the live CLI files.

**AC-7 (caTrustRemover throw rollback):** If `caTrustRemover` throws, the manifest + CA files are still removed (the file-system side effects are atomic; the `caTrustRemover` side effect is best-effort and the error is surfaced). Verified by a new test in `packages/runtime/test/trust.test.ts`: inject a `caTrustRemover: vi.fn()` that throws; call `uninstall`; assert the result returns `unsupported`, the manifest file does not exist, the three CA files do not exist, and the throw is the captured reason.

---

## Constraints (F16 REQs)

1. **Frozen F16 spec/plan bodies are not edited.** Only `> Superseded by: feat/collapse-runtime-uninstall-and-untrust` footers are appended to the specific lines enumerated in the Frozen-doc footers section. Bodies remain byte-identical.
2. **No new dependencies.** F16 REQ-002. The change is internal to `trust.ts` and the CLI dispatch.
3. **No F15/F17 rule behavior changes.** F16 REQ-001.
4. **No traffic or body bytes.** F16 REQ-018/020.
5. **No persistence outside `installRoot`.** F16 REQ-020.
6. **Capability gating preserved.** F16 REQ-015. The new `uninstall` does not add a gate (uninstall is unconditional and idempotent). The post-#79 two-stage gate on `install` (`manifest` then `caTrust`) is unchanged.
7. **Status non-leakage preserved.** F16 REQ-019. Verified by AC-4.
8. **`TRUST_LIMITS` not changed.** F16 REQ-021.
9. **`generateNativeMessagingManifest` not changed.** F16 REQ-005..008.
10. **No new packages, no new exports from `@rogatio/runtime`.** The factory return type narrows (drops `untrust`), but this is a removal, not an addition. The `export * from "./trust.js"` at `packages/runtime/src/index.ts:23` is unchanged.
11. **No extension UI string changes.** The `rogatio runtime trust` references in `packages/extension/src/diagnostics.ts:57` and `packages/extension/src/extension-page-entry.ts:820-828` (post-#79 line range) are PR #79's scope, not this PR's. PR #79 already rewrote both to reference the unified `install --extension-id`. This PR does not touch them.
12. **No CLI flag additions.** The unified `uninstall` replaces `untrust` with no flag.
13. **No migration guide document.** Inline docs updates are sufficient.

---

## Open questions

1. **PR #79 rebase — RESOLVED.** The worktree has been rebased onto post-#79 `origin/main` @ `db5661b`. The controller's `install` method is already widened, `trust` is already dropped from the factory return (kept as a closure-private helper via `runCaTrust()`), and the `runtimeCommand` overload is already `[install | untrust | uninstall | host]`. The plan does not need to reconcile against a pre-#79 base. OQ-1 from the original research is moot.
2. **Success message wording.** Three candidates listed above ("runtime uninstall complete", "runtime uninstall complete: manifest + device-local CA removed", "trust uninstalled: manifest + device-local CA removed"). Recommendation: candidate #2 for symmetry with PR #79's chosen wording for the unified install. The plan phase records the final choice.
3. **Should the new `uninstall` keep the old `uninstall` body as a private helper, or inline?** The user explicitly stated "the new unified `uninstall` does the work" — recommendation: inline. The new body is small (one `try` block with five statements), and the old `untrust` body is also inlined in the same function block (no private helper for it). The inlined form is parallel to the post-PR-#79 `install` method (which keeps `trust` as a private helper called from `install`; the asymmetry is intentional per the user's direction).
4. **The `caTrustRemover` rollback path: if it throws, do we still consider the file-system side effects successful?** F16 REQ-015 says "no partial trust state." Both interpretations satisfy this: (a) "treat the throw as `unsupported` but proceed to remove files anyway" (the post-collapse "best effort" reading); (b) "treat the throw as `unsupported` and stop; files remain on disk" (the strict reading). Recommendation: **(a)** — the new `uninstall` removes the files even if `caTrustRemover` throws, because the device-local files are the larger blast radius (CA private key on disk) and the OS trust store is best-effort. Mirrors the existing `untrust` at `trust.ts:378-395` which checks `await existsFile(caKeyFile) && caTrustRemover` — i.e. the remover is best-effort by design. The plan phase confirms.
5. **The `editor-asset-paths.test.ts` failure mentioned by the user.** This test reads from `dist/editor/` artifacts and requires the build to run first; `pnpm test` is `pnpm build && vitest run`. The PR #79 FINAL-REVIEW noted "vitest 79 files / 582 tests" without mentioning this test as a failure. **No direct evidence in the prior artifacts that this test was failing pre-#79.** The plan should verify this test passes at HEAD `db5661b` before declaring the feature complete. If it is genuinely failing pre-#79, the plan must record that the failure is unrelated to this PR and the new feature's verification treats it the same way (skip / ignore / pass-with-skip).
6. **The `first === "untrust"` routing clause** at `runtime.ts:316-321` (the `if` chain). PR #79's FINAL-REVIEW flagged the analogous `first === "trust"` clause as "functionally inert because the inner switch's `default:` branch handles `trust` identically" and the human gate accepted it as inert. Recommendation: **drop `first === "untrust"` from the routing** for cleanliness, matching the post-PR-#79 final state of the `trust` clause (which was actually KEPT in PR #79's final review, not dropped — so this is asymmetric). The plan should commit to one direction (keep as functionally inert, or drop) so the implementation review can verify.
7. **The `reportTrust` `trust ${subcommand} failed:` literal at `runtime.ts:132`.** After both #79 and this PR, the `subcommand` parameter is only ever `"install"` or `"uninstall"`. The current wording produces `"trust install failed:"` and `"trust uninstall failed:"`. This is awkward (the `trust` prefix no longer matches the verb). Options: (a) leave as-is (minimal change; the literal is a stable post-write-failure message per F16); (b) change to `"runtime ${subcommand} failed:"`. Recommendation: **(a) leave as-is** for this PR; PR #79 did not address it either, and the F16-mandated `trust unsupported:` prefix at L127 should be re-evaluated across both PRs in a follow-up if the user wants symmetry. This PR mirrors PR #79's discipline.
8. **Should the `runtimeCommand` second copy of `showRuntimeHelp` at `packages/cli/src/index.ts:162-198` be deleted, or kept in sync?** PR #79's PLAN.md L89 explicitly required "both copies must stay byte-identical." Recommendation: kept in sync (verbatim duplication is pre-existing and PR #79 honors it). The plan phase records the edit to L173 and L174.
9. **The `runtime.test.ts` and the AC-6 unknown-subcommand test.** The new `runtimeCommand(["untrust"])` test should be added to `packages/cli/test/runtime-command.test.ts` (the file that already has the `trust → exit 2` test at L51-61 added by PR #79, and the activate/deactivate/status exit-2 tests at L33-49). Mirrors PR #79's pattern. Additionally, the help-text negative assertion at L22-31 must be extended to also assert `not.toMatch(/untrust/)`.
10. **The `runtime-command-gating.test.ts` "trust command remains explicit and capability-gated" test — RESOLVED.** The test was NOT present in the post-#79 file (verified at HEAD `db5661b`); PR #79's commit message claims it was deleted but `git show --stat db5661b` shows the file is not in the diff. The test was already absent pre-#79 (likely removed by `ecb0ff1`/`#73`). OQ-10 from the original research is moot.
11. **The `install` overload signature change at `trust.ts:249` (PR #79 widens `install` to take no args after CA is unified, or keeps `install(extensionId)`?).** PR #79's PLAN.md L85 records `install(extensionId)` is kept (the `--extension-id` validation stays at the CLI gate and the controller gate). This PR does not affect `install`. Documented here for completeness; out of scope.
12. **Frozen-doc drift beyond what was enumerated by the original research — RESOLVED (six new locations).** The original research's frozen-doc footer list missed six locations that contain `untrust` references in frozen specs/plans: `docs/specs/f19-docs-site.md:68`, `docs/specs/consolidated-native-runtime.md:119`, `docs/plans/consolidated-native-runtime.md:61`, `docs/plans/cli-activate-deactivate-removal.md:96`, `docs/plans/f17-request-body-rules.md:201`, and `docs/plans/f17-request-body-rules.md:460`. All six are enumerated in the Frozen-doc footers table above and must be footnoted by the implementation. The implementation review must grep `untrust` across all `docs/specs/*.md` and `docs/plans/*.md` to confirm no further locations are missed.
13. **Spec/code drift beyond the verb list — RESOLVED.** The original research identified three pre-existing drifts at `docs/specs/f16-request-body-trust.md:207-216`, `:218-226`, `:239-246` (pre-#-79 lines). Post-#-79 the drifts persist at L213-222, L226-234, L249-256. PR #79 already added footers at L224, L236, L258. **Additionally, the factory return type drift at L226-234 is now wider post-#79**: the spec lists `trust(): Promise<TrustResult>` as a public method but code keeps `trust` as a closure-private helper. This is not this PR's responsibility to fix, but the drift should be flagged for a future PR that consolidates the spec/code.
14. **The `architecture.md` bullet count — RESOLVED.** The original research claimed PR #79 deleted the `status` bullet at L344 and the `trust` bullet at L345 (leaving 3 bullets). Post-#-79 verification shows PR #79 deleted only the `trust` bullet; the `status` bullet at L346 is still present. The bullet count is 4 (not 3) post-#79, and the bullet range is L343-346 (not L343-347 as the original research said). The implementation review must verify the architecture.md `untrust` bullet at L344 is deleted and the `uninstall` bullet at L345 is rewritten to the unified wording.

---

## Cross-references and pointer summary

- Trust controller: `packages/runtime/src/trust.ts` (factory at `:222-417`; `install` at `:249-319`; private `runCaTrust` helper at `:321-350`; private `trust` helper at `:365-376`; `uninstall` at `:352-363`; `untrust` at `:378-395` to be deleted; `status` at `:397-415`; `writeFileAtomic` at `:192-198`; `existsFile` at `:200-206`; `installerCalled` flag at `:247`; `caTrustInstaller` at `:165`; `caTrustRemover` at `:166`).
- x509 stub: `packages/runtime/src/x509.ts` (`createCertificate` at `:7-17`; `generateCaKeyPair` at `:53-65`) — unchanged.
- CLI dispatch: `packages/cli/src/commands/runtime.ts` (help at `:20-51`; `makeTrustController` at `:104-114`; `reportTrust` at `:116-135`; `trustRuntimeCommand` at `:137-183`; `runtimeHostCommand` at `:185-287`; `runtimeCommand` overload at `:289-304`; routing at `:315-330`; `runRuntimeHostEntry` at `:337-340`).
- CLI tests: `packages/cli/test/runtime-command.test.ts:13-68` (post-#79), `packages/cli/test/runtime-command-gating.test.ts:13-48`, `packages/cli/test/runtime.test.ts:1-175`, `packages/cli/test/runtime-install-success.test.ts:1-40` (post-#79).
- Runtime tests: `packages/runtime/test/trust.test.ts:27-366` (post-#79; especially `:27-29` capable() factory, `:108-336` lifecycle group, `:143-158` uninstall test, `:183-201` untrust test to be deleted, `:203-217` no-leak status test to be extended, `:219-335` PR #79's five AC-1..AC-5 install tests).
- Frozen spec: `docs/specs/f16-request-body-trust.md` (REQs at `:90-179`; CLI surface at `:279-292`; ACs at `:296-334`). **This PR's footer lines:** L18-19, L30-31, L58-59, L104-106, L134-136, L141-143, L147-149, L289-291, L316-318, L324-326.
- Frozen plan: `docs/plans/f16-request-body-trust.md` (T1..T8 at `:9-63`; rollback at `:79-81`). **This PR's footer lines:** L29-40, L45-51, L79-81.
- Frozen workflow: `docs/workflows/f16-workflow.md` (no verb enumeration; no footer needed).
- Frozen F17 spec: `docs/specs/f17-request-body-rules.md` (no `untrust` references in spec body; PR #79's L408 footer covers the analogous `trust` line).
- Frozen F19 spec: `docs/specs/f19-docs-site.md:68` (NEW; this PR's footer line).
- Frozen consolidated-native-runtime spec: `docs/specs/consolidated-native-runtime.md:119` (NEW; this PR's footer line).
- Frozen consolidated-native-runtime plan: `docs/plans/consolidated-native-runtime.md:61` (NEW; this PR's footer line).
- Frozen cli-activate-deactivate-removal plan: `docs/plans/cli-activate-deactivate-removal.md:96` (NEW; this PR's footer line).
- Frozen F17 plan: `docs/plans/f17-request-body-rules.md:201`, `:460` (NEW; this PR's footer lines).
- Append-only cli-activate-deactivate-removal spec: `docs/specs/cli-activate-deactivate-removal.md`. **This PR's footer lines:** L33, L42-44, L66, L131.
- Architecture: `docs/architecture.md:335-365` (Request-Body Trust Lifecycle section; L341, L343-346, L352 affected).
- Overview: `rogatio-overview.md:35` (the line to update).
- Sample: `samples/basic/README.md:101-118` (step 6; L117-118 affected).
- Root README: `README.md:128` (command table row; L179 already updated by PR #79).
- CLI README: `packages/cli/README.md:42` (command table row).
- Docs site: `packages/docs-site/src/content/docs/guides/runtime.md:16`, `.../reference/cli.md:34`, `.../reference/platforms.md:25` (drop `untrust` from pipe list).
- Extension UI: `packages/extension/src/diagnostics.ts:57` and `packages/extension/src/extension-page-entry.ts:820-828` — PR #79's scope, not this PR's.
- Validation: `scripts/validate.ts:421-442` (canonical sequence: format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright).
- Recent commit: `db5661b` (`feat(cli)!: collapse runtime install and trust into a single install command (#69) (#79)`) — the post-#79 base. PR #79's prior location was `~/.local/share/opencode/worktree/rogatio/feat/runtime-install-collapse` at `e2db805`; that worktree is now historical.

---

## Self-review notes

- All file paths verified via `read` or `grep` against HEAD `db5661b` (post-#79). Nothing cited was inferred. The pre-#79 line numbers from the original research have been re-verified; the substantive changes are recorded in the Drift summary appended below.
- The post-#79 reconciliation is the single most important finding: the controller now has four methods (`install`, `uninstall`, `untrust`, `status`) with `trust` as a closure-private helper; the CLI dispatch now lists `install | untrust | uninstall | host`; the `runtimeCommand` overload union has dropped `trust`; PR #79's `runCaTrust()` helper is a new seam at `trust.ts:321-350`; PR #79's `caTrustRemover` capability callback at `trust.ts:166` is the symmetric counterpart to `caTrustInstaller` and is the seam the new `uninstall` consumes. The research-rebase step is complete; the OQ-1 rebase reconciliation from the original research is moot.
- Six frozen-doc locations were missed by the original research and are now enumerated: `docs/specs/f19-docs-site.md:68`, `docs/specs/consolidated-native-runtime.md:119`, `docs/plans/consolidated-native-runtime.md:61`, `docs/plans/cli-activate-deactivate-removal.md:96`, `docs/plans/f17-request-body-rules.md:201`, and `docs/plans/f17-request-body-rules.md:460`. All six must be footnoted by the implementation; the implementation review must grep `untrust` across `docs/specs/*.md` and `docs/plans/*.md` to confirm no further locations are missed.
- The frozen F16 spec/plan/workflow are not edited; only footers are added. The "which lines to supersede" list above is the concrete output the plan must hand to the human gate.
- The user's instruction "matching the prior `trust` removal pattern (PR #79)" was read carefully: this PR is the second half of the same collapse pattern. Symmetry with PR #79 is the primary design constraint.
- The "old `uninstall` body kept as private helper" question diverges from PR #79 (which kept `trust` as a private helper). The user's explicit "the new unified `uninstall` does the work" instruction is binding — the old `untrust` method is deleted entirely (no private helper), and the new `uninstall` body inlines the work. Open question #3 records the rationale and recommendation.
- The `caTrustRemover` throw rollback question (Open question #4) was not specified by the user. The recommendation follows from reading the existing `untrust` body (the remover is best-effort by design — `if ((await existsFile(caKeyFile)) && caTrustRemover)`). Plan phase decides.
- The `editor-asset-paths.test.ts` "pre-existing failure" mentioned by the user was not confirmed in the prior artifacts (RESEARCH/PLAN/IMPLEMENTATION-REVIEW/FINAL-REVIEW). The plan must verify before declaring the feature complete.
- The `reportTrust` `trust ${subcommand} failed:` literal at `runtime.ts:132` is awkward after both collapses, but PR #79 did not address it and the F16-mandated `trust unsupported:` prefix suggests a parallel design. Open question #7 records the choice to leave as-is for this PR.
- No claim was made about a file/line I did not read or grep. The samples directory was confirmed via `ls` (only `basic/`). The docs-site files were confirmed via `grep` (the four files at the expected paths). The post-#79 footer positions were verified via `grep` on each of the four files PR #79 modified.
- The original research's claim that PR #79 deleted the `runtime-command-gating.test.ts:49-54` test was incorrect; that test was already absent pre-#79 (verified by `git show --stat db5661b` — the file is NOT in PR #79's diff). The OQ-10 reconciliation is moot.
- The original research's claim that PR #79 deleted the `status` bullet from `docs/architecture.md` was incorrect; PR #79 only deleted the `trust` bullet, leaving the `status` bullet at L346. The bullet range post-#79 is L343-346 (4 bullets, not 5 as the original research said).

---

> **Implementation review (research-review re-verification, 2026-09-04, free tier `openrouter`).** Verdict: **RESEARCH RE-VERIFIED WITH CORRECTIONS**. The research was re-verified against post-#79 HEAD `db5661b` after the worktree was rebased. **28 file:line citations drifted** (controller, CLI, frozen specs, live docs) and **17 citations remained accurate** (x509, `install(extensionId)` overload union internals, `installerCalled`, `caTrustInstaller`, `caTrustRemover`, `DEFAULT_CAPABILITIES`, `detectTrustCapabilities`, runtime `index.ts:23`, runtime `runtime.test.ts` length and content). **4 citations needed substantive updates** beyond line shifts: (1) the controller surface is now four methods post-#79 (not five), with `trust` as a closure-private helper; (2) `docs/architecture.md` retains the `status` bullet post-#79 (PR #79 did not delete it); (3) `README.md:128` still says `<install|trust|untrust|uninstall>` post-#79 (PR #79 did not update it); (4) `runtime-command-gating.test.ts:49-54` "trust command remains explicit" test was already absent pre-#79 (PR #79's commit message was inaccurate). **Six new frozen-doc footer locations were discovered** that the original research missed (`docs/specs/f19-docs-site.md:68`, `docs/specs/consolidated-native-runtime.md:119`, `docs/plans/consolidated-native-runtime.md:61`, `docs/plans/cli-activate-deactivate-removal.md:96`, `docs/plans/f17-request-body-rules.md:201`, `:460`); the implementation must footnote all six. The `runCaTrust` private helper at `trust.ts:321-350` (added by PR #79) is a new seam that the new `uninstall` does not consume (it consumes `caTrustRemover` directly at `trust.ts:166`). All other claims, constraints, and acceptance criteria remain substantively correct. The plan phase may proceed with these corrections applied.
---

> **Human-gate decisions (2026-09-04):**
> 1. **Internal structure of new `uninstall`:** mirror PR #79's `runCaTrust` private-helper pattern. Extract the CA-removal logic into a private closure helper (e.g. `removeCa()`) so the new `uninstall` can call it; the public factory return drops both `untrust` and the new helper. The plan records the helper name and seams.
> 2. **Success message:** `"runtime uninstall complete: manifest + device-local CA removed"`. Symmetric with PR #79's install wording.
> 3. **Routing clause:** drop `first === "untrust"` from the routing condition at `runtime.ts:319-320`. The `untrust` verb will hit the long-form error at `runtime.ts:325-326` and exit 2. Cleaner routing; diverges from PR #79's pattern (which kept the `trust` clause), but the user explicitly asked to drop the analogous one here.
> 4. **`caTrustRemover` throw semantics:** best-effort. If `caTrustRemover` throws, the file-system side effects (manifest, CA) have already been removed. The throw is surfaced as `result.state === "unsupported"` with the throw message as the reason. Mirrors the existing `untrust` design.
> 5. **Out-of-scope items are IN-scope for this PR:** (a) `README.md:128` pipe list is updated in Phase 4; (b) the `editor-asset-paths.test.ts` pre-existing failure is investigated and either fixed (if this PR broke it) or documented as known-failure in the verify output. The plan records both as Phase 4 and Phase 5 tasks.
