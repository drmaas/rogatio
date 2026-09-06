# CHECKLIST — trust-cross-platform-install

Implementer ticks tasks as it completes them. The implementation-review subagent reads this file to see what was actually done.

## Phase 1 — Adapter scaffolding

- [ ] 1.1 Create `packages/runtime/src/trust-platform/` directory and `index.ts` exporting `selectTrustPlatformAdapter(platform: TrustPlatform): TrustPlatformAdapter`.
- [ ] 1.2 Create `packages/runtime/src/trust-platform/types.ts` with `TrustPlatformAdapter` interface (`platform`, `defaultManifestDir()`, `defaultCaInstallPath()`, `detect()`, `caTrustInstaller()`, `caTrustRemover()`).
- [ ] 1.3 Create `packages/runtime/src/trust-platform/unsupported.ts` exporting an adapter that returns `{ manifest: false, caTrust: false, reasons: ["no-capability-provider"] }` from `detect()` and throws `TrustError("trust.internal", "unsupported-platform", ["no-capability-provider"])` from installer/remover. Path getters return `""`.
- [ ] 1.4 Create stub `packages/runtime/src/trust-platform/darwin.ts`, `linux.ts`, `win32.ts` exporting `TrustPlatformAdapter` objects whose `detect()` returns `{ manifest: false, caTrust: false, reasons: ["tooling-missing"] }` and whose install/remover callbacks throw `TrustError("trust.internal", "not-implemented", ["tooling-missing"])`. Path getters return `""` (implemented in Phase 2).
- [ ] 1.5 Add `packages/runtime/test/trust-platform/selector.test.ts` asserting: `selectTrustPlatformAdapter("darwin" | "linux" | "win32")` returns the matching adapter (by `.platform`), `selectTrustPlatformAdapter("freebsd")` returns the `unsupported` adapter, `selectTrustPlatformAdapter(process.platform)` selects correctly.
- [ ] 1.6 **Add `@peculiar/x509` to `packages/runtime/package.json`** and run `pnpm install` in the worktree. Update `packages/runtime/src/x509.ts` to use `@peculiar/x509` for real `createCertificate` (self-signed CA with Basic Constraints) and `signCertificate` (leaf cert signing). Remove stub implementations. Add test `packages/runtime/test/x509.test.ts` asserting `createCertificate` returns valid PEM with `BEGIN CERTIFICATE` and `signCertificate` returns a leaf cert PEM.

## Phase 2 — Default manifest directory + default CA path

- [ ] 2.1 Implement `darwin.ts` `defaultManifestDir()`: `join(process.env.HOME ?? "", "Library/Application Support/Google/Chrome/NativeMessagingHosts")`. `defaultCaInstallPath()`: `join(process.env.HOME ?? "", "Library/Keychains/login.keychain-db")`.
- [ ] 2.2 Implement `linux.ts` `defaultManifestDir()`: `join(process.env.HOME ?? "", ".config/google-chrome/NativeMessagingHosts")`. `defaultCaInstallPath()`: `join(process.env.HOME ?? "", ".local/share/ca-certificates")`.
- [ ] 2.3 Implement `win32.ts` `defaultManifestDir()`: `join(process.env.APPDATA ?? "", "Google", "Chrome", "NativeMessagingHosts")`. `defaultCaInstallPath()`: `"Cert:\\CurrentUser\\Root"`.
- [ ] 2.4 Add `packages/runtime/test/trust-platform/paths.test.ts` asserting each path table with stubbed env (`HOME`/`APPDATA`); cross-platform runnable on Linux CI by stubbing `process.env` via `vi.stubEnv`.

## Phase 3 — Capability detection

- [ ] 3.1 Implement `darwin.ts` `detect()`: probe `spawnSync("which", ["security"])`; check `accessSync(defaultManifestDir(), W_OK)`; check `accessSync(dirname(defaultCaInstallPath()), W_OK)` (login keychain dir). Reasons vocabulary: `["tooling-missing", "manifest-dir-unwritable", "keychain-unwritable"]`.
- [ ] 3.2 Implement `linux.ts` `detect()`: probe `spawnSync("which", ["update-ca-certificates"])`; check `accessSync(defaultManifestDir(), W_OK)`; check `accessSync(defaultCaInstallPath(), W_OK)`. Reasons vocabulary: `["tooling-missing", "manifest-dir-unwritable", "ca-store-unwritable"]`.
- [ ] 3.3 Implement `win32.ts` `detect()`: probe `spawnSync("where", ["certutil"])`; check `accessSync(defaultManifestDir(), W_OK)`. **No CA store writability probe** — `Cert:\CurrentUser\Root` is not a filesystem path. `caTrust` capability = `certutil` presence only. Reasons vocabulary: `["tooling-missing", "manifest-dir-unwritable"]`.
- [ ] 3.4 Add `packages/runtime/test/trust-platform/detect.test.ts` stubbing `spawnSync` and `accessSync` via vitest module mocks, asserting the full boolean+reasons matrix: tooling present + dirs writable → `{ manifest: true, caTrust: true, reasons: [] }`; tooling missing → `["tooling-missing"]`; manifest dir unwritable → `["manifest-dir-unwritable"]`; combination → sorted, de-duplicated. Confirm: a darwin detector with stubbed missing `security` returns `manifest: false, caTrust: false` (capability-based, not OS-name-based). Assert locked vocabulary only.

## Phase 4a — CA installer / remover: darwin

