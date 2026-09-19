# 0010. Fill DNR install diagnostics without adapter change

## Context

`RuleInstallerAdapter.install` already returns `{ ok: true } | { ok: false, diagnostics: CoreDiagnostic[] }`. Redirect/query returns `never[]` and treats any successful add as `ok: true`. Headers overlay `extension.dnr-error` with Chrome’s message in `params.reason`. `InstallService` rolls back when `install` returns `ok: false`. Widening `CoreDiagnosticCode` or the adapter signature is out of scope.

## Decision

Do not change `RuleInstallerAdapter` or `InstallResult`. Do not add diagnostic codes.

On total failure (no desired DNR rule remains installed), return `{ ok: false, diagnostics }` with a stable core code (`core.install-failed` is enough) and Chrome’s reason in `params` when Chrome provides one.

On partial success, keep `{ ok: true }`. Do not flip `ok: false` (rollback risk). Surface per-rule Chrome reasons through the existing Workspace overlay: prefer `extension.dnr-error` and show `params.reason`. Generalize the header overlay to redirect and query. `projectState` must read the install attempt’s reasons; it must not ignore them.

## Consequences

- Workspace can show a real Chrome reason for every DNR kind.
- No public adapter / core-code / status-formula change.
- Partial installs stay installed; failed siblings show `extension.dnr-error`.
- Attention copy is not a diagnostic API. Automatic reconcile first; do not bake unproven “reload the extension” text.
