# PLAN — trust-cross-platform-install

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature-trust-cross-platform-install`
**Branch:** `feature/trust-cross-platform-install`
**Source of truth:** `docs/rpi/trust-cross-platform-install/RESEARCH.md`

---

## Implementation strategy

**TDD** — The feature has well-defined seams (`RequestBodyTrustControllerOptions` injection points), existing test patterns (`trust.test.ts` lifecycle tests inject `detectCapabilities`/`caTrustInstaller`/`caTrustRemover`), and a clear vocabulary contract. Each phase maps to a test file that can be written first (selector, paths, detect, 3× install-remove). The negative-default preservation requirement (`trust.test.ts:102-105`) is a load-bearing test that must not change — TDD ensures this constraint is continuously verified.

---

## Goal

Replace the hardcoded `DEFAULT_CAPABILITIES` `no-capability-provider` default in `packages/runtime/src/trust.ts` and the empty adapter injection in `packages/cli/src/commands/runtime.ts` with a platform-aware trust adapter so `rogatio runtime install --extension-id <id>` either (a) succeeds with manifest written to Chrome's per-OS native-messaging directory and the device-local CA trusted in the user-scope OS trust store, or (b) reports a useful, platform-specific reason (e.g. `elevation-required`, `keychain-unwritable`, `tooling-missing`). The platform adapter file structure and the detector auto-registration pattern mirror F14's `createPlatformInterceptionProvider`; capability detection stays capability-based (probes actual tooling/writability), never OS-name-based; the negative default is preserved for code paths that do not register an adapter so the frozen F16 contract and existing test at `trust.test.ts:102-105` continue to hold.

---

## Non-goals

- No new npm dependency except `@peculiar/x509` (MIT, small, actively maintained) — added to `packages/runtime` for real `createCertificate`/`signCertificate`. All platform invocations use `node:child_process` (prior art: `packages/cli/src/utils/browser.ts`).
- `packages/runtime/src/x509.ts` is updated to use `@peculiar/x509` for real certificate creation and signing. The stub is replaced.
- No change to `uninstall()` semantics: unconditional, idempotent, ignores capability gating.
- No new CLI subcommand; `runtime` surface remains locked at `install | uninstall | host`.
- No change to the trust controller factory signature, no change to `RequestBodyTrustControllerOptions` fields, no change to `install`/`uninstall`/`status` return shape.
- No elevation prompt / `sudo` invocation. The adapter reports a reason; the user re-runs.
- No global mutable registration surface mirroring `registerInterceptionProvider`; detector auto-loads at module init via F14-style static adapter selection (the controller seam is still `RequestBodyTrustControllerOptions.detectCapabilities`, populated by the CLI from a per-OS module).
- No change to `interception.ts`, `lifecycle.ts`, `pac.ts`, `proxy.ts`, `tls.ts`, `host.ts`, `envelope.ts`, `capability.ts` (F14 / F15 / F17 territory). `x509.ts` is updated to use `@peculiar/x509`.
- No new `TrustState` value. Reasons travel through the existing `TrustResult.reasons` and `TrustStatus.capabilityReasons` channels.
- No persistence of install/trust state to `.rogatio.json` or any project file.
- No real CA signing; the adapters do not depend on a non-stub cert.

---

## Architecture

### Adapter file layout (parallel to `createPlatformInterceptionProvider`)

```
packages/runtime/src/trust-platform/
  index.ts              # selectTrustPlatformAdapter(process.platform)
  darwin.ts             # defaultManifestDir, defaultCaInstallPath, detect(), installer, remover
  linux.ts              # defaultManifestDir, defaultCaInstallPath, detect(), installer, remover
  win32.ts              # defaultManifestDir, defaultCaInstallPath, detect(), installer, remover
  unsupported.ts        # negative-capability adapter for unknown platforms
  types.ts              # TrustPlatformAdapter interface (shared)
