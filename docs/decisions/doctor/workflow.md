# `rogatio doctor` — workflow

> Issue: #264
> Spec: [spec.md](./spec.md)
> Plan: [plan.md](./plan.md)

## Log

1. Read issue #264, the merged stable-extension-id work (#263), and the bug form from #259.
2. Treated the owner's request to implement the labeled `sdlc: sdd` issue as spec approval. Wrote `spec.md` (checks, order, JSON, exit codes) and this plan before the command landed.
3. Implemented the shared runner in `@rogatio/runtime`, the CLI command, the `runtime.doctor` envelope, and **Run checks** on the popup, sidebar, and dashboard.
4. Locked each failure mode's fix string with a unit test. `--json` key order is asserted. The doctor reply test checks that a project `body` is not echoed.
5. Updated the README, the CLI README, `docs/architecture.md`, the docs site, the bug form, and CONTRIBUTING.
6. CLI install and verify tests mock `createInstalledTrustController`, the shared wiring `rogatio runtime` and doctor both use. Mocking the lower trust factories no longer intercepts that path.
7. `pnpm validate` passed on this branch (format, lint, typecheck, build, unit tests, and browser smoke). The pull request stays a draft until the GitHub checks on the latest head are green.
