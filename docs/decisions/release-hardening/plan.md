> Status: draft

# PLAN: release-hardening

Issue: [#260](https://github.com/drmaas/rogatio/issues/260).

## Outcome

A push to `main` publishes only after `Repository checks` succeeds for that exact commit. `@rogatio/cli` publishes from `.github/workflows/release.yml` with npm trusted publishing (OIDC) and provenance. The GitHub Release carries `rogatio-extension.zip`, `rogatio-extension.zip.sha256` (`sha256sum` format), and a build-provenance attestation for the ZIP. Third-party actions in every workflow are pinned to full commit SHAs.

## Behavior

1. `release.yml` triggers on `workflow_run` of the workflow named `Repository checks`, type `completed`. The release job runs only when `conclusion == success`, `head_branch == main`, and `event == push`. Pull-request, schedule, and `workflow_dispatch` runs of checks do not publish.
2. The job checks out `github.event.workflow_run.head_sha` and runs `git checkout -B main` on that commit so semantic-release's local HEAD and `main` branch match the verified commit. `GITHUB_SHA` and `GITHUB_REF` on the release step are set to that commit and `refs/heads/main`. If `main` has moved on, semantic-release sees the branch is behind and does not publish; the newer commit's own checks run releases it.
3. `workflow_dispatch` stays, always passes `--dry-run`, and checks out the dispatched ref. It does not publish, upload assets, or attest.
4. Job token: `contents: write`, `issues: write`, `pull-requests: write`, `id-token: write`, `attestations: write`. Workflow default is `contents: read`. The job does not set `NPM_TOKEN` or `NODE_AUTH_TOKEN`, and `actions/setup-node` does not set `registry-url`.
5. The job installs Node `26.11.1` (above the trusted-publishing floor of 22.14) and `npm@11.21.0` (above 11.5.1). `@semantic-release/npm` 13.1.5 (already pulled in by `semantic-release` 25.0.9) treats a successful OIDC exchange as auth. `npm publish` from that CLI performs the trusted publish. `packages/cli` sets `publishConfig.provenance: true`, and the release step sets `NPM_CONFIG_PROVENANCE=true`.
6. The extension prepare plugin writes `rogatio-extension.zip.sha256` beside the ZIP. `@semantic-release/github` uploads both. `actions/attest-build-provenance` then attests the ZIP when that file exists after a real release. The attestation step is after publish because the ZIP is version-stamped inside semantic-release's prepare phase. If attestation fails, the job fails after the GitHub Release exists; semantic-release will not publish that version again, so the attestation has to be repaired separately.
7. Every third-party action in `checks.yml`, `release.yml`, and `deploy-site.yml` is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment. `.github/dependabot.yml` watches the npm ecosystem only, so those comments are the pin record and are not bumped by Dependabot.
8. The concurrency group `release` is shared only by a successful `push` to `main`, with `cancel-in-progress: false`. It is not per SHA, so two publishes do not run at once. GitHub keeps one pending run in that group; a newer successful `main` push replaces a still-pending publish, and semantic-release publishes that newer commit. Every other run uses `github.run_id`, so a pull-request, schedule, or failed checks completion cannot cancel a queued main publish. `workflow_dispatch` has no `workflow_run` payload, so its group expression is false and the dry run uses `github.run_id`. A dry run does not join or cancel the publish queue.

## Manual steps

The trusted publisher for `@rogatio/cli` is configured for GitHub Actions: organization or user `drmaas`, repository `rogatio`, workflow filename `release.yml`, no environment. `npm publish` stays in `.github/workflows/release.yml` on the `release` job (`id-token: write`, npm CLI `11.21.0`). That filename is what the publisher is bound to.

Remaining step, after the first successful OIDC release: delete the `NPM_TOKEN` repository secret (GitHub → Settings → Secrets and variables → Actions → `NPM_TOKEN`).

A new trusted publisher must complete its first successful `npm publish` within 2 days of being created or it expires. This change is a `ci:` commit, so merging it does not itself cut a release. The first validating publish is the next release-cutting merge (`feat`, `fix`, or `perf`) after this workflow is on `main`. `workflow_dispatch` is a dry run and does not count as that publish.

npm's recommended follow-up, once that publish is visible on the package page with provenance: package Settings → Publishing access → "Require two-factor authentication and disallow tokens". Trusted publishers keep working. Do this only after the OIDC publish has succeeded.

## Out of scope

- Changing semantic-release's version rules or adding `@semantic-release/git`.
- A release environment, npm staged publishing, or dist-tag OIDC permission (the `main` release passes `--tag` to `npm publish`).
- Editing frozen F20 release records.