```

`probe.ts` is not created; capability probes are inlined per-adapter to avoid a shared helper with injectable overrides (test complexity not justified for three simple probes).

`packages/runtime/src/trust-platform/index.ts` exports `selectTrustPlatformAdapter(platform: TrustPlatform): TrustPlatformAdapter` returning one of the four concrete adapters. The selector is a pure `switch` on `process.platform` with `unsupported` as the default — it does **not** perform capability detection. The `TrustPlatformAdapter` interface is defined in `types.ts`:

```ts
export interface TrustPlatformAdapter {
  readonly platform: TrustPlatform;
  readonly defaultManifestDir: () => string;
  readonly defaultCaInstallPath: () => string;
  detect(): TrustCapabilities;           // pure: probe tooling + writability, return reasons
  caTrustInstaller(certPem: string): Promise<void>;  // throws TrustError with reason on failure
  caTrustRemover(): Promise<void>;        // idempotent; throws only on unexpected failure
}
```

The `unsupported` adapter returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` from `detect()` and no-op (throw `TrustError("trust.internal", "unsupported-platform", ["no-capability-provider"])`) for installer/remover. Its path getters return `""` (empty string) — callers must guard with `detect()` first.

### Default manifest directory (per OS, user-scope)

Chrome scans per-user manifest directories on every OS:

| OS | Manifest directory | CA install target (user-scope) |
| --- | --- | --- |
| darwin | `join(process.env.HOME ?? "", "Library/Application Support/Google/Chrome/NativeMessagingHosts")` | `join(process.env.HOME ?? "", "Library/Keychains/login.keychain-db")` (`security add-trusted-cert -d -r trustRoot -k …`) |
| linux | `join(process.env.HOME ?? "", ".config/google-chrome/NativeMessagingHosts")` | `join(process.env.HOME ?? "", ".local/share/ca-certificates")` (directory; cert file is `rogatio-ca.crt` inside) + invoke `update-ca-certificates` if present |
| win32 | `join(process.env.APPDATA ?? "", "Google", "Chrome", "NativeMessagingHosts")` | `Cert:\CurrentUser\Root` via `certutil -addstore -f "Root" "<cert>"` (no admin needed) |

Rationale (per RESEARCH open-question 1 + 3): the user-scope path is the minimum viable product for the extension's own Chrome profile, requires no elevation, and avoids `sudo` / `runas` complexity. The system-scope path (`/Library/Keychains/System.keychain`, `/usr/local/share/ca-certificates`, `Cert:\LocalMachine\Root`) is out of scope for this slice; if the user-scope path is unwritable the adapter reports `keychain-unwritable` (darwin) / `ca-store-unwritable` (linux) / `elevation-required` (win32 system store) and the user may re-run with elevation in a future slice. The manifest write is split from `installRoot`: the controller writes CA material under `installRoot` and the manifest under `defaultManifestDir()` (per RESEARCH open-question 1, option b).

**Edge cases handled:**
- `HOME`/`APPDATA` unset → empty string path; `detect()` will report `manifest-dir-unwritable` / `ca-store-unwritable` (not crash).
- macOS login keychain missing (new user) → `security` fails; installer throws `keychain-unwritable`.
- Linux `~/.local/share/ca-certificates` missing → installer creates it via `mkdir -p` before writing cert.
- Windows `Cert:\CurrentUser\Root` is a PowerShell cert store path, not a filesystem path; writability is **not** probed via `accessSync`. `detect()` probes `certutil` presence only; `caTrust` capability = `tooling` presence. The remover uses `certutil -delstore "Root" "<subject>"` with subject match.

### Capability detection (capability-based, not OS-name-based)

Each adapter's `detect()`:

1. Probes the expected tooling with `which` (linux/darwin) / `where` (win32) via `node:child_process` `spawnSync` (1 s timeout — fast lookups, no async race in CI).
2. Probes writability of `defaultManifestDir()` via `accessSync(dir, fs.constants.W_OK)`.
3. Probes CA store writability per OS:
   - darwin: `accessSync(dirname(defaultCaInstallPath()), W_OK)` (login keychain directory)
   - linux: `accessSync(defaultCaInstallPath(), W_OK)` (ca-certificates directory; created if missing by installer)
   - win32: **no filesystem writability probe** — `Cert:\CurrentUser\Root` is a cert store, not a filesystem path. `caTrust` capability = `certutil` presence only.
4. Returns `{ manifest, caTrust, reasons }`. `reasons` is sorted, de-duplicated, and stable. Vocabulary (locked):
   - `"no-capability-provider"` — negative default only (unsupported adapter, `detectTrustCapabilities()`)
   - `"tooling-missing"` — required CLI tool not on PATH
   - `"manifest-dir-unwritable"` — `accessSync(manifestDir, W_OK)` failed
   - `"keychain-unwritable"` — darwin keychain dir unwritable or `security` failed
   - `"ca-store-unwritable"` — linux ca-certificates dir unwritable
   - `"elevation-required"` — win32 system store (not used in user-scope MVP; reserved)

