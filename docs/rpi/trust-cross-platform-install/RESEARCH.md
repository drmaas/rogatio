# RESEARCH — trust-cross-platform-install

**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature-trust-cross-platform-install`
**Branch:** `feature/trust-cross-platform-install`
**Scope:** make `rogatio runtime install --extension-id <id>` succeed (or report a useful platform-specific reason) on all supported OSes (darwin, linux, win32).

All paths are relative to the worktree root unless noted.

---

## Problem restatement

> A user runs `rogatio runtime install --extension-id <id>` and sees `trust unsupported: no-capability-provider`. The root cause is that `packages/runtime/src/trust.ts` ships a hardcoded `DEFAULT_CAPABILITIES = { manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` (lines 76-80) and `detectTrustCapabilities` (lines 145-150) is a pure function that ignores its options and always returns that negative default. The CLI's `makeTrustController()` in `packages/cli/src/commands/runtime.ts:103-113` does not inject any `detectCapabilities`/`caTrustInstaller`/`caTrustRemover` so the controller always reports `unsupported` for any platform. As a result, `rogatio runtime install` cannot provision the native-messaging host manifest or device-local CA on any OS. The goal of this work is to make `rogatio runtime install` succeed (or report a useful platform-specific reason) on **all supported OSes** (darwin, linux, win32) so that any user can install the request-body trust. The product overview (`rogatio-overview.md`) states that request-body activation is capability-based and that macOS is the reference supported platform, with Linux/Windows able to activate "when those capabilities are present." Today those capabilities are never present because no adapter exists.

---

## Codebase findings

### 1. Trust controller surface — `packages/runtime/src/trust.ts`

- **Constants / types:**
  - `TRUST_LIMITS` (`trust.ts:6-11`) — immutable `{ manifestMaxBytes: 4096, maxAllowedOrigins: 64, caKeyBits: 2048, caValidityDays: 3650 }`.
  - `TrustPlatform = "darwin" | "linux" | "win32" | string` (`trust.ts:13`).
  - `TrustState = "installed" | "uninstalled" | "trusted" | "untrusted" | "unsupported" | "noop"` (`trust.ts:15-21`).
  - `TrustResult { ok, state, reasons? }` (`trust.ts:23-27`).
  - `NativeMessagingManifest { name, description, path, type: "stdio", allowed_origins }` (`trust.ts:29-35`).
  - `TrustCapabilities { manifest, caTrust, reasons }` (`trust.ts:37-41`).
  - `TrustStatus { installed, trusted, platform, capabilityReasons }` (`trust.ts:43-48`).
  - `ErrorCode` and `class TrustError extends Error` (`trust.ts:50-72`).

- **Hard-coded negative default (`trust.ts:76-80`):**
  ```ts
  const DEFAULT_CAPABILITIES: TrustCapabilities = {
    manifest: false,
    caTrust: false,
    reasons: ["no-capability-provider"],
  };
  ```

- **`detectTrustCapabilities({ platform?, manifestDir? })` (`trust.ts:145-150`)** — pure function with `void options;` and returns `{ ...DEFAULT_CAPABILITIES }`. The signature accepts `platform` and `manifestDir` but neither is consulted.

- **`RequestBodyTrustControllerOptions` (`trust.ts:152-167`)** — accepts optional `detectCapabilities`, `caTrustInstaller(certPem)`, `caTrustRemover()` as injection seams. The `install` body uses `await detect()` (twice: once for `manifest`, once for `caTrust` — `trust.ts:281, 292`). The factory falls back to the negative `detectTrustCapabilities` when `detectCapabilities` is not injected (`trust.ts:238`).

- **Controller surface — `createRequestBodyTrustController` (`trust.ts:222-410`):**
  - `install(extensionId)` (`trust.ts:249-319`) — validates extension ID (`/^[a-p]{32}$/`); generates manifest; checks `manifest` capability then writes manifest; checks `caTrust` capability; on miss, rolls back the just-written manifest (`trust.ts:294-298`); calls private `trust()`/`runCaTrust()` (`trust.ts:321-350`) which generates keypair via `x509.ts` (stub), writes `caKeyFile`/`.rogatio-ca.key`, `caPubFile`/`.rogatio-ca.pub`, `caCertFile`/`.rogatio-ca.crt`, invokes `caTrustInstaller` (gated by `installerCalled` flag at `trust.ts:247` for idempotency).
  - `uninstall()` (`trust.ts:362-375`) — unconditional, idempotent, removes manifest + the three CA files + invokes `caTrustRemover` when `caWasPresent`.
  - `status()` (`trust.ts:390-408`) — returns `{ installed, trusted, platform, capabilityReasons }`. No path/CA/tooling-text leakage (verified by `trust.test.ts:190-204, 433-460`).
  - **Factory return** (`trust.ts:410`): `{ install, uninstall, status }` (three methods post-PR-#79 collapse; `trust` is now a closure-private helper).

- **Platform defaults — `defaultTrustInstallRoot(platform)` (`trust.ts:170-176`):**
  - darwin → `/Applications/Rogatio`
  - win32 → `process.env.LOCALAPPDATA ?? "" + "/Rogatio"`
  - linux (default) → `process.env.HOME ?? "" + "/.local/share/rogatio"`
  - `hostPath` defaults to `join(installRoot, "runtime-host")` (`trust.ts:228`).

- **Manifest confinement (`trust.ts:93-105`)** — `hostPath` must be absolute AND resolve within `installRoot` (rejects `..`, absolute leaks).

- **`ORIGIN_RE` (`trust.ts:74`)** — `chrome-extension://<32 chars from a-p>/`.

### 2. x509 — `packages/runtime/src/x509.ts`

- **`createCertificate(subject, privateKey, days)` (`x509.ts:7-17`)** — **stub**: returns a hard-coded dummy PEM (`MIIDXTCCAkWgAwIB...` / `MIIEvQIBADAN...`). Does **not** generate a real X.509 cert.
- **`generateCaKeyPair(bits=2048)` (`x509.ts:51-56`)** — real: uses `node:crypto` `generateKeyPairSync("rsa", { modulusLength: bits })`.
- **`signCertificate`/`verifyCertificate`/`importCertificate`/`importPrivateKey`/`exportCertificate` (`x509.ts:22-93`)** — all stubs/throw `"X.509 certificate signing requires @peculiar/x509 or node-forge dependency"` or similar.
- **Implication:** the controller can produce a keypair but `createCertificate` returns a placeholder, so any `caTrustInstaller` is currently called with a dummy cert PEM. Production-real CA generation is out of scope for this feature; the trust installation adapters do not need a real cert to exercise the trust-store path.

### 3. CLI surface — `packages/cli/src/commands/runtime.ts`

- **`makeTrustController()` (`runtime.ts:103-113`)**:
  ```ts
  function makeTrustController() {
    const platform = process.platform;
    const installRoot = defaultTrustInstallRoot(platform);
    return createRequestBodyTrustController({
      platform,
      installRoot,
      hostPath: join(installRoot, "runtime-host"),
      hostName: "com.rogatio.runtime",
      allowedOrigins: [],
    });
  }
  ```
  **No `detectCapabilities`, no `caTrustInstaller`, no `caTrustRemover`** are injected. Result: defaults to the negative `DEFAULT_CAPABILITIES` for every OS.

- **`reportTrust(subcommand, result, okMessage)` (`runtime.ts:115-134`)** — `state === "unsupported"` → `console.error("trust unsupported: <reasons>")` + exit 0; otherwise → exit 1 on failure.

- **`trustRuntimeCommand(args)` (`runtime.ts:136-176`)** — parses `--extension-id`; routes `install`/`uninstall` to the controller; returns 2 on bad args/help.

- **`runtimeCommand` dispatch (`runtime.ts:299-318`)** — top-level router. Top-level help (`packages/cli/src/index.ts:162-197`) lists `install | uninstall | host`. No `trust` or `untrust` (PR-#79 + runtime-uninstall-collapse).

- **CLI entry (`packages/cli/src/index.ts:23-54`)** — unchanged; `runtime` routes to `runtimeCommand`.

### 4. Public runtime surface — `packages/runtime/src/index.ts`

- Exports `* from "./trust.js"` (`index.ts:23`). The factory return already narrows to `{ install, uninstall, status }`. No platform-adapter symbols are exported today.

### 5. Capability detection pattern — `packages/runtime/src/interception.ts`

- **`PlatformInterceptionAdapter` (`interception.ts:137-145`)** — port interface with `platform`, `detect()`, `provisionOrVerifyCa()`, `installPac(script)`, `removePac()`, `startTlsProxy(activation)`, `stopTlsProxy()`.
- **`PlatformCapabilities` (`interception.ts:129-135`)** — extends `CapabilityProfile` (defined at `lifecycle.ts:41`, imported at `interception.ts:1`) with `trustedDeviceLocalCa`, `controllingProxy`, `controllingPac`, `controllingExtension`, `enterprisePolicy`.
- **`createPlatformInterceptionProvider(adapter)` (`interception.ts:169-223`)** — factory that owns `stopped|running|unsupported` state and rolls back on failure. Architectural analog: the trust module should expose a similar factory wrapping a `TrustPlatformAdapter` port.
- **`createUnsupportedPlatformProvider()` (`interception.ts:225-243`)** — explicit "no adapter" sentinel returning `{ supported: false, reasons: ["no-platform-adapter"] }`.
- **`registerInterceptionProvider(provider)` (`interception.ts:37-41`)** — single global registration. The F14 seam exists but `packages/runtime/src/lifecycle.ts` does **not** consume it directly today (the existing capability-detection tests at `trust.test.ts:92-106` similarly avoid the global registration, using direct injection instead). The trust module's adapter does not need a global; the existing `RequestBodyTrustControllerOptions.detectCapabilities` seam (`trust.ts:162-164`) is the per-controller injection point.

### 6. Tests — `packages/runtime/test/trust.test.ts`

- **`capability detection` describe (`trust.test.ts:92-106`)** — asserts `detectTrustCapabilities()` returns the negative default and that even `{ platform: "darwin" }` returns `{ manifest: false }` (locked test that proves capability-based, not OS-name-based). **These tests would need to be updated** if `detectTrustCapabilities` becomes platform-aware (the second test, line 102-105, asserts darwin is unsupported; this is the load-bearing seam for "no OS-name gating").
- **`trust controller lifecycle` describe (`trust.test.ts:108-461`)** — all 18 tests inject `detectCapabilities` and `caTrustInstaller`/`caTrustRemover`. The seam is already proven testable; no architectural change required to add the adapter.
- **`scope and limits` describe (`trust.test.ts:463-491`)** — `defaultTrustInstallRoot("linux")` returns a string containing `"rogatio"`.
- **CLI tests** (`packages/cli/test/runtime-command.test.ts`, `runtime-command-gating.test.ts`, `runtime-install-success.test.ts`, `runtime-uninstall-success.test.ts`) — exercise the install/uninstall dispatch with a mocked controller; the install-success test stubs `createRequestBodyTrustController` to return a fixed-capability controller.

### 7. Architecture — `docs/architecture.md`

- **`## Request-Body Trust Lifecycle` (`docs/architecture.md:335-363`)** — states: "`install`: ... writes the native-messaging host manifest ... then, capability-gated, generates the device-local CA key + certificate ... and invokes the platform-native `caTrustInstaller`". The architecture already calls for `caTrustInstaller` to be "platform-native" — but the platform-specific adapter does not exist.
- **`Capability gate` bullet (`docs/architecture.md:350`)** — "Capability-based, not OS-name-based, mirroring the macOS runtime REQ-008: a non-macOS platform with the required tooling may still install". The trust module's capability gate mirrors the F14 lifecycle seam at `packages/runtime/src/interception.ts` and `packages/runtime/src/lifecycle.ts`.

### 8. F16 spec + plan — `docs/specs/f16-request-body-trust.md`, `docs/plans/f16-request-body-trust.md`

- **Spec REQ-009 (`f16-request-body-trust.md:131-136`)** — `install()` shall write the manifest to the platform's Chrome native-messaging manifest directory. **Wording is darwin-centric** ("the platform's Chrome native-messaging manifest directory"); no per-OS path table.
- **Spec REQ-012 (`f16-request-body-trust.md:144-148`)** — `trust()` shall provision the device-local CA into the OS trust store ... returns `trust.unsupported` and performs no trust-store work.
- **Spec REQ-016/017 (`f16-request-body-trust.md:162-169`)** — `detectTrustCapabilities()` shall report `manifest`/`caTrust` independently. **"Capability-based, not OS-name-based."** The platform adapter is the load-bearing seam.
- **Plan T3 (`f16-request-body-trust.md:24-28`)** — `detectTrustCapabilities({ platform, manifestDir })` is pure, injectable; default returns negative.
- **Plan T4 (`f16-request-body-trust.md:29-40`)** — the controller consumes injectable `caTrustInstaller`/`caTrustRemover` (default no-op). The plan defers "platform-native" installation to a later slice.
- **Frozen spec footers (PR-#79 + runtime-uninstall-collapse)** — the F16 spec has been superseded repeatedly (collapse `install+trust`, collapse `uninstall+untrust`). All those footers remain valid because they describe the verb collapse, not the missing platform adapter.

### 9. Frozen decision records — `docs/decisions/runtime-install-collapse/`, `docs/decisions/runtime-uninstall-collapse/`

- **`runtime-install-collapse/RESEARCH.md` and `PLAN.md`** — confirm the `caTrustInstaller`/`caTrustRemover` injection seams exist precisely so a future slice can plug in a platform-native trust-store adapter without touching the controller. The freeze deliberately defers the adapter.
- **`runtime-uninstall-collapse/RESEARCH.md:113`** — "default capability provider returns `{ manifest: false, caTrust: false, reasons: ['no-capability-provider'] }` and asserting success" is the load-bearing seam for the unified uninstall path. **Replacing the default with a real detector must preserve this seam** (uninstall is unconditional and remains successful against any detector — including a darwin-only one).

### 10. Product overview — `rogatio-overview.md`

- **`rogatio-overview.md:61`** — "Request-body activation is capability-based, excludes private browsing, and cannot compose with another controlling proxy, PAC, extension, or enterprise policy. The runtime activates only where a trusted device-local CA can be provisioned and Chrome PAC routing does not collide with an existing controlling proxy/PAC/extension/enterprise policy; macOS is the reference supported platform and Linux/Windows may also activate when those capabilities are present. Where the capabilities are absent, activation reports `unsupported`."
- **`rogatio-overview.md:35`** — describes `rogatio runtime install` as provisioning "both the native-messaging host and, on capable platforms, the device-local CA".
- **Implication:** the overview already advertises per-OS activation as a real path. Today, the path is gated behind a never-present capability provider, contradicting the overview.

### 11. Tests for the adjacent F14 platform-interception seam — `packages/runtime/test/interception.test.ts`

- `interception.test.ts` (verified at `:3-83`) exercises `createPlatformInterceptionProvider(adapter)` directly via stubbed `PlatformInterceptionAdapter` objects; it does **not** call `registerInterceptionProvider`. The trust module can mirror the same direct-factory pattern (no global registration) without an architectural change to F14 or the lifecycle.

### 12. Cross-platform helpers already present

- **`packages/cli/src/utils/browser.ts`** — uses `node:child_process` `spawn` with platform-specific `xdg-open` (linux), `open` (darwin), `cmd /c start` (win32). Already demonstrates the "per-OS `spawn` adapter" pattern with no new dependencies. Useful prior art for the trust-store adapters.
- **`packages/runtime/src/platform-file.ts`** — uses `process.platform` to compute confining paths. No `child_process`.

### 13. Dependencies and toolchain

- `packages/runtime/package.json` deps: `@rogatio/compiler`, `@rogatio/schema` only (workspace). No `child_process`, no `sudo-prompt`, no platform libs.
- `packages/cli/package.json` deps: `ajv@8.18.0` runtime; `vitest`, `typescript@7.0.2` devDeps. No platform-trust libs.
- **AGENTS.md** ("Repository Rules") mandates "Review new dependencies and install-script permissions before adding them." Adding `sudo-prompt` or any new npm dependency is a non-trivial decision; the plan must justify it or prefer `node:child_process` (already permitted).

---

## External findings

Lean references for the conventional OS trust-store install path. The plan should pick a path; these are not exhaustive tutorials.

- **macOS** — `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <cert>` adds a cert to the system keychain and marks it trusted. Modern macOS may prompt for credentials; `security trust-settings-import` may be required to force the trust setting via XML. Source: [ask different / apple.stackexchange.com 80623](https://apple.stackexchange.com/questions/80623/import-certificates-into-the-system-keychain-via-the-command-line), [ask different 215205](https://apple.stackexchange.com/questions/215205/how-to-add-a-self-signed-root-ca-and-always-trust-it-from-cli-on-osx).
- **Linux** — two families: Debian/Ubuntu (`update-ca-certificates` + drop cert into `/usr/local/share/ca-certificates/*.crt`) and RHEL/Fedora (`update-ca-trust` + drop cert into `/etc/pki/ca-trust/source/anchors/` or `/usr/share/pki/ca-trust-source/anchors/`). Alpine uses `update-ca-certificates` (separate package). Both require root. Alternative modern path: `trust anchor --store <cert>` (p11-kit-based, supported on Arch/Fedora). Source: [Arch Wiki — User:Grawity/Adding_a_trusted_CA_certificate](https://wiki.archlinux.org/title/User:Grawity/Adding_a_trusted_CA_certificate), [Red Hat 8 — Using shared system certificates](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/securing_networks/using-shared-system-certificates_securing-networks), [nixCraft update-ca-certificates examples](https://www.cyberciti.biz/faq/update-ca-certificates-command-examples-in-linux-to-ssl-ca-certificates/).
- **Windows** — `certutil -addstore "Root" "<cert.cer>"` (elevated, LocalMachine) or PowerShell `Import-Certificate -FilePath "<cert.cer>" -CertStoreLocation "Cert:\LocalMachine\Root"`. Requires admin elevation. Per-user: `Cert:\CurrentUser\Root`. Source: [superuser 1506440 — Import certificates using command line on Windows](https://superuser.com/questions/1506440/import-certificates-using-command-line-on-windows), [superuser 1596453 — Import certificate to Trusted Root Authorities for the Current User](https://superuser.com/questions/1596453/import-certificate-to-trusted-root-authorities-for-the-current-user-with-comman), [itechguides Windows 11/10 root-cert management](https://www.itechguides.com/how-to-manage-trusted-root-certificates-in-windows-11-and-windows-10/).

**Chrome-specific note (load-bearing):** Chrome on Linux and Windows uses the **OS** trust store by default (with a per-user/enterprise-policy override possible via the `--ignore-certificate-errors` flag or policy). Chrome on macOS also uses the OS keychain. So adding the cert to the OS store is sufficient for Chrome's TLS interception to trust it. No Chrome-policy or `--proxy-server` work is needed for this feature; that is F15/F17 interception-gate territory.

---

## Constraints and invariants

1. **Capability-based, never OS-name-based.** F16 REQ-016, F14 REQ-008, `docs/architecture.md:350`. The detector must probe for actual tooling presence, not switch on `process.platform`. `trust.test.ts:102-105` explicitly asserts that `detectTrustCapabilities({ platform: "darwin" })` does **not** flip to `manifest: true` based on platform name.
2. **No new npm dependency** for the trust-store adapters. AGENTS.md "Repository Rules" requires dependency review. `node:child_process` is already used in `packages/cli/src/utils/browser.ts:1` for per-OS commands and is sufficient.
3. **Default detector must remain the negative `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }`.** The frozen decision records require it (the negative default is what `trust.test.ts:386-403` asserts against for uninstall behavior). The platform-aware detector runs in production; the negative default runs when no adapter is registered (F14 seam at `interception.ts:225-243`).
4. **`uninstall` remains unconditional and idempotent** (F16 REQ-011, frozen PR-#79 + runtime-uninstall-collapse). The detector may report `caTrust: false` for an uninstall path; the controller ignores the capability check on uninstall. Any new detector must not change this.
5. **`status()` non-leakage** (F16 REQ-019, `trust.test.ts:190-204, 433-460`). Status returns `{ installed, trusted, platform, capabilityReasons }` only — no paths, no CA material, no third-party tooling text. Adapters must propagate their reason strings without leaking `certutil`/`security` output verbatim.
6. **`caTrustInstaller`/`caTrustRemover` callbacks stay optional injection seams.** The trust controller (`trust.ts:165-166, 238-240`) accepts them as `options.caTrustInstaller`/`options.caTrustRemover`; default is `undefined`. If undefined, the controller writes CA material to disk but does not touch the OS trust store (the existing `trust.ts:346-349` guard `if (caTrustInstaller && !installerCalled)`). The plan must keep this seam and the CLI must inject one in production.
7. **CA private key never leaves the install root.** F16 REQ-018. Adapters receive only the cert PEM (`trust.ts:347`). The private key is not exposed to `caTrustInstaller` or `caTrustRemover`.
8. **`install` remains idempotent and transactional.** F16 REQ-010, PR-#79 discipline (`trust.test.ts:304-322` AC-5). The existing rollback order (manifest → CA → installer) and the `installerCalled` flag are load-bearing.
9. **`rogatio runtime` does not gain any new subcommand.** The CLI surface is locked at `install | uninstall | host` per PR-#79 and runtime-uninstall-collapse. The work must inject adapters into the existing `makeTrustController()` (no new flag, no new verb).
10. **`defaultTrustInstallRoot` may need per-OS tweaking for Chrome's native-messaging lookup paths.** Chrome looks for native-messaging manifests in OS-specific directories (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` on macOS, `~/.config/google-chrome/NativeMessagingHosts/` on Linux, `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\<name>` on Windows). The current `defaultTrustInstallRoot` returns a directory where the **runtime-host binary** lives; the manifest path is computed from `manifestDir` (`trust.ts:229, 246`) which defaults to `installRoot`. **The plan must commit to either (a) keeping `installRoot` as the manifest directory on all OSes (Chrome will not find it on Linux/Windows) or (b) introducing per-OS `defaultManifestDir(platform)` parallel to `defaultTrustInstallRoot`.**
11. **Frozen decision-record discipline** (AGENTS.md "Durable Documentation"). Any change to F16 spec/plan requires `> Superseded by:` footers, not edits. The architecture (`docs/architecture.md:335-363`) is live and must be updated to describe the new seam.
12. **Tier selection.** The RPI workflow selects `free` tier (primary `opencode/nemotron-3-ultra-free`, fallback `openrouter/thinkingmachines/inkling-small:free` for brainstorm/spec; `opencode/hy3-free`/`openrouter/dots-studio/dots-3-note-preview:free` for plan/docs) unless the user overrides. Implementation already routed per the locked decisions; research itself runs on the session model.
13. **Worktree is `/home/drmaas/.local/share/opencode/worktree/rogatio/feature-trust-cross-platform-install` (branch `feature/trust-cross-platform-install`).** AGENTS.md worktree convention.

---

## Open questions

1. **Manifest directory per OS** — does the plan introduce `defaultManifestDir(platform)` (Chrome's per-OS native-messaging manifest directory) and route the manifest write there, or keep writing under `installRoot`? On darwin this works because `/Applications/Rogatio` happens to coincide with where the OS looks if Chrome's registry is configured to, but on Linux (`~/.local/share/rogatio`) and Windows (`%LOCALAPPDATA%/Rogatio`) Chrome will not find the manifest unless it is also registered through `update-desktop-database`/`reg add` or the OS-native registry, **or** the directory is the conventional one Chrome scans. The plan must commit to one path. The simplest correct answer: introduce per-OS `defaultManifestDir(platform)` returning the Chrome-native directory on each OS, and write the manifest there (not under `installRoot`). The install root continues to hold the CA material and host binary.
2. **Capability probe coverage** — what tooling does each OS need? Candidates: (a) macOS: `which security` + writability of `/Library/Keychains/System.keychain` (root) or `~/Library/Keychains/login.keychain-db` (user); (b) Linux: `which update-ca-certificates` or `which update-ca-trust` or `which trust`, + writability of the destination directory; (c) Windows: `where certutil` and admin token. The `manifest` capability likewise needs the manifest directory to be writable.
3. **Elevation strategy** — the macOS system-keychain path and the Linux `/usr/local/share/ca-certificates` and Windows `Cert:\LocalMachine\Root` paths require elevated privileges (sudo / Run as administrator). The current `rogatio runtime install` runs as the user; it will fail with `Permission denied` on those paths. Options: (a) document that the user must run with elevation and exit with a clear reason; (b) attempt user-scope first (`~/Library/Keychains/login.keychain-db` on macOS, `~/.local/share/ca-certificates` on Linux, `Cert:\CurrentUser\Root` on Windows) and only attempt system-scope when explicitly elevated. Spec F16 REQ-009 implies "the platform's Chrome native-messaging manifest directory" without scoping user-vs-system — the plan must decide and lock the decision. **The user-store path is sufficient for the extension's own Chrome profile** (Chrome trusts per-user roots when the binary is loaded from a user Chrome install), so the user-scope path is the minimum viable product.
4. **`caTrustInstaller` failure mode when elevated process is required** — if the platform adapter needs elevation but the user did not invoke with it, the adapter must return a clear reason (e.g. `"elevation-required"`, `"keychain-unwritable"`) rather than calling `sudo` itself (F14 discipline: no silent privilege escalation). The plan must commit to the reason vocabulary.
5. **Per-OS implementation files** — should the adapters live in `packages/runtime/src/trust-platform/{darwin,linux,win32,unsupported}.ts` (new subdirectory) or as inline conditional dispatch in `packages/runtime/src/trust.ts`? The first mirrors `createPlatformInterceptionProvider` and keeps `trust.ts` focused on the seam; the second keeps the file count low. The plan should pick one.
6. **Detector registration** — should `detectTrustCapabilities()` auto-load the platform adapter via `createPlatformInterceptionProvider`-style registration, or should `makeTrustController()` in the CLI explicitly choose the adapter based on `process.platform`? The auto-registration pattern (mirror F14's `registerInterceptionProvider`) preserves capability-based semantics and keeps the detector pure-and-default. The CLI-chooses pattern keeps the runtime package Node-only with zero auto side effects. **The first is consistent with F14; the second matches the current `process.platform` reads in `trust.ts:170-176`.** Plan must commit.
7. **Frozen-doc footers required** — the F16 spec/plan/workflow are frozen. Any change to platform coverage language in those documents requires appending `> Superseded by: feature/trust-cross-platform-install` footers at the affected lines. Live-doc files (`docs/architecture.md:335-363`, `rogatio-overview.md`, `README.md`, `packages/cli/README.md`, `packages/docs-site/src/content/docs/...`) must be updated to describe the new behavior. The plan should enumerate which lines need footers.
8. **Test for `trust.test.ts:102-105`** — the test asserts `detectTrustCapabilities({ platform: "darwin" })` returns `{ manifest: false }` (capability-not-OS). With a real platform adapter that probes tooling, this test must either (a) keep its current semantics by injecting the negative default detector and bypass the auto-loader, or (b) be moved to a context where the negative default is explicitly requested. The plan must commit to the test's new shape.
9. **Cross-OS CI coverage** — CI runs on Linux (`docs/workflows/f1-workflow.md`). A macOS/Windows adapter cannot be exercised in CI today; the plan should commit to (a) keep the adapter pure-and-testable so CI tests its capability detection on Linux with stubbed `which`, or (b) defer the actual `child_process` invocation to a future Playwright/browser-tier test. The first is the minimum.

---

## Pre-existing load-bearing seams the plan must preserve

- `RequestBodyTrustControllerOptions.detectCapabilities` (`trust.ts:162-164`) — injection seam. The plan adds a **default** platform-aware implementation behind the existing seam, not a replacement seam.
- `caTrustInstaller`/`caTrustRemover` (`trust.ts:165-166`) — injection seams. The plan populates them in `makeTrustController()` per OS, not in the factory.
- `installerCalled` flag (`trust.ts:247`) — closure-private; idempotency relies on it. No changes.
- `runCaTrust()` (`trust.ts:321-350`) — closure-private CA-write + installer invocation. No changes.
- `writeFileAtomic` (`trust.ts:192-198`) — atomic manifest + CA write. No changes.
- `defaultTrustInstallRoot(platform)` (`trust.ts:170-176`) — currently the only OS-conditional logic. The plan extends the pattern, not the function (or adds a sibling `defaultManifestDir`).
- `reportTrust` literals (`runtime.ts:125-134`) — `"trust unsupported: "` and the unsupported exit code 0 are locked by F16 REQ-019 and frozen PRs.

---

## Notable no-change zones

- `packages/runtime/src/capability.ts` — different "capability" (runtime capability tokens, `pairCapability`/`findSession`/`closeCapabilityState`); not the platform-trust capability. **No change.**
- `packages/runtime/src/x509.ts` — `createCertificate` is a stub; **out of scope** for this feature. The plan does not fix the stub.
- `packages/runtime/src/interception.ts` — F14 interception gate (TLS proxy/PAC); **out of scope** for this feature.
- `packages/runtime/src/lifecycle.ts` — F14 process lifecycle; **out of scope**.
- `packages/runtime/src/pac.ts`, `proxy.ts`, `tls.ts` — F15/F17; **out of scope**.
- `packages/runtime/src/host.ts`, `envelope.ts` — F14 native-messaging host process; **out of scope**.
- `packages/cli/test/runtime-install-success.test.ts` — mocks the entire controller; the install success path it covers is not affected by adding platform adapters (it stubs the controller before the CLI ever sees it).