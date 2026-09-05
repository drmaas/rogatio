# RESEARCH — feat/collapse-runtime-install-and-trust

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-install-collapse`
**Branch:** `feat/runtime-install-collapse` @ `ecb0ff1` (= main; no commits yet on this branch)
**Base branch:** main @ `ecb0ff1` (`fix(cli)!: remove broken runtime activate/deactivate/status (#72) (#73)`)
**Investigator:** research subagent (nemotron-3-ultra-free), fresh context.

## Problem restatement (verbatim from the issue body)

> Replace `rogatio runtime install --extension-id ...` + `rogatio runtime trust` with one command: `rogatio runtime install --extension-id <32-char-id>` which transactionally (with rollback on any failure):
> 1. Detects `manifest` capability. Returns `trust unsupported: <reasons>` if absent.
> 2. Writes the Chrome native-messaging host manifest atomically (F16 REQ-009..011).
> 3. Detects `caTrust` capability. If absent, rolls back the manifest and returns `trust unsupported: <reasons>`.
> 4. Generates the device-local CA key + cert (F16 REQ-012), writes them under the install root, and invokes the capability-provided `caTrustInstaller` (F16 REQ-012).
> 5. Returns `runtime install complete` (or the unified message) and exits 0; returns exit 1 only on a real write failure not caught by the capability gate.
>
> `rogatio runtime trust` becomes a **no-op alias for `install`** (kept for one release to avoid breaking installed scripts; removed in a follow-up minor), then is removed.
>
> Non-goals: no change to `activate | deactivate | status | untrust | uninstall | host`; no change to the trust controller's semantics (idempotency F16 REQ-010/REQ-013, manifest atomicity F16 REQ-009..011, capability gating F16 REQ-015..017, `status` non-leakage F16 REQ-019, CA confinement F16 REQ-018); no change to manifest shape, `generateNativeMessagingManifest`, `TRUST_LIMITS`, or `--extension-id` validation (32 chars from `a..p`).
>
> NOTE: There is a recent commit `fix(cli)!: remove broken runtime activate/deactivate/status (#72) (#73)` on `main`. The issue text still mentions `activate | deactivate` as non-goals to preserve. Investigate whether the current main already removed those, and reconcile the AC list with what actually exists today.

Source: `docs/specs/f16-request-body-trust.md`, `docs/plans/f16-request-body-trust.md`, `docs/workflows/f16-workflow.md`, and `packages/{cli,runtime}/src/...` in the worktree.

---

## Reconciliation: the AC list vs. current `main`

The issue lists `activate | deactivate | status` as non-goals to preserve. **The current `main` (HEAD `ecb0ff1`) has already removed them in commit `ecb0ff1` ("fix(cli)!: remove broken runtime activate/deactivate/status (#72) (#73)").** Concrete evidence:

- `packages/cli/src/commands/runtime.ts:159-188` — the `switch` has only cases for `install | trust | untrust | uninstall` plus a `default:` that returns exit 2 with the help text.
- `packages/cli/src/commands/runtime.ts:321-336` — top-level `runtimeCommand` rejects any `first` other than the four trust verbs and `host`; `status`, `activate`, `deactivate` fall through to the error branch (`"Error: 'rogatio runtime' no longer starts or stops the runtime. ..."`).
- `packages/cli/test/runtime-command.test.ts:31-47` — `runtimeCommand(["activate"])`, `runtimeCommand(["deactivate"])`, and `runtimeCommand(["status"])` are each asserted to return exit code 2 (rejected, not preserved).
- `packages/cli/src/commands/runtime.ts:296` — the overload signature lists only `"install" | "trust" | "untrust" | "uninstall" | "host"`. `status` is no longer in the public surface.
- `docs/architecture.md:11, 1052` — the architecture doc explicitly states the three were removed.

Therefore AC-7 ("`untrust`, `uninstall`, `activate`, `deactivate`, `status`, `host` byte-identical") cannot be satisfied as written: the three named subcommands do not exist in the CLI, the controller no longer has a `start`/`stop`/`status` to break, and the spec/plan in F16 was drafted before the removal (`docs/specs/f16-request-body-trust.md:30, 100-102` still enumerate `start | stop | status`). The plan phase must update the AC list to only those verbs that actually exist: `untrust`, `uninstall`, `host`, and the `runtime --help`/top-level help. `activate`/`deactivate`/`status` are not in scope to preserve because they are already gone.

Open question: the issue's text also says "no change to `status`" as a non-goal. Since `status` is no longer a runtime subcommand, "no change" is trivially true at the CLI level. The frozen F16 spec line `runtime status       Show trust standing (installed / trusted)` (`docs/specs/f16-request-body-trust.md:271`) and the corresponding plan line `install|trust|untrust|uninstall` → trust controller; `status` prints both F14 runtime state and F16 trust standing` (`docs/plans/f16-request-body-trust.md:46-47`) are now stale. Out of scope for this feature to re-add `status`; in scope is to align the spec/plan with the post-#73 world. The plan phase should record this in its scope note and let the user decide whether the frozen spec text is also annotated.

---

## Codebase findings

All paths are relative to the worktree root `/home/drmaas/.local/share/opencode/worktree/rogatio/feat/runtime-install-collapse/`.

### 1. Trust controller (`packages/runtime/src/trust.ts`)

#### Constants and types

- `TRUST_LIMITS` (`trust.ts:6-11`) — immutable `{ manifestMaxBytes: 4096, maxAllowedOrigins: 64, caKeyBits: 2048, caValidityDays: 3650 }`. F16 REQ-021.
- `TrustPlatform` (`trust.ts:13`) — `"darwin" | "linux" | "win32" | string`.
- `TrustState` (`trust.ts:15-21`) — `"installed" | "uninstalled" | "trusted" | "untrusted" | "unsupported" | "noop"`.
- `TrustResult` (`trust.ts:23-27`) — `{ ok, state, reasons? }`.
- `NativeMessagingManifest` (`trust.ts:29-35`) — fixed shape `{ name, description, path, type: "stdio", allowed_origins }`.
- `TrustCapabilities` (`trust.ts:37-41`) — `{ manifest: boolean, caTrust: boolean, reasons: string[] }`.
- `TrustStatus` (`trust.ts:43-48`) — `{ installed, trusted, platform, capabilityReasons }`. Used by `controller.status()` and is the JSON surface for AC-7 (non-leakage).
- `ErrorCode` union (`trust.ts:50-57`) — `trust.unsupported | trust.invalid-manifest | trust.invalid-host-path | trust.invalid-origin | trust.write-failed | trust.capability-error | trust.internal`. Stable per F16 REQ-019.
- `TrustError` class (`trust.ts:59-72`) — carries `code` and `reasons`.

#### Pure manifest generation

- `generateNativeMessagingManifest(hostPath, name, allowedOrigins, installRoot): NativeMessagingManifest` (`trust.ts:87-138`) — pure, deterministic. Rejects non-absolute or escaping `hostPath` with `trust.invalid-host-path` (REQ-006); rejects empty `name` with `trust.invalid-manifest` (REQ-007); rejects any origin that does not match `^chrome-extension://[a-p]{32}/?$` with `trust.invalid-origin` (REQ-007); rejects when `allowedOrigins.length > 64` (REQ-021); sorts + de-duplicates `allowed_origins`. Returns the fixed shape. No secrets. This function is **not** changed by the new feature (non-goal).

#### Capability gate

- `detectTrustCapabilities(options)` (`trust.ts:145-150`) — pure, injectable. The default returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` (`DEFAULT_CAPABILITIES` at `trust.ts:76-80`). Capability-based, never OS-name-based (F16 REQ-016/017). Tests inject a `capable()` returning `{ manifest: true, caTrust: true, reasons: [] }` (e.g. `packages/runtime/test/trust.test.ts:27-29`).

#### Controller factory

`createRequestBodyTrustController(options)` (`trust.ts:222-381`) returns `{ install, uninstall, trust, untrust, status }`. Seams:

- `options.platform` (default `process.platform`).
- `options.installRoot` (default `defaultTrustInstallRoot(platform)` — `trust.ts:170-176`, picks `/Applications/Rogatio` on darwin, `%LOCALAPPDATA%/Rogatio` on win32, `$HOME/.local/share/rogatio` elsewhere).
- `options.hostPath` (default `join(installRoot, "runtime-host")`).
- `options.hostName` (default `"com.rogatio.runtime"`).
- `options.manifestDir` (default `installRoot`).
- `options.caKeyFileName | caPubFileName | caCertFileName` (defaults `.rogatio-ca.key`, `.rogatio-ca.pub`, `.rogatio-ca.crt`).
- `options.detectCapabilities` (default `detectTrustCapabilities`).
- `options.caTrustInstaller?: (certPem: string) => Promise<void> | void` — the capability-provided trust-store installer.
- `options.caTrustRemover?: () => Promise<void> | void` — symmetric remover.

The manifest path resolves to `join(manifestDir, "${hostName}.json")` (`trust.ts:246`). CA file paths resolve under `installRoot` (`trust.ts:230-245`).

#### `install(extensionId)` — current behavior (`trust.ts:249-293`)

1. Validates `extensionId` against `/^[a-p]{32}$/`; otherwise returns `{ ok: false, state: "unsupported", reasons: ["invalid-extension-id"] }` (`trust.ts:250-256`).
2. Builds `allowedOrigins = ["chrome-extension://<id>/"]` and calls `generateNativeMessagingManifest(hostPath, hostName, allowedOrigins, installRoot)`. On error, returns `unsupported` with the TrustError's `code` (or `trust.invalid-manifest` fallback).
3. JSON-stringifies with `JSON.stringify(manifest, null, 2)`; rejects when `> TRUST_LIMITS.manifestMaxBytes` (4096) with `["manifest-too-large"]`.
4. **Calls `await detect()`** and returns `unsupportedResult(caps)` if `!caps.manifest` (line 282). This is the F16 REQ-015 gate.
5. `writeFileAtomic(manifestPath(), data)` (`trust.ts:192-198`); on error returns `unsupported` with the error code (e.g. `trust.write-failed`).
6. Returns `{ ok: true, state: "installed" }`.

**Notable: `install` does not write any CA material and does not call `caTrustInstaller`. The CA work lives entirely in `trust()`.** This is the central fact for the feature: the `install` verb must be widened to also perform the CA work that `trust()` does today, on the same call path.

#### `trust()` — current behavior (`trust.ts:308-340`)

1. `await detect()`; returns `unsupported` if `!caps.caTrust` (REQ-015).
2. If `caKeyFile` or `caCertFile` is missing, calls `generateCaKeyPair(TRUST_LIMITS.caKeyBits)` (`x509.ts:53-65`, currently a deterministic test stub) and `createCertificate("CN=Rogatio Request-Body CA", privateKey, TRUST_LIMITS.caValidityDays)` (`x509.ts:7-17`, currently a hard-coded dummy PEM). Writes `caKeyFile`, `caPubFile`, `caCertFile` atomically via `writeFileAtomic`.
3. If `caTrustInstaller && !installerCalled` (a closure flag at `trust.ts:247`), calls `caTrustInstaller(await readFile(caCertFile, "utf8"))` and sets `installerCalled = true`. The flag enforces idempotency across repeated `trust()` calls (REQ-012 idempotency).
4. On any thrown error inside the try block, returns `unsupported` with `codeOf(error, "trust.internal")`. **The current code does not roll back CA material it may have already written when `caTrustInstaller` throws.** It also does not roll back manifest state, but that is irrelevant because `install` and `trust` are separate verbs.
5. Returns `{ ok: true, state: "trusted" }`.

`installerCalled` is only reset by `untrust()` (`trust.ts:350`). Idempotency is per controller instance, not per file-system state; the file-presence check at line 312 re-uses existing material but does not skip `caTrustInstaller` if files already exist (the flag does that).

#### `untrust()` — current behavior (`trust.ts:342-359`)

Calls `caTrustRemover` (if both CA key and cert exist) then `rm(caKeyFile)`, `rm(caPubFile)`, `rm(caCertFile)` with `force: true`. Resets `installerCalled`. Returns `untrusted`. Idempotent (no-op when absent). **Not changed by the new feature.**

#### `uninstall()` — current behavior (`trust.ts:295-306`)

`rm(manifestPath(), { force: true })` and returns `uninstalled`. No-op when absent (idempotent per REQ-011). **Not changed.**

#### `status()` — current behavior (`trust.ts:361-379`)

Reads manifest, parses, checks well-formedness. `installed` = manifest present + well-formed. `trusted` = `caKeyFile` exists AND `caCertFile` exists (file presence is the standing; the controller does not consult the OS trust store). Returns `capabilityReasons` from `detect()`. Never throws. Never leaks paths (REQ-019). **Not changed.**

#### The `installerCalled` flag and the unified install

`installerCalled` (`trust.ts:247`) is closed-over by `install`, `trust`, and `untrust`. The unified install path will need to set this same flag (or share the existing one) so a subsequent legacy `trust` call (during the deprecation window) does not re-invoke `caTrustInstaller` if the material is already there. The plan phase should call this out as a design decision.

#### Rollback seam

The current `uninstall()` (`trust.ts:295-306`) is exactly the rollback primitive for the manifest: `rm(manifestPath(), { force: true })`. For the unified `install`, when `!caps.caTrust` after the manifest was already written, the rollback path is `await controller.uninstall()` (or, inline, `await rm(manifestPath(), { force: true })`).

When `caTrustInstaller` throws after the CA material was written, the rollback must remove `.rogatio-ca.key`, `.rogatio-ca.pub`, `.rogatio-ca.crt` (lines 347-349) and, in the unified path, also remove the manifest. The order is: remove the installer side effect first (the spec implies the manifest should also go), then remove CA material, then remove manifest. The plan phase should fix the order.

#### Helper / edge cases

- `writeFileAtomic(path, data)` (`trust.ts:192-198`) — `mkdir -p dirname`, write to `.<basename>.<pid>.tmp`, then `rename` to target. POSIX atomicity. No Windows-specific handling; `rename` is atomic on NTFS in practice.
- `existsFile(path)` (`trust.ts:200-206`) — `stat` with `try/catch → false`.
- `isWellFormedManifest(value)` (`trust.ts:178-190`) — type guard; does not check `allowed_origins` content (just that each is a string), which is fine because generated manifests are well-formed and the controller only writes its own output. Worth noting: a manually-inserted bad manifest passes this check.
- `codeOf(error, fallback)` (`trust.ts:208-210`) — returns `error.code` if `TrustError`, else `fallback`.
- `unsupportedResult(caps)` (`trust.ts:212-214`) — `{ ok: false, state: "unsupported", reasons: caps.reasons }`. Used at the capability gate.
- `ORIGIN_RE` (`trust.ts:74`) — `^chrome-extension://[a-p]{32}/?$`.

#### x509

- `createCertificate(subject, key, days)` (`packages/runtime/src/x509.ts:7-17`) — **currently a stub returning a hard-coded dummy PEM.** The CA-key generation path in `trust()` will yield a dummy cert + dummy key. This is acceptable for tests (the cert PEM is what `caTrustInstaller` receives and asserts on), but it is load-bearing knowledge for the plan: any test that wants to assert specific CA PEM content must use this stub. Production-real CA generation is out of scope.
- `generateCaKeyPair(bits)` (`x509.ts:53-65`) — test stub returning a deterministic `KeyObject`. Used by `trust()` (line 313).

### 2. CLI dispatch (`packages/cli/src/commands/runtime.ts`)

#### Help text

- `showRuntimeHelp` (`runtime.ts:20-51`) lists the trust verbs (`install`, `trust`, `untrust`, `uninstall`) and the `host` verb. The duplicate copy of this help lives in `packages/cli/src/index.ts:162-198` (`showRuntimeHelp`) and is the one that is invoked by `rogatio runtime --help` (line 75) and the top-level `rogatio --help` indirectly via the `runtime <install|trust|untrust|uninstall|host>` line at `index.ts:116`.
- Top-level help line (`index.ts:116`): `runtime <install|trust|untrust|uninstall|host>  Native messaging runtime control and request-body trust management`. Will need updating to drop `trust` from the pipe list once the deprecation window closes (or keep it for one release with an annotation).

#### `runtimeCommand` dispatch (`runtime.ts:295-336`)

- Overload signatures (`runtime.ts:295-310`) accept `args: ["install" | "trust" | "untrust" | "uninstall" | "host", ...string[]]` and a generic fallback. The `status | activate | deactivate` union is **not** in the signature — they fail the union and fall through to the `string[]` overload, hitting `default:` in the `switch` with exit 2.
- Routing (`runtime.ts:321-329`): if `first` is one of `install | trust | untrust | uninstall`, calls `trustRuntimeCommand(args)`; if `first === "host"`, calls `runtimeHostCommand(args.slice(1))`; else prints the long error and returns 2.

#### `trustRuntimeCommand` (`runtime.ts:137-189`)

- Parses `--extension-id` only when `subcommand === "install"`; rejects missing or non-`/^[a-p]{32}$/` ID with exit 2. The format check is duplicated against the controller's internal check (`trust.ts:250-256`); the controller is the safety net.
- Switch on `subcommand`:
  - `install` → `controller.install(extensionId ?? "")`; reports via `reportTrust("install", result, "trust installed")` (`runtime.ts:161-165`).
  - `trust` → `controller.trust()`; reports via `reportTrust("trust", result, "trust established")` (`runtime.ts:166-171`).
  - `untrust` → `controller.untrust()`; reports `"trust removed"` (`runtime.ts:172-177`).
  - `uninstall` → `controller.uninstall()`; reports `"trust manifest uninstalled"` (`runtime.ts:178-183`).
  - `default:` → exit 2 with the help text.

#### `reportTrust` (`runtime.ts:116-135`)

- `result.ok` → `console.log(okMessage)`, return 0.
- `result.state === "unsupported"` → `console.error("trust unsupported: <reasons joined with ', '>")`, return 0. **This is the F16-mandated exit-0-on-unsupported behavior.** Confirms AC-1/AC-2/AC-3: any "trust unsupported: ..." line exits 0.
- Else → `console.error("trust <subcommand> failed: <reasons>")`, return 1. This is the "real write failure not caught by the capability gate" branch the issue mentions for exit 1.

The unified `install` will need a new `okMessage`. The current candidate strings are:
- `"trust installed"` (today)
- `"runtime install complete"` (per the issue body)
- `"trust installed: manifest + CA trusted"` (or similar)

The plan phase should propose a single new message that covers AC-1's "runtime install complete (or the unified message)" wording, and update the controller's `state` (`trust.ts:292` returns `"installed"`). Note that the controller's `state` cannot become `"trusted"` because the same controller instance will also be used by `untrust` and `uninstall`; choosing `state: "installed"` keeps the success shape stable. The plan should also decide whether the unified install should call the controller's existing `install()` + `trust()` back-to-back (preserving the separate `install` verb in the API for tests that need it) or replace `install` outright.

#### `runtimeHostCommand` (`runtime.ts:191-293`)

- Parses `--root` and `--mock-port`, then a positional path (default `cwd/.rogatio.json`).
- Validates via `validateProjectDetailed` and `compileProject`; returns 1 on diagnostics.
- Builds mock configs, normalizes the preset, calls `runNativeHost`.
- Returns 0 on success. **Not changed.**

#### `runRuntimeHostEntry` (`runtime.ts:343-346`)

The entry point for the manifest's `runtime-host` binary. Calls `runtimeHostCommand(process.argv.slice(2))` and `process.exitCode = code`. **Not changed.**

### 3. Tests

#### `packages/cli/test/runtime-command.test.ts` (54 lines)

- L4-6: `vi.restoreAllMocks()` after each test.
- L13-20: `--help` exits 0 and contains "rogatio runtime".
- L22-29: help text does **not** advertise `activate` or `deactivate` (asserted with `not.toMatch`).
- L31-47: `activate`, `deactivate`, `status` are rejected with exit 2.
- L49-53: unknown subcommand returns 2.

These tests currently pass and confirm the post-#73 surface. They are load-bearing for the AC reconciliation: the unified install must not break the `--help` test (help text must still mention `install | trust | untrust | uninstall | host` — and not `activate`/`deactivate`).

#### `packages/cli/test/runtime-command-gating.test.ts` (55 lines)

- L14-20: `install` without `--extension-id` → exit 2 + error contains "extension-id".
- L22-28: `install --extension-id invalid` → exit 2.
- L30-36: `install --extension-id *` (wildcard) → exit 2.
- L38-47: `install --extension-id <valid 32-char a-p>` exits not 2 (no extension-id error).
- L49-54: `trust` still works (no exit-2 gate).

These gating tests must still pass after the unification. The valid-32-char test is a load-bearing seam: it currently exercises `controller.install("abcdefghijklmnopabcdefghijklmnop")` with the default `detectTrustCapabilities` (which is negative). It returns `unsupported` and `reportTrust` exits 0 with `console.error("trust unsupported: no-capability-provider")`. This is the path the unified `install` must follow when `caps.manifest === false` (AC-2).

#### `packages/cli/test/runtime.test.ts` (175 lines)

- L1-69: imports + helpers (`mockProject`, `frame`, `parseFrame`, `normalizeMockPreset`).
- L82-94: rejects `rogatio runtime <path>` (start) with exit 2. **Not affected by the unification.**
- L96-103: `rogatio runtime host <invalid>` → exit 1.
- L105-135: file mock outside root via `host` → exit 1.
- L137-174: end-to-end native host envelope round-trip for a mock.

None of these are affected by the unification.

#### `packages/runtime/test/trust.test.ts` (263 lines) — the primary seam for new tests

Groups:

- `manifest generation` (L31-90): shape, determinism, host-path rejection, origin rejection. No injection; pure.
- `capability detection` (L92-106): pure default, injectable, capability-not-OS.
- `trust controller lifecycle` (L108-233): the seam-rich group.
  - L27-29 defines a local `capable()` factory used in many tests.
  - L109-123: `install` is idempotent, sets `installed: true`.
  - L125-141: `install` with `manifest: false` returns `unsupported` and writes nothing (asserts `status.installed === false`).
  - L143-158: `uninstall` no-op when absent, removes when present.
  - L160-179: `trust` invokes injected `caTrustInstaller` once (idempotent), `status.trusted === true`.
  - L181-197: `trust` with `caTrust: false` → `unsupported`, installer not called, `status.trusted === false`.
  - L199-215: `untrust` is a no-op when absent, removes CA material, calls remover.
  - L217-232: `status` does not leak paths, host path, or CA material in the serialized output.
- `scope and limits` (L235-262): limit profile, max origins, default install root.

**This is the test file the new rollback tests should grow.** The injection seams (`detectCapabilities`, `caTrustInstaller`, `caTrustRemover`) are already in place, and the `mkdtemp` per-test `root` is the file-system playground. Concrete new tests the plan should propose:

- `unified install: manifest + CA written when both capabilities present` (AC-1) — uses `capable()` plus an injected `caTrustInstaller`; assert manifest file present, CA files present, `status.installed === true && status.trusted === true`, installer called once.
- `unified install: manifest cap absent → trust unsupported, no writes` (AC-2) — `detectCapabilities` returns `{ manifest: false, caTrust: true, reasons: ["manifest-dir-unwritable"] }`; assert `result.ok === false`, `result.reasons` includes the reason, no `*.json` manifest, no CA files.
- `unified install: manifest ok, caTrust cap absent → manifest rolled back, trust unsupported, no CA writes` (AC-3) — `detectCapabilities` returns `{ manifest: true, caTrust: false, reasons: ["no-ca-tooling"] }`; assert `result.ok === false`, manifest file does **not** exist, CA files do **not** exist.
- `unified install: caTrustInstaller throws after manifest + CA written → both rolled back` (AC-4) — `caTrustInstaller` is a `vi.fn` that throws; assert the catch path returns `unsupported`, manifest file does not exist, CA files do not exist.
- Optional: `unified install: caTrustInstaller throws after CA written but before manifest?` — should not be possible with the chosen write order; the plan should commit to an order (recommend: write manifest first, then CA, then `caTrustInstaller`; rollback removes the files in reverse order).

#### `packages/runtime/test/` (other files)

- `lifecycle.test.ts` (11.3K) — F14 lifecycle; not affected.
- `helpers.ts`, `regression.test.ts`, etc. — not affected.

### 4. The F16 spec/plan/workflow

#### `docs/specs/f16-request-body-trust.md` (351 lines) — frozen

- L18-19: enumerates `install | status | trust | untrust | uninstall`. **`status` is still in the surface per the spec** (this is a post-#73 inconsistency).
- L28-31: scope and non-goals.
- L88-102: REQ-001..004 (package and boundaries). REQ-004 (L100-102) lists `install`, `status`, `trust`, `untrust`, `uninstall` plus `start | stop | status` and `--help`. Stale.
- L104-118: REQ-005..008 (manifest).
- L119-144: REQ-009..015 (lifecycle). Key requirements for the unification:
  - REQ-009 (L121-124): `install()` writes the manifest when capable, otherwise returns `trust.unsupported` and writes nothing.
  - REQ-010 (L125-127): `install()` idempotent (same content → no rewrite; different content → atomic overwrite).
  - REQ-011 (L128-130): `uninstall()` removes the manifest; no-op when absent; atomic.
  - REQ-012 (L131-134): `trust()` provisions the device-local CA into the OS trust store; capability-gated; idempotent.
  - REQ-013 (L135-137): `untrust()` removes CA trust; no-op when not trusted; never errors on missing CA.
  - REQ-014 (L138-140): `status()` returns `{ installed, trusted, platform, capabilityReasons }`, no side effects.
  - REQ-015 (L141-143): all mutating operations are capability-gated; missing capability yields `trust.unsupported` with reasons, never uncontrolled throw nor partial trust state.
- L145-153: REQ-016..017 (capability gate). Pure and injectable.
- L155-167: REQ-018..020 (confidentiality). REQ-019 mandates `status` leak-free output.
- L169-173: REQ-021 (resource limits).
- L268-280: CLI surface (L271 still lists `runtime status`).
- L295-317: AC-001..010. AC-008 (L310-312) lists `install | status | trust | untrust | uninstall`. Stale.

The plan phase should add the `> Superseded by: feat/collapse-runtime-install-and-trust` footer to L18-19, L100-102, L271, L310-312 (the lines that enumerate the post-#73-changed verbs). Per the durable-documentation rules (`AGENTS.md`), frozen bodies are not edited; only the footer is appended.

**Additional spec/code drift the plan must know about (not just verb-list drift).** The spec's "Public API And Data Contracts" section also no longer matches the code at HEAD `ecb0ff1`:

- **L207-216 (`RequestBodyTrustControllerOptions`):** the spec lists `readonly clock?: () => number` and is missing `caTrustInstaller` / `caTrustRemover`. The actual code at `trust.ts:152-167` has the two installer/remover fields and no `clock`. The `caTrustInstaller`/`caTrustRemover` seams are the load-bearing additions the unification builds on; the `clock` field is not in the code. Stale spec, frozen.
- **L218-226 (factory return type):** the spec writes `install(): Promise<TrustResult>` (no args). The actual code at `trust.ts:249` is `install(extensionId: string): Promise<TrustResult>`. The unification feature presumes the code's signature, not the spec's.
- **L239-246 (`F16ErrorCode`):** the spec names the union `F16ErrorCode`. The actual code at `trust.ts:50-57` names it `ErrorCode`. Same shape, different name.

The plan should add these three points to the "lines to supersede" footer list (L207-216, L218-226, L239-246), and the plan-review subagent should be told not to "fix" the spec to match the code — the spec is frozen; the footer is the only allowed change.

#### `docs/plans/f16-request-body-trust.md` (79 lines) — frozen

- L3-4: spec/architecture reference.
- L9-50: tasks T1..T8.
- T4 (L29-40) describes the controller. T4 is what the unification changes semantically.
- T6 (L44-50): CLI surface. L46 still says "status prints both F14 runtime state and F16 trust standing". Stale.
- L63-75: AC coverage map.
- L77-79: rollback. Reversal is by removing the module export and CLI routing. **This rollback note is now incomplete** for the unification: the rollback path is more nuanced (manifest + CA + installer side effects).

The plan phase should add a `> Superseded by:` footer to T4, T6, and the rollback note. Not to T1/T2/T3/T5/T7/T8 (those tasks remain accurate).

#### `docs/workflows/f16-workflow.md` (100 lines) — frozen

- L29: `| 2 Architecture | Done | ## F16: Request-Body Trust Lifecycle added to docs/architecture.md |`.
- L35: Stage 8 verification: "F16 module + CLI covered."
- L48-68: Stage 9 review (round 1, passed).
- The workflow does **not** enumerate the verb surface in a list that needs updating; it only references the architecture section. Per the issue's "only if it lists the separate verbs" guard, this file does **not** need a `Superseded by:` footer.

#### `docs/architecture.md` Request-Body Trust Lifecycle section (L335-365)

- L335: section title.
- L337: intro paragraph (one sentence per concept).
- L341: enumerates `install | status | trust | untrust | uninstall`. **Stale; `status` should be dropped.**
- L343-347: bullet list of the five operations, with `status` at L344. **Stale; `status` should be dropped.**
- L349-353: three layers (manifest generation, capability gate, trust controller).
- L355-357: confidentiality/authority boundary.
- L359-363: alternatives rejected.
- L365: footer line "The complete proposed contract and acceptance criteria are in `docs/specs/f16-request-body-trust.md`; the staged workflow record is in `docs/f16-workflow.md`."

This section is in `docs/architecture.md`, which AGENTS.md marks as a **source-of-truth** file (must be kept in sync with the code). It is not a frozen decision record. The plan should edit it to drop `status` and to describe the unified install.

### 5. `rogatio-overview.md`

- L1: title.
- L20-29: the six-step user-experience list. Step 5 is at L28: **"Start the local runtime from the extension's Start runtime control when mocks, response-body rules, or request-body rules require one. Stop it from the extension's Stop runtime control when done."** This is the step the issue refers to as "step 5"; the unification doesn't change its text, because step 5 is about extension-driven start/stop, not the CLI install/trust pair. The CLI two-step appears in step 6 indirectly (L35).
- L33-35: includes "Request-body rules additionally use the trust lifecycle `rogatio runtime install|trust|untrust|uninstall`, and the native-messaging host itself runs as `rogatio runtime host <path>`." This sentence must change to "Request-body rules use the trust lifecycle `rogatio runtime install` (which provisions both the native-messaging host and the device-local CA, capability-gated). Use `rogatio runtime untrust` to remove the CA trust and `rogatio runtime uninstall` to remove the host registration." Or similar; the plan should propose a concrete replacement.
- L41-52: architecture summary; no install/trust references.
- L59: "The public CLI consists exactly of `edit`, `verify`, `test`, and `runtime`." Unaffected.

### 6. `samples/basic/README.md` (300 lines) — the only sample

- L95-122: step 6 ("Start the runtime (mock, response-body, request-body)").
- L101-106: shows `rogatio runtime install --extension-id <id>` then says "Then, in the Rogatio management page, click **Start runtime**."
- L112-117: shows `rogatio runtime trust     # provisions + trusts the device-local CA (capability-gated)`.
- L121-122: "Stop the runtime from the extension; remove trust/host with `rogatio runtime untrust` and `rogatio runtime uninstall`."

The two-step install (install, then trust) is documented here. The plan should replace the `trust` invocation with prose ("the same `install` invocation also provisions the device-local CA on capable platforms") and update the untrust/uninstall note. The sample's `rogatio runtime install` line at L104 is correct; only L116-117 changes. Step 5 ("Activate the group" at L84) is unrelated.

### 7. `CONTRIBUTING.md` (106 lines)

- L50-59: a `Coding standards` section exists. Covers TypeScript, Biome, esbuild, Vitest/Playwright, dependency review. No install/trust language. The plan should ensure the unification change does not violate these standards. The conventional-commits rule (L62-78) is in force: every commit must reference an open issue. Per the issue body, the work is for `https://github.com/drmaas/rogatio/issues/69`; the implementer should confirm the issue number with the user.

### 8. `packages/cli/README.md` (77 lines)

- L42: `rogatio runtime <install|trust|untrust|uninstall>` row in the command table. The plan should update this to drop `trust` (or annotate it as a deprecated alias) once the deprecation window is defined.

### 9. `packages/docs-site/` references to the install/trust surface

- `src/content/docs/guides/runtime.md:16` lists `install | trust | untrust | uninstall`.
- `src/content/docs/reference/cli.md:34` lists `install | trust | untrust | uninstall`.
- `src/content/docs/reference/platforms.md:25` lists `install | trust | untrust | uninstall`.
- `src/content/docs/rules/request-body.md:26` says "the device-local CA trust installed via `rogatio runtime install | trust`".

These are all post-#73 documents. The plan should update all four to drop the `trust` verb from the user-facing list. (The `trust` alias remains for one release per the issue.)

### 10. `scripts/validate.ts` (442 lines) — the canonical pre-commit/CI gate

- L421-441: the `run` calls in order:
  1. `pnpm format:check` (L421)
  2. `pnpm lint` (L422)
  3. `pnpm typecheck` (L423)
  4. `pnpm build` (L424)
  5. `pnpm exec vitest run` (L425)
  6. `await checkArtifacts()` (L426) — verifies `build-manifest.json` matches the expected artifact list, verifies the MV3 extension manifest content, scans MV3 artifacts for forbidden runtime dependencies (`new Function`, `eval(`, `node:`, `process.`, `Buffer`, `ajv`, `@rogatio/`), verifies editor/extension fonts, and verifies the bundled editor in the CLI.
  7. `await checkEmittedModules()` (L427) — dynamic-imports the built `smoke`, `sanity`, `schema`, `compiler`, `core`, and `editor` modules and exercises each.
  8. `await checkBoundaries()` (L428) — verifies per-package dependency manifest contents (schema must depend on ajv at exact published version, compiler must depend only on schema, extension must depend on the four upstream packages, browser-core must depend only on schema + compiler, editor must depend only on compiler + schema, editor source and artifact must not import `node:`/`process.`/`Buffer`/downstream packages).
  9. Three negative typecheck fixtures (`invalid-type`, `undeclared-import`, `forbidden-direction`) via `expectTypeFailure` (L429-440).
  10. `pnpm test:browser` (L441) — Playwright.

**This is "green pnpm validate".** The unification change must not change the build manifest list, must not add a dependency, must not import Node-only modules into the editor or extension artifacts, and must not break the negative typecheck fixtures. The plan should confirm none of these are touched (the change is internal to `trust.ts` and the CLI dispatch in `runtime.ts`).

The root-level invocation is `pnpm validate`, which runs `scripts/validate.ts` via the package.json script (not read here but referenced by CONTRIBUTING L29-34 and the AGENTS rule "Run the repository's canonical validation command (`pnpm validate`)").

### 11. `packages/runtime/src/index.ts` (46 lines)

- L23: `export * from "./trust.js";` re-exports the entire trust module. The unification change does not alter the export shape; the new `install` method still returns `Promise<TrustResult>`, the new test seams use the same injection options. No export added/removed.

### 12. The issue text's note about `activate | deactivate` (final reconciliation)

The issue non-goals still mention `activate | deactivate`. After commit `ecb0ff1`:
- `activate` → exit 2 (`runtime.ts:184-188` default branch, plus `runtime-command.test.ts:31-35`).
- `deactivate` → exit 2 (same path, plus `runtime-command.test.ts:37-41`).
- `status` → exit 2 (same path, plus `runtime-command.test.ts:43-47`).
- `start` / `stop` → also exit 2 (also never wired; pre-existed the #73 commit).

None of these are CLI subcommands anymore. AC-7 must be edited to drop them. The plan must call this out explicitly so the human gate acknowledges the divergence between the issue text and the current tree.

---

## Constraints and invariants

1. **Frozen F16 spec/plan are not edited.** Only the `> Superseded by: feat/collapse-runtime-install-and-trust` footer is appended to the specific lines that enumerate the post-#73-changed verbs.
2. **`TRUST_LIMITS` is not changed.** F16 REQ-021.
3. **`generateNativeMessagingManifest` is not changed.** F16 REQ-005..008.
4. **`--extension-id` validation stays at 32 chars from `a..p`** (`runtime.ts:150` and `trust.ts:250`).
5. **Capability gating must remain pure and injectable.** F16 REQ-015..017. The unified install's two-stage capability check (`manifest` then `caTrust`) is the only behavior change inside the trust module.
6. **`status()` must not leak paths, CA material, or tooling text.** F16 REQ-019. The new test should re-assert this after a successful unified install.
7. **CA private key confinement to `installRoot`.** F16 REQ-018. The unified install must write `.rogatio-ca.key`/`.rogatio-ca.pub`/`.rogatio-ca.crt` to `installRoot` (already the controller's default), and rollback must remove them.
8. **Manifest atomicity via `writeFileAtomic`.** F16 REQ-009/010. Unchanged.
9. **Idempotency.** F16 REQ-010/011/012/013. The unified install must be idempotent: a second call (with the same extension ID and capabilities) must not rewrite the manifest, must not regenerate the CA, and must not re-invoke `caTrustInstaller`. The existing `installerCalled` flag plus the file-presence check in `trust()` already cover this for the CA; the plan should confirm the manifest idempotency test still passes.
10. **No new dependencies.** F16 REQ-002. The unification is internal to `trust.ts` and the CLI dispatch; it does not add packages.
11. **No F15/F17 rule behavior.** F16 REQ-001. The change only touches the install path.
12. **No traffic or body bytes.** F16 REQ-018/020. The trust module never touches bodies.
13. **No persistence outside `installRoot`.** F16 REQ-020. Same.
14. **Exit codes are preserved.** `0` on success, `0` on `trust unsupported: <reasons>` (per `reportTrust` at `runtime.ts:125-130`), `1` only on a non-capability write failure (`runtime.ts:131-135`).
15. **No deprecation alias.** `rogatio runtime trust` is **removed** from the CLI surface per the user's "no alias" decision (research-review human gate). The plan drops the verb from the `runtimeCommand` union, the `trustRuntimeCommand` switch, both copies of the help text, the top-level pipe list, the CLI README, all four docs-site files, `rogatio-overview.md`, the sample README, and the controller's public `trust` method (the CA work is folded into the unified `install` path; whether `trust` is kept as a private helper used by `install` is a plan-phase decision). Anyone invoking `rogatio runtime trust` post-release gets exit 2 via the `default:` branch, matching the post-#73 `status`/`activate`/`deactivate` removal pattern.

---

## Open questions

1. **What is the unified success message?** The issue body suggests "runtime install complete" or "the unified message." The current CLI prints "trust installed" on success of `install` and "trust established" on success of `trust`. The plan must pick one string (proposed default: `"runtime install complete: manifest + device-local CA trusted"` to keep `status.installed` and `status.trusted` discoverable) and update the controller's success `state` semantics if needed.
2. **Should the unified install perform both writes inline, or call `controller.install()` then `controller.trust()` back-to-back?** The two-stage approach reuses the existing functions and is the lowest-risk path, but it has subtle interaction with `installerCalled` and the `state` field. The plan should pick one (recommend: a new private `installAll` that performs capability check, atomic manifest write, CA generation/write, `caTrustInstaller` invocation, with explicit rollback on each step).
3. **What is the rollback order when `caTrustInstaller` throws?** The plan must commit to: remove `caTrustInstaller` side effect (no API for this today — would require either an `uninstall` flag on the installer, or relying on the fact that the installer threw and a separate cleanup happens), then remove CA files, then remove manifest. The current `caTrustInstaller` seam has no rollback signal, so the plan must add one (or accept that a failed `caTrustInstaller` leaves the system in the "manifest present, CA written, not trusted" state — but that violates REQ-015's "no partial trust state" rule and AC-4's "manifest removed").
4. **Should `rogatio runtime trust` be a true alias (prints deprecation notice to stderr, calls the unified install with the extension ID from where?), or should it just print the deprecation notice and exit 0?** Resolved: no alias, no deprecation. `rogatio runtime trust` is removed from the CLI surface entirely. The plan drops the `trust` case from `runtimeCommand` routing, the `trustRuntimeCommand` switch, the help text, the top-level help, the CLI README, the four docs-site files, `rogatio-overview.md`, the sample README, and the controller's `trust` export (or keeps it as a private helper used by the unified install — to be decided in the plan). Anyone who runs `rogatio runtime trust` post-release will hit the `default:` branch and get exit 2 with the help text. This matches the user's "no alias" decision and is consistent with the post-#73 pattern (where `status`/`activate`/`deactivate` were also removed with no deprecation window).
5. **(Resolved)** No deprecation message stream to decide.
6. **Should `rogatio runtime trust` be retained in the `runtimeCommand` type union (`runtime.ts:296`)?** Resolved: no. The type union drops `trust`. The overload signature at `runtime.ts:295-310` becomes `["install" | "untrust" | "uninstall" | "host", ...string[]]` plus the generic fallback. The `default:` branch is unchanged.
7. **Are the help strings updated in both `runtime.ts:20-51` and `index.ts:162-198`?** Yes. The plan should ensure both copies are updated together.
8. **What is the deprecation removal version?** Resolved: not applicable. The user chose to remove `rogatio runtime trust` outright with no deprecation window. No removal version is needed.
9. **Frozen F16 spec lines to supersede.** The spec/code drift is broader than the verb-list. Confirming the lines to footnote: spec L18-19, L28-31, L100-102, L207-216 (options drift: `clock` vs `caTrustInstaller`/`caTrustRemover`), L218-226 (factory return type drift: `install()` vs `install(extensionId)`), L239-246 (`F16ErrorCode` vs `ErrorCode`), L270-280 (the CLI Surface), L310-312 (AC-008). Plan L44-50 (T6), L77-79 (Rollback). Workflow file is not amended.
10. **`rogatio runtime trust` is not aliased — it is removed.** User decision (research-review human gate): "do not alias any runtime commands. just remove the ones no longer needed, they are never coming back." This is a stronger commitment than the issue body proposed ("no-op alias for `install`, kept for one release"). The implementation drops `trust` from the `runtimeCommand` union, the `trustRuntimeCommand` switch, the help text (both copies), the top-level pipe list in `index.ts`, the CLI README command table, the four docs-site files, `rogatio-overview.md`, the sample README, the `trust.test.ts` controller factory's exported `trust` method (internal controller API), and adds `> Superseded by: feat/collapse-runtime-install-and-trust` footers to the frozen spec/plan wherever `trust` is enumerated. The deprecation notice stream question (stderr) is moot: there is no deprecation window. Open question #4 (deprecation alias semantics) and #8 (deprecation removal version) are resolved as "no alias, no deprecation."

11. **Frozen F16 plan T1, T2, T3, T5, T7, T8 — are they still accurate?** Yes. The unification is internal to T4's `createRequestBodyTrustController` and to T6's CLI dispatch.
12. **`status` is not a runtime subcommand post-#73.** The plan must reconcile the issue's `AC-7` against the current tree by dropping `activate`/`deactivate`/`status` from the AC-7 list and editing the AC list before the plan-review subagent records acceptance criteria. This is a human-gate question.
13. **The issue's "reconcile the AC list" — is the research subagent allowed to amend the issue's AC list, or is that the plan's job?** The research subagent's job is to surface the discrepancy. The plan phase edits the AC list with the user's approval at the human gate.
14. **Frozen plan REQ-019 (status non-leakage) still applies post-unification.** The plan should add a new test that calls `status()` after a successful unified install and asserts no leaks (parallel to `trust.test.ts:217-232`).
15. **The `installerCalled` flag is reset by `untrust()`.** After the unification, a successful unified install sets `installerCalled = true`. A subsequent `rogatio runtime untrust` resets it. A subsequent `rogatio runtime install --extension-id <id>` should be idempotent (no rewrite, no re-invoke of `caTrustInstaller`). The plan should add a test for this.
16. **What happens if the user runs `rogatio runtime install` (without `--extension-id`) on a platform where `caps.manifest === false` and `caps.caTrust === false`?** Today: exit 2 (no `--extension-id`). Post-unification: same exit 2 (CLI gate). The plan should confirm no change in this path.
17. **`packages/runtime/test/trust.test.ts:181-197` is the closest existing seam for AC-3.** The new AC-3 test should add a `caTrustInstaller: vi.fn()` to confirm the installer is **not** called when `caTrust === false`, even though `manifest === true`.
18. **`docs/architecture.md:865, 1223` mention `runtime install --extension-id <id>` in different contexts.** The plan should confirm whether either passage also describes the separate `trust` invocation (which would need updating). From the grep results, L865 and L1223 only reference the `install` invocation; no separate `trust` line.
19. **No tests currently exercise a `caTrustInstaller` throw path.** The new AC-4 test is the only place the `try/catch` rollback for `caTrustInstaller` would be exercised. The plan should also add a `runtime test/trust.test.ts` case for the inline (controller-only) `install` rollback so the failure mode is locked down regardless of CLI wiring.
20. **`packages/runtime/src/x509.ts` is a stub.** Real CA generation is not required for the unification; the stub is sufficient for tests. The plan should not introduce real X.509 generation as part of this feature (would be scope creep).
21. **Is `rogatio runtime status` ever coming back?** The architecture doc and the cli-activate-deactivate-removal workflow say "removed (not retained)". Out of scope for this feature to revisit.

---

## Cross-references and pointer summary

- Trust controller: `packages/runtime/src/trust.ts:222-381` (factory), `:249-293` (install), `:308-340` (trust), `:342-359` (untrust), `:295-306` (uninstall), `:361-379` (status), `:192-198` (writeFileAtomic), `:170-176` (default install root), `:200-206` (existsFile), `:178-190` (isWellFormedManifest).
- x509 stub: `packages/runtime/src/x509.ts:7-17` (createCertificate), `:53-65` (generateCaKeyPair).
- CLI dispatch: `packages/cli/src/commands/runtime.ts:20-51` (help), `:104-114` (makeTrustController), `:116-135` (reportTrust), `:137-189` (trustRuntimeCommand), `:191-293` (runtimeHostCommand), `:295-336` (runtimeCommand routing), `:343-346` (runRuntimeHostEntry).
- CLI tests: `packages/cli/test/runtime-command.test.ts:13-53`, `packages/cli/test/runtime-command-gating.test.ts:13-54`, `packages/cli/test/runtime.test.ts:71-175`.
- Runtime tests: `packages/runtime/test/trust.test.ts:27-263` (full file, especially `:27-29` capable() factory, `:109-232` lifecycle group, `:217-232` no-leak status test).
- Frozen spec: `docs/specs/f16-request-body-trust.md` (REQs at `:88-173`; CLI surface at `:268-280`; ACs at `:286-317`). **Spec/code drift beyond verb-list:** L207-216 (`RequestBodyTrustControllerOptions` has `clock` instead of `caTrustInstaller`/`caTrustRemover`); L218-226 (factory return type lists `install()` with no args, code has `install(extensionId)`); L239-246 (spec names `F16ErrorCode`, code names `ErrorCode`). All three need a `Superseded by:` footer.
- Frozen plan: `docs/plans/f16-request-body-trust.md` (T1..T8 at `:9-61`; rollback at `:77-79`).
- Workflow: `docs/workflows/f16-workflow.md` (no verb enumeration; no footer needed).
- Architecture: `docs/architecture.md:335-365` (Request-Body Trust Lifecycle section).
- Overview: `rogatio-overview.md:33-35` (the line to update).
- Sample: `samples/basic/README.md:101-122` (step 6, the install + trust two-step).
- CLI README: `packages/cli/README.md:42` (command table row).
- Docs site: `packages/docs-site/src/content/docs/guides/runtime.md:16`, `.../reference/cli.md:34`, `.../reference/platforms.md:25`, `.../rules/request-body.md:26`.
- Validation: `scripts/validate.ts:421-441` (canonical sequence: format:check → lint → typecheck → build → vitest run → checkArtifacts → checkEmittedModules → checkBoundaries → three typecheck fixtures → playwright).
- Recent commit: `ecb0ff1` on `main`/`feat/runtime-install-collapse` — `fix(cli)!: remove broken runtime activate/deactivate/status (#72) (#73)`.

---

## Self-review notes

- All file paths verified via `read` or `grep`; all line numbers come from the worktree files at HEAD `ecb0ff1`. Nothing cited was inferred.
- The post-#73 reconciliation is the single most important finding; the plan must address it before any test is written.
- The four AC-1..AC-4 seams map cleanly onto existing test fixtures in `trust.test.ts`. The only new infrastructure the unification needs is the `caTrustInstaller` throw path, which the plan must add via a `vi.fn` that throws.
- The frozen F16 spec/plan/workflow are not edited; only footers are added. The "which lines to supersede" list is the concrete output the plan must hand to the human gate.
- No claim was made about a file/line I did not read or grep. The samples directory was confirmed via `ls` (only `basic/`).
- The `rogatio runtime trust` deprecation alias semantics were not specified in the issue; open question #4 captures the ambiguity and proposes a default.