The detector is **pure with respect to capability**: it never gates on `process.platform` alone; a darwin system missing `security` reports `manifest: false, caTrust: false, reasons: ["tooling-missing"]`, not a Darwin-specific reason. The selector is the only place `process.platform` is consulted.

### CLI wiring (`makeTrustController()`)

```ts
function makeTrustController() {
  const platform = process.platform;
  const adapter = selectTrustPlatformAdapter(platform);
  const installRoot = defaultTrustInstallRoot(platform);
  return createRequestBodyTrustController({
    platform,
    installRoot,
    hostPath: join(installRoot, "runtime-host"),
    hostName: "com.rogatio.runtime",
    allowedOrigins: [],
    manifestDir: adapter.defaultManifestDir(),
    detectCapabilities: () => adapter.detect(),
    caTrustInstaller: (cert) => adapter.caTrustInstaller(cert),
    caTrustRemover: () => adapter.caTrustRemover(),
  });
}
```

This is the only call site of `selectTrustPlatformAdapter`. The adapter is chosen once per controller instance, no global mutation. The existing `runtime.test.ts` mocks continue to work because they inject `detectCapabilities` / `caTrustInstaller` / `caTrustRemover` directly.

**Note:** `manifestDir` is now the Chrome native-messaging directory (per-OS), not `installRoot`. The `installRoot` continues to hold the CA material (`.rogatio-ca.{key,pub,crt}`) and the `runtime-host` binary. Tests that inject `manifestDir: installRoot` continue to pass — the option is preserved for test overrides.

### Negative default preservation

`detectTrustCapabilities()` in `trust.ts:145-150` is **not changed**. It still returns `{ ...DEFAULT_CAPABILITIES }`. The new behavior lives in `trust-platform/{darwin,linux,win32}.ts` and is wired in by `makeTrustController()` (not by the trust controller factory). The `unsupported` adapter exists for safety: if `selectTrustPlatformAdapter` ever returns it (today, only on platforms outside the `darwin | linux | win32` set — practically dead code on the supported baseline), it returns the same negative default.

This preserves:
- `trust.test.ts:93-100` — `detectTrustCapabilities()` returns the negative default.
- `trust.test.ts:102-105` — `detectTrustCapabilities({ platform: "darwin" })` returns `{ manifest: false }`. The platform-aware adapter is never consulted when this default is invoked, because the controller seam defaults to `detectTrustCapabilities` and the test does not inject anything else. **This test is the load-bearing assertion that capability detection is not OS-name-based; it must not be modified.**

### Frozen-doc discipline (per AGENTS.md)

The plan appends `> Superseded by: feature/trust-cross-platform-install` footers at the affected lines in the F16 spec/plan (REQ-009 wording about "the platform's Chrome native-messaging manifest directory" — the implementation now points at the user-scope Chrome directory on each OS) and updates `docs/architecture.md:335-363` to describe the per-OS adapter pattern. `rogatio-overview.md:61` is updated to clarify that user-scope CA trust is the default install path. The docs site (`packages/docs-site/src/content/docs/`) is verified during Phase 5 task 5.5 to not currently describe the install path; if it does, that edit is a separate follow-up.

**Exact footer locations (enumerated for Phase 5.2):**
1. `docs/specs/f16-request-body-trust.md:131-136` (REQ-009 — manifest directory per platform)
2. `docs/specs/f16-request-body-trust.md:144-148` (REQ-012 — device-local CA provisioning)
3. `docs/plans/f16-request-body-trust.md:24-28` (T3 — detector seam)
4. `docs/specs/f16-request-body-trust.md:23-26` — confirm no further footers needed (collapse footers already present)

---

## Phases

Each phase produces a runnable, validated slice. Checklists reference `CHECKLIST.md` ranges.

### Phase 1 — Adapter scaffolding (`CHECKLIST.md` Phase 1, tasks 1.1–1.4)

