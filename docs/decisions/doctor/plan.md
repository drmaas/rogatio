# `rogatio doctor` — plan

> Status: approved with the implementation (issue #264)
> Spec: [spec.md](./spec.md)

## Approach

Put the check runner in `@rogatio/runtime` so the CLI and the native host call one function. The extension only sends `runtime.doctor` and renders the report. That keeps the extension off the runtime package, which the dependency direction forbids.

Reuse, rather than re-describe:

- Project validation is the verify sequence (`diagnoseProjectData`: schema, then compiler). `rogatio verify` calls it.
- Host manifest and `allowed_origins` use `createInstalledTrustController().verify()` and `extensionOriginListed` / `extensionIdInstallCommand` from the stable extension id (#263).
- The CA signal is that same `verify().caTrusted`.
- AI reachability is the Hello completion from `rogatio ai test`, with the error text dropped.
- The PAC check uses `generatePacScript` and a loopback GET. It does not install a Chrome PAC.

## Tasks

1. Spec, this plan, and the workflow log.
2. `runDoctor` plus fix strings, human lines, and `--json`.
3. `rogatio doctor` argument parsing and help.
4. `runtime.doctor` on the host, answered before the session controller.
5. Extension `run-doctor`, **Run checks** on the sidebar, dashboard runtime block, and popup.
6. Unit tests for each failure mode's fix text, the JSON key order, and the envelope not echoing the project.
7. README, CLI README, architecture, docs site, bug form, and CONTRIBUTING.

## Risks

- `verify().caTrusted` is file presence, which is what `rogatio runtime verify` already reports. A second OS-store probe would be a new platform behavior and is out of scope.
- Run checks opens the native port when the runtime phase is still stopped. It does not send `runtime.start`, so it does not install a PAC into Chrome.
- A project with a `body` field must be allowed on the doctor request, the same exemption `runtime.project.set` has. The reply is built from the report fields only.