- [ ] 4a.1 Implement `darwin.ts` `caTrustInstaller(cert)`: write cert to tmp file under `os.tmpdir()`, then `spawn("security", ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", defaultCaInstallPath(), tmpPath])`. `caTrustRemover()`: `spawn("security", ["delete-certificate", "-c", "CN=Rogatio Request-Body CA", defaultCaInstallPath()])`. Idempotent: both ignore "already present" / "not found" exit codes.
- [ ] 4a.2 Non-zero exit codes throw `TrustError("trust.internal", "<short reason>", ["keychain-unwritable" | "elevation-required" | "tooling-missing"])`. Error message **must not** contain stderr, cert paths, or `security:` output.
- [ ] 4a.3 Add `packages/runtime/test/trust-platform/darwin-install-remove.test.ts` stubbing `spawn` via `vi.spyOn(node:child_process, "spawn")`, asserting argv form, idempotency (second call returns success), throw-on-non-zero-exit behavior, and vocabulary compliance.

## Phase 4b — CA installer / remover: linux

- [ ] 4b.1 Implement `linux.ts` `caTrustInstaller(cert)`: `mkdir -p` the ca dir, write cert to `join(defaultCaInstallPath(), "rogatio-ca.crt")`, then `spawn("update-ca-certificates")`. `caTrustRemover()`: `rm` the cert file, then `spawn("update-ca-certificates")`.
- [ ] 4b.2 Non-zero exit codes throw `TrustError("trust.internal", "<short reason>", ["ca-store-unwritable" | "tooling-missing"])`. Error message hygiene as above.
- [ ] 4b.3 Add `packages/runtime/test/trust-platform/linux-install-remove.test.ts` stubbing `spawn`, asserting argv, idempotency, vocabulary.

## Phase 4c — CA installer / remover: win32

- [ ] 4c.1 Implement `win32.ts` `caTrustInstaller(cert)`: write cert to tmp file under `os.tmpdir()`, then `spawn("certutil", ["-addstore", "-f", "Root", tmpPath])`. `caTrustRemover()`: `spawn("certutil", ["-delstore", "Root", "CN=Rogatio Request-Body CA"])`.
- [ ] 4c.2 Non-zero exit codes throw `TrustError("trust.internal", "<short reason>", ["elevation-required" | "tooling-missing"])`. Error message hygiene as above.
- [ ] 4c.3 Add `packages/runtime/test/trust-platform/win32-install-remove.test.ts` stubbing `spawn`, asserting argv, idempotency, vocabulary.

## Phase 5 — CLI wiring + frozen-doc footers + live-doc sync

- [ ] 5.1 Update `packages/cli/src/commands/runtime.ts:103-113` (`makeTrustController()`) to import `selectTrustPlatformAdapter`, build the adapter from `process.platform`, and inject `manifestDir`, `detectCapabilities`, `caTrustInstaller`, `caTrustRemover` per the architecture section.
- [ ] 5.2 Append `> Superseded by: feature/trust-cross-platform-install` footers at:
  - `docs/specs/f16-request-body-trust.md:131-136` (REQ-009 wording)
  - `docs/specs/f16-request-body-trust.md:144-148` (REQ-012)
  - `docs/plans/f16-request-body-trust.md:24-28` (T3 detector seam)
  - `docs/specs/f16-request-body-trust.md:23-26` — confirm no further footers needed (collapse footers already present)
- [ ] 5.3 Update `docs/architecture.md:335-363` to describe the per-OS `trust-platform/` directory, the `selectTrustPlatformAdapter` selector, the user-scope CA store default, and the capability-based detector.
- [ ] 5.4 Update `rogatio-overview.md:61` to clarify: user-scope install is the default; system-scope is a future slice; on linux/win32 the user-scope path is `~/.local/share/ca-certificates` / `Cert:\CurrentUser\Root`; on macOS it is the login keychain.
- [ ] 5.5 Confirm `packages/docs-site/src/content/docs/...` does **not** currently describe the install path. If it does, update the matching page; otherwise leave untouched (and record "no doc-site change" in `workflow.md`).
- [ ] 5.6 **Update `reportTrust()` in `packages/cli/src/commands/runtime.ts:115-134` to append platform-specific remediation hints after `trust unsupported: <reasons>` when `state === "unsupported"`**. Hints per reason: `tooling-missing` → install required tooling; `manifest-dir-unwritable` → check Chrome manifest dir permissions; `keychain-unwritable` → keychain access; `ca-store-unwritable` → ca-certificates dir permissions; `elevation-required` → run elevated (future slice). Exit code remains 0.
- [ ] 5.7 Run the four CLI runtime tests: `pnpm --filter @rogatio/cli test`; confirm `runtime-install-success`, `runtime-uninstall-success`, `runtime-command`, `runtime-command-gating` all pass without test changes.

## Phase 6 — Verification + review

- [ ] 6.1 Run `pnpm validate` end-to-end; capture evidence into `docs/rpi/trust-cross-platform-install/workflow.md` (canonical pre-commit/CI gate: biome, typecheck, build, vitest, build-manifest assertion).
- [ ] 6.2 Run `pnpm test` for `packages/runtime` and `packages/cli`; capture the test counts (18 trust lifecycle + selector + paths + detect + 3× install-remove + 4 CLI runtime).
- [ ] 6.3 Spawn the independent review subagent (verification role from `rpi/SKILL.md`); capture review verdict and resolution notes in `workflow.md`.
- [ ] 6.4 Final audit per AGENTS.md "Worktree Convention": `git status`, `git diff --stat`, untracked-file scan for secrets, generated output, and unrelated changes. Record evidence in `workflow.md`.