Stand up the `trust-platform/` directory with the file layout, the `TrustPlatformAdapter` interface in `types.ts`, the `unsupported` adapter, and `darwin`/`linux`/`win32` stubs returning the negative default with `reasons: ["tooling-missing"]` from `detect()` and throwing `TrustError("trust.internal", "not-implemented", ["tooling-missing"])` from installer/remover. Path getters return `""`. The selector chooses the adapter by `process.platform`. No controller wiring yet; the module compiles but the CLI does not consume it. Acceptance: `pnpm validate` runs clean; new unit tests in `packages/runtime/test/trust-platform/selector.test.ts` assert `selectTrustPlatformAdapter("darwin" | "linux" | "win32")` returns the matching platform; `selectTrustPlatformAdapter("freebsd")` returns the `unsupported` adapter; `selectTrustPlatformAdapter(process.platform)` selects correctly. Tests stub `spawnSync` and `accessSync` to avoid touching the filesystem or invoking subprocesses.

### Phase 2 — Default manifest directory + default CA path (`CHECKLIST.md` Phase 2, tasks 2.1–2.4)

Implement `defaultManifestDir()` and `defaultCaInstallPath()` for each adapter per the path table above. Acceptance: tests in `packages/runtime/test/trust-platform/paths.test.ts` assert the three platform paths match the table (with `HOME` / `APPDATA` expansion via `vi.stubEnv`). Pure string computation; no I/O.

### Phase 3 — Capability detection (`CHECKLIST.md` Phase 3, tasks 3.1–3.5)

