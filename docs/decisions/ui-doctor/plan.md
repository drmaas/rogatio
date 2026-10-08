# In-UI doctor checks — plan

> Status: approved with the implementation (issue #319).
> Spec: [spec.md](./spec.md)

## Order

1. Lock ids, summaries, fixes, the combined JSON, redaction, and the permission audit in `spec.md`.
2. Add a pure extension report builder. The service worker gathers Chrome facts and the host reply. The popup and the management page only render.
3. Return `cliVersion` beside `report` when it is exactly `major.minor.patch`.
4. Add the editor report builder and `POST /api/doctor`. The page handles a dead server and a stale CSRF token locally.
5. Point **Copy diagnostics** at the combined JSON. Widen the bug form. Update the README, architecture note, and docs-site guides.
6. Prove the strings, the four native failures, the proxy cases, tab redaction, CSRF, and byte-identical `host` with unit tests. Run `pnpm validate`.

## Boundaries

- `@rogatio/runtime` grows one exported version guard and the additive reply field. Check ids and `serializeDoctorReport` stay put.
- `@rogatio/extension` owns classification, proxy, access, rules, incognito, and the popup tab dry-run. It does not import runtime.
- `@rogatio/cli` owns the editor checks and the route. The editor package is not modified.
- Page bundles keep dry-run and Ajv out. The service worker already hosts dry-run.

## Risks

- A host reply that is not the six-check report must not be rendered as the old one-line fallback.
- Shell fixes must go through `runtimeInstallCommand`, `quoteDoctorArg`, or the exact version grammar. Editor `edit` and `verify` fixes quote for the server platform; the host report stays on `quoteDoctorArg`.
- `projectState` installs DNR rules. The rules check uses the read-only status helper instead.
