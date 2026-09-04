# Spec: Remove `rogatio runtime activate|deactivate|status`

## Problem

`rogatio runtime activate`, `rogatio runtime deactivate`, and `rogatio runtime
status` are pure ceremony. They run an empty-preset `NativeRuntimeController`
that has nothing to do with the actual session the extension drives through
`startNativeSession` / `stopNativeSession` over the native-messaging host.

- `runtime activate` calls `controller.start()` on an empty preset and prints
  "runtime activated". It does not start the host, does not register the host
  manifest, and does not contact the extension.
- `runtime deactivate` calls `controller.stop()` on the same empty preset and
  prints "runtime stopped". It does not stop any actual session.
- `runtime status` reads the empty preset's lifecycle state and prints
  `runtime idle` / `runtime stopped` / `runtime unsupported` plus a trust
  status. It never reflects the actual session because the empty preset
  carries no matchers, grants, or mocks.

The real "start the host" path is the extension's Start/Stop buttons, which
speak to the *installed* native-messaging host over stdio. Mocks and
response-body rules work as soon as Chrome can find the host. Request-body
rules additionally require the device-local CA to be trusted, but that is a
trust concern, not a lifecycle concern.

## Goal

Make the lifecycle surface match reality:

- The only legitimate way to start or stop the runtime is from the extension.
- The CLI must not pretend to control the lifecycle. `activate`, `deactivate`,
  and `status` are removed.
- The native-messaging host, the trust lifecycle (`install|trust|untrust|uninstall`),
  and `host [path]` stay — they are real.
- Extension messaging must stop implying that Start/Stop depends on
  install/trust. It does not for mocks or response-body. Request-body has its
  own failure mode that needs its own diagnostic, not the generic
  "extension.native-host-missing" path.

## Non-goals

- We are not removing `rogatio runtime install|trust|untrust|uninstall`. The
  request-body trust lifecycle is real and capability-gated, even though it
  reports `unsupported` on most platforms today.

> Superseded by: feat/collapse-runtime-install-and-trust
- We are not removing `rogatio runtime host`. It is the entry point the
  browser launches via the native-messaging manifest.
- We are not changing the wire protocol. The frame enum still uses
  `runtime.start` / `runtime.stop` / `runtime.status`; the dead
  `NativeFrameType.RuntimeActivate` enum member is removed.
- We are not adding a real CLI replacement for activate/deactivate. The
  extension's Start/Stop controls are the replacement; we just stop pretending
  the CLI surface existed.

## Behavior

### CLI

- `rogatio runtime activate` → `Error: unknown runtime subcommand: activate`,
  exit code 2, prints the runtime help.
- `rogatio runtime deactivate` → same as above.
- `rogatio runtime status` → same as above. (Trust status moves into the
  `rogatio runtime install` / `trust` flow as needed; we do not add a new
  dedicated subcommand.)
- `rogatio runtime install|trust|untrust|uninstall` → unchanged.

> Superseded by: feat/collapse-runtime-install-and-trust
- `rogatio runtime host [path]` → unchanged.
- `rogatio runtime` (no subcommand) and `rogatio runtime --help` → updated
  help text. No more "Native runtime commands" section.
- `rogatio --help` and the runtime help table in `index.ts` no longer mention
  activate/deactivate/status.

### Extension

- Start and Stop are always clickable from the extension management page.
- When start fails with `extension.native-host-missing`, the message is:
  "The native-messaging host isn't registered with the browser. Run
  `rogatio runtime install --extension-id <id>` once in a terminal, then
  click Start again." This is unchanged for the *host* case; the wording
  already says it. We do not add "Start/Stop depends on trust" framing.
- When start fails with the new `extension.request-body-needs-trust` reason
  (added by this change), the message is:
  "Request-body rules need the device-local CA trusted. Run
  `rogatio runtime trust` in a terminal, then click Start again." This
  message is only rendered when the active project actually has request-body
  rules; otherwise the generic install hint is enough.

> Superseded by: feat/collapse-runtime-install-and-trust
- The trust diagnostic is emitted by `service-worker.ts` when
  `startNativeSession` returns ok but the host reports a trust-required
  condition. We classify this from the existing `sessionResult.reason`
  string. The session-start service-worker already gets a `reason` field; we
  add a new value and the diagnostics module maps it to a user-visible
  message.

### Documentation

- `README.md`, `rogatio-overview.md`, `samples/basic/README.md`,
  `packages/cli/README.md`, and the docs site all drop `activate`,
  `deactivate`, and `status`. Where they describe the user workflow they say
  "use the extension's Start/Stop controls".
- `samples/basic/README.md` step 6 is reordered: the install step happens
  before "Start the runtime from the extension". The previous ordering
  implied you could start the runtime first.
- `rogatio-overview.md` is a frozen source-of-truth document; the change is
  authorized by the user and recorded as a `> Superseded by:` footer where
  applicable. The overview describes the now-removed subcommands, so it
  needs editing in place. (The user explicitly authorized this.)

## Decision record on the prior rename

Commit `5fbde2e refactor(cli): rename runtime start/stop to activate/deactivate
(#49)` and the follow-up `f3b2232 docs!: reconcile docs with breaking runtime
activate/deactivate CLI rename` introduced the activate/deactivate surface.
This change reverses part of that rename by removing activate/deactivate
entirely. The reversal is recorded in `docs/decisions/.../workflow.md` and
the frozen record at `docs/specs/runtime-lifecycle-cli-rename.md` (when that
shipped) is annotated with a `> Superseded by:` footer.

The wire-level `runtime.start` / `runtime.stop` / `runtime.status` envelope
opcodes are not renamed; the change only removes the CLI surface that was
never wired to those envelopes.

## Acceptance criteria

- `pnpm validate` is green on the feature branch.
- `rogatio runtime activate` / `deactivate` / `status` exit 2 with the
  unknown-subcommand error.
- `rogatio runtime install|trust|untrust|uninstall|host` continue to work
  (including their `unsupported` reports on gated platforms).

> Superseded by: feat/collapse-runtime-install-and-trust
- `rogatio --help` and `rogatio runtime --help` no longer mention
  activate/deactivate/status.
- The extension management page shows the request-body-needs-trust message
  when start fails for a project with request-body rules and no trust.
- No new tests are required for the extension UI render path; the
  status-level reason mapping test is added in
  `packages/extension/test/status.test.ts`.
- All user-facing docs (README, samples/basic, packages/cli, docs-site)
  drop the removed subcommands.