Implement `adapter.detect()` per OS. Each adapter probes tooling presence with `spawnSync("which", [tool])` (linux/darwin) or `spawnSync("where", [tool])` (win32), then probes writability with `accessSync(dir, fs.constants.W_OK)` (except win32 CA store). The detector returns `{ manifest, caTrust, reasons }` with sorted/de-duplicated reasons from the locked vocabulary. Acceptance: tests in `packages/runtime/test/trust-platform/detect.test.ts` stub `spawnSync` and `accessSync` (vitest's `vi.spyOn` on `node:child_process` and `node:fs`) to assert reason vocabulary and boolean flags across the matrix (tooling present + writable → `true`, tooling missing → `["tooling-missing"]`, dir unwritable → `["manifest-dir-unwritable"]`, etc.). Tests confirm the detector never gates on `process.platform` alone: a mocked darwin with missing tooling still returns `manifest: false`.

### Phase 4a — CA installer / remover: darwin (`CHECKLIST.md` Phase 4a, tasks 4a.1–4a.3)

Implement `darwin.ts` `caTrustInstaller(cert)` / `caTrustRemover()` using `spawn("security", [...])`. Installer: write cert to tmp file, `security add-trusted-cert -d -r trustRoot -k <login-keychain> <tmp>`. Remover: `security delete-certificate -c "CN=Rogatio Request-Body CA" <login-keychain>`. Both ignore "already present" / "not found" exit codes (idempotent). Non-zero exit → `TrustError("trust.internal", "<reason>", ["keychain-unwritable" | "elevation-required" | "tooling-missing"])`. Error message **must not** contain stderr, cert paths, or `security:` output. Acceptance: tests in `packages/runtime/test/trust-platform/darwin-install-remove.test.ts` stub `spawn`, assert argv form, idempotency, throw-on-failure, and vocabulary compliance.

### Phase 4b — CA installer / remover: linux (`CHECKLIST.md` Phase 4b, tasks 4b.1–4b.3)

Implement `linux.ts` `caTrustInstaller(cert)` / `caTrustRemover()` using `spawn`. Installer: `mkdir -p <ca-dir>`, write cert to `<ca-dir>/rogatio-ca.crt`, `spawn("update-ca-certificates")`. Remover: `rm <ca-dir>/rogatio-ca.crt`, `spawn("update-ca-certificates")`. Non-zero exit → `TrustError("trust.internal", "<reason>", ["ca-store-unwritable" | "tooling-missing"])`. Acceptance: tests in `packages/runtime/test/trust-platform/linux-install-remove.test.ts` stub `spawn`, assert argv, idempotency, vocabulary.

### Phase 4c — CA installer / remover: win32 (`CHECKLIST.md` Phase 4c, tasks 4c.1–4c.3)

Implement `win32.ts` `caTrustInstaller(cert)` / `caTrustRemover()` using `spawn`. Installer: write cert to tmp file, `spawn("certutil", ["-addstore", "-f", "Root", tmpPath])`. Remover: `spawn("certutil", ["-delstore", "Root", "CN=Rogatio Request-Body CA"])`. Non-zero exit → `TrustError("trust.internal", "<reason>", ["elevation-required" | "tooling-missing"])`. Acceptance: tests in `packages/runtime/test/trust-platform/win32-install-remove.test.ts` stub `spawn`, assert argv, idempotency, vocabulary.

### Phase 5 — CLI wiring + frozen-doc footers + live-doc sync (`CHECKLIST.md` Phase 5, tasks 5.1–5.6)

Update `makeTrustController()` in `packages/cli/src/commands/runtime.ts:103-113` to inject the adapter per the architecture section. Add `> Superseded by: feature/trust-cross-platform-install` footers at the four locations enumerated above. Update `docs/architecture.md:335-363` to describe the per-OS `trust-platform/` directory, the `selectTrustPlatformAdapter` selector, the user-scope CA store default, and the capability-based detector. Update `rogatio-overview.md:61` to clarify user-scope install is the default and that elevation is required only for system-scope (not implemented in this slice). Confirm `packages/docs-site/src/content/docs/...` does not currently describe the install path (record "no doc-site change" in `workflow.md` if so). Acceptance: `pnpm validate` clean; the four `runtime-install-success` / `runtime-uninstall-success` / `runtime-command` / `runtime-command-gating` CLI tests pass; the trust module's 18 lifecycle tests still pass; `pnpm biome:check` and `pnpm typecheck` clean.

### Phase 6 — Verification + review (`CHECKLIST.md` Phase 6, tasks 6.1–6.4)

Run the full canonical validation: `pnpm validate`. Capture evidence into `docs/rpi/trust-cross-platform-install/workflow.md`. Spawn the independent review subagent (verification role from `rpi/SKILL.md`). If the review flags scope creep, file the issues in `RISKS.md` (created during implementation if needed). Acceptance: zero `pnpm validate` errors; no new lint/typecheck warnings; all 18 trust lifecycle tests + the 4 CLI tests + the new platform-adapter tests (selector, paths, detect, 3× install-remove) pass.

---

## Risks

1. **Chrome manifest directory conventions shift between OS versions.** The path table assumes Chrome stable conventions: darwin `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, linux `~/.config/google-chrome/NativeMessagingHosts`, win32 `%APPDATA%\Google\Chrome\NativeMessagingHosts`. Chromium and ChromeOS use different paths (out of scope — overview says "all supported OSes" is darwin/linux/win32). If a user has a non-default `CHROME_USER_DATA` or runs Chromium Beta, Chrome will not find the manifest. **Mitigation:** reasons vocabulary does not include a path-leaking string; the user sees `manifest-dir-unwritable` or `tooling-missing`. **Recorded as a known limitation in `rogatio-overview.md`.**
2. **`security`/`certutil`/`update-ca-certificates` may not be on PATH in stripped-down CI images or fresh containers.** `detect()` will return `tooling-missing` and `runtime install` will report `trust unsupported: tooling-missing`. **Mitigation:** the existing negative-default test at `trust.test.ts:102-105` continues to hold because `detectTrustCapabilities()` is unchanged. CI on Linux will exercise the linux adapter with stubbed `spawnSync`; the real subprocess invocation runs only in real environments. **Recorded limitation: feature works only where the OS tooling is present (this is the explicit MVP per the user's request).**
3. **`x509.ts` now uses `@peculiar/x509` for real certificate creation.** `createCertificate` generates a real self-signed CA with proper Basic Constraints; `signCertificate` signs leaf certs for TLS interception. Added `@peculiar/x509` to `packages/runtime/package.json` (MIT, ~200 KB). The adapter receives a valid PEM; Chrome will trust it for TLS interception once the proxy uses `signCertificate`. **No limitation — trust-store install and TLS interception both work.**
4. **System-scope CA install path is intentionally absent.** The user-scope path is the MVP. Users who need system-scope (corporate Chrome installs, multi-user hosts) will see `keychain-unwritable` on darwin (login keychain quota / permission prompt failure), `ca-store-unwritable` on linux (no write access to `~/.local/share/ca-certificates` — typically writable, but NSS-aware apps may still consult `/etc/ssl/certs`), and `elevation-required` on win32 (Cert:\LocalMachine\Root). **Mitigation: not implemented per user's "user-scope first" instruction. Future slice.**
5. **`accessSync(dir, W_OK)` is advisory on some filesystems** (e.g. NFS, FUSE mounts, bind-mounted volumes). The detector may report `true` when the actual write would fail. **Mitigation:** the existing `install()` catches `writeFileAtomic` failures and surfaces them as `trust.write-failed` (`trust.ts:285-290`) — the install path is already transactional.
6. **`spawnSync` arguments may exceed ARG_MAX on platforms with very long `HOME` paths** (rare; unlikely). **Mitigation:** use of `spawn` (argv array) instead of `exec` (string concat) sidesteps this. **Acceptance: tests assert argv form.**
7. **Status non-leakage (`trust.test.ts:190-204, 433-460`) is preserved only if the adapter does not throw with `stderr`-bearing messages.** The architecture pins the throw message to short vocabulary strings (`"tooling-missing"`, `"elevation-required"`, etc.); the `reasons` array is also bounded to vocabulary. **Mitigation: tests assert that no adapter error message contains a cert path, `security:` output, or `certutil:` text.**
8. **The new `defaultManifestDir` decouples the manifest write from `installRoot`.** Tests at `trust.test.ts` that inject `manifestDir: root` continue to pass (the option is preserved), but the production path now writes the manifest into a Chrome directory and CA material under `installRoot`. **Mitigation: `defaultTrustInstallRoot` is unchanged.** If a future user wants both under `installRoot`, they pass `manifestDir` explicitly.
9. **Per-OS `security`/`certutil` invocations differ across macOS versions.** The `security add-trusted-cert -d -r trustRoot -k <login>` command is stable since macOS 10.13; older versions may require `-D` to avoid duplicate detection. **Mitigation: documented MVP assumes macOS 12+. Older versions fall back to `tooling-missing` from the probe.**
10. **Frozen-decision-record footer line count.** Phase 5 adds four footers; if any are missing, the F16 spec remains silently inaccurate. **Mitigation: Phase 5 checklist task 5.2 enumerates the exact files and line ranges.**

11. **Windows `Cert:\CurrentUser\Root` is not a filesystem path.** `accessSync` cannot probe it; win32 `detect()` probes `certutil` presence only for `caTrust` capability. If `certutil` is present but the user store is corrupted/locked, the error surfaces at install time via `elevation-required` or `tooling-missing`. **Mitigation: documented in capability detection section; win32 adapter does not probe CA store writability.**

12. **macOS login keychain may not exist for new users.** `security` will fail; installer throws `keychain-unwritable`. **Mitigation: user must have logged in at least once (standard macOS behavior). Not a supported edge case for MVP.**

13. **Linux `~/.local/share/ca-certificates` may not exist.** Installer creates it via `mkdir -p` before writing cert. **Mitigation: implemented in linux adapter installer.**

14. **Chrome variant paths (Chromium, Edge, Brave, Chrome Beta/Dev/Canary) not addressed.** The manifest is written to Chrome stable directories only. **Mitigation: recorded as known limitation; future slice may add `--browser` flag or auto-detection.**

### Scope creep flags (per the planning instructions)

The following would be out of scope and are NOT in this plan:

- A new `TrustState` value. Vocabulary stays in `reasons` strings only.
- A new CLI flag (`--elevation` / `--system-scope`). User re-runs with elevation manually.
- A change to the `install`/`uninstall`/`status` return shape.
- A change to `uninstall()` semantics (idempotent + capability-unconditional).
- A global mutable adapter registration surface (`registerTrustPlatformAdapter`). Selection is local to `makeTrustController`.
- A doc-site change (`packages/docs-site/`) — verified to not currently describe the install path; if it does, that edit is a separate follow-up.

---

## Acceptance criteria

The feature is done when **all** of the following hold:

1. `rogatio runtime install --extension-id <32-char id>` on macOS writes `<chrome manifest dir>/com.rogatio.runtime.json`, generates `.rogatio-ca.{key,pub,crt}` under `installRoot`, and adds the cert to the user login keychain via `security add-trusted-cert`. The CLI exits 0 with `runtime install complete: manifest + device-local CA trusted`.
2. `rogatio runtime install --extension-id <32-char id>` on Linux (with `update-ca-certificates` present and `~/.local/share/ca-certificates/` writable) writes the manifest under `~/.config/google-chrome/NativeMessagingHosts/`, drops the cert in `~/.local/share/ca-certificates/rogatio-ca.crt`, and runs `update-ca-certificates`. CLI exits 0.
3. `rogatio runtime install --extension-id <32-char id>` on win32 (with `certutil` on PATH) writes the manifest under `%APPDATA%\Google\Chrome\NativeMessagingHosts\`, and runs `certutil -addstore -f "Root" "<cert>"`. CLI exits 0.
4. When the platform adapter's tooling probe fails, the CLI prints `trust unsupported: tooling-missing` and exits 0 (existing F16 REQ-019 contract preserved). When the manifest dir is unwritable, the reason is `manifest-dir-unwritable`. When the CA store is unwritable, the reason is `ca-store-unwritable`. Reasons are sorted, de-duplicated, and drawn from the locked vocabulary.
5. `rogatio runtime uninstall` is unconditional, idempotent, and removes the manifest, the three CA files, and the OS trust-store entry (via the per-OS `caTrustRemover`). Calling it twice yields `ok: true` both times. Existing `trust.test.ts:386-403` ("unified uninstall: succeeds without capability gating") continues to pass without modification.
6. `detectTrustCapabilities()` (called directly, with no controller injection) returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` for any platform argument, including `{ platform: "darwin" }`. Existing `trust.test.ts:92-105` continues to pass without modification.
7. `status()` never leaks paths, CA material, or third-party tooling text. Existing `trust.test.ts:190-204, 433-460` continues to pass without modification.
8. `pnpm validate` (the canonical pre-commit/CI gate) is clean. `pnpm biome:check`, `pnpm typecheck`, `pnpm build`, `pnpm test` all pass. The CLI's four runtime command tests pass.
9. The four `runtime-*.test.ts` CLI tests (mock the entire controller) continue to pass — no behavior regression in the mocked path.
10. `@peculiar/x509` is the only new npm dependency, added to `packages/runtime/package.json`. `packages/runtime/src/x509.ts` exports real `createCertificate` (self-signed CA with Basic Constraints: CA=true, pathlen=0) and `signCertificate` (leaf cert signed by CA). Only `node:child_process` and `node:fs` (already used) are added to imports in the new `trust-platform/*` files.
11. The 18 `packages/runtime/test/trust.test.ts` lifecycle tests continue to pass with zero edits. The new platform-adapter tests in `packages/runtime/test/trust-platform/*.test.ts` pass (selector, paths, detect, 3× install-remove).
12. Frozen-doc footers are appended at the four locations enumerated in Phase 5 task 5.2. `docs/architecture.md` describes the per-OS adapter pattern in section `## Request-Body Trust Lifecycle` (lines 335–363). `rogatio-overview.md:61` clarifies the user-scope install path.
13. **Vocabulary enforcement:** All adapter `detect()` return values use only the locked vocabulary `{ "no-capability-provider", "tooling-missing", "manifest-dir-unwritable", "ca-store-unwritable", "keychain-unwritable", "elevation-required" }`. Automated test in `detect.test.ts` asserts no other strings appear in `reasons`.
14. **Error message hygiene:** All `TrustError` throws from adapters have messages containing only short vocabulary strings (no stderr, no cert paths, no `security:`/`certutil:` output). Automated test in each `*-install-remove.test.ts` asserts this.
16. **CLI remediation hints:** When `runtime install` reports `trust unsupported`, the output appends a platform-specific hint line:
    - `tooling-missing` → `Hint: install required tooling (macOS: security; Linux: update-ca-certificates; Windows: certutil is built-in)`
    - `manifest-dir-unwritable` → `Hint: check permissions on Chrome NativeMessagingHosts directory or run with appropriate access`
    - `keychain-unwritable` → `Hint: macOS login keychain not writable; try running with appropriate keychain access or use sudo for system keychain (future slice)`
    - `ca-store-unwritable` → `Hint: ~/.local/share/ca-certificates not writable; check permissions`
    - `elevation-required` → `Hint: Windows system certificate store requires Administrator; re-run in elevated terminal (future slice)`

The hint is printed to stderr after the `trust unsupported: ...` line and exits 0 (preserving F16 REQ-019 contract).