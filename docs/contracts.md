# Contracts

Audience: hybrid. One file for every contract between Rogatio layers and
subsystems. Each section is a pointer, not a copy. The code and the tooling it
names stay the source of truth.

## Mock rule

- **Parties:** `@rogatio/schema` ↔ `@rogatio/compiler` ↔ `@rogatio/editor`,
  `@rogatio/dry-run`, `@rogatio/extension`, `@rogatio/runtime`, `@rogatio/cli`.
- **Surface:**
  - Project document: `rule.type: "mock"` and `rule.mock` (`MockAction`) in the
    version-2 `.rogatio.json` envelope.
  - Compiler output: `MockOperation` in the `RogatioOperation` union.
  - Preview: `ActionPreview` with `kind: "mock"`, shared by `rogatio test`,
    `POST /api/dry-run`, and the extension `dry-run` command.
  - Native protocol: optional `fileRoot` and bounded `enabledGroupIds` on
    `runtime.project.set`; existing `contentListener` and `proxy` fields on
    `runtime.start`; internal `mock.connect` token exchange after start; stable
    per-rule file error codes on `runtime.status`.
  - Loopback listener:
    `/.rogatio/mock/<token>/<digest>` on the host's intercept listener. It
    accepts each method allowed by its rule.
  - Browser: a session declarativeNetRequest redirect in the mock ID band, plus
    one higher-priority session allow rule that guards against recursion.
  - Local storage: optional root on the extension project record; CLI
    device-local config keyed by canonical project path. Neither enters project
    export data.
- **Invariants:**
  - A mock carries exactly one body source: inline `body` or local `file`.
    Never both, never neither.
  - A mock never contacts the original upstream destination.
  - File bodies may be arbitrary bytes. UTF-8 is not required and is never
    assumed.
  - Every file read is confined to the project's saved root, re-read per
    request, descriptor-based, and size-bounded. Deny the read when confinement
    cannot be proved. Never use the process working directory.
  - No diagnostic, status, log line, or HTTP failure body contains a logical or
    absolute path.
  - A mock serves the methods its rule filter allows. No filter means all
    methods. `HEAD` applies delay and file-read behavior, preserves full-body
    `Content-Length`, and sends no body.
  - Mocks serve only while the unified native runtime host is running. Session
    rules and the recursion guard are installed after start and removed on stop
    or disconnect.
  - Rendered response bytes and file bytes never cross native messaging.
    Authored inline text may cross only as bounded project config.
  - A route requires both a fresh per-session token and the active preset
    digest. Rule ids and digests alone grant no access.
  - The host mints tokens only for mocks in enabled groups.
  - The browser-safe validator mirror produces the same diagnostics as
    `@rogatio/schema` for the same input.
  - The canonical preset digest covers mock config and excludes minted per-rule
    values.
  - Request-time errors are memory-only stable codes. A later successful read,
    project save, or host restart clears them.
- **Tooling:**
  - Shape of truth: `packages/schema/src/schema.ts` and
    `packages/schema/src/limits.ts`.
  - Contract test: `packages/schema/test/mock-contract.test.ts` pins the public
    mock shape.
  - Dry-run contract test pins the mock preview summary rules.
  - Mirror parity test in `packages/extension/test/` compares the browser-safe
    validator against `@rogatio/schema`.
  - Real Chrome journey in `test/browser/` proves method-preserving DNR
    redirects, including `POST`, and loopback recursion protection.
- **Owners:** schema and compiler maintainers for the shape; runtime maintainers
  for serving and confinement; extension maintainers for DNR projection and rule
  status.
