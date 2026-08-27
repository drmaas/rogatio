# F20 — Release pipeline (workflow)

**Feature:** F20
**Packages:** root (workflows, config), `packages/cli`, `packages/extension`, `scripts`
**Depends on:** F1 (tooling), finalized after all features
**Tier:** not applicable (CI/config only)

## What shipped

- `.github/workflows/release.yml` — semantic-release on merge to `main`.
- `.github/workflows/deploy-site.yml` — GitHub Pages deploy on merge to `main`.
- `.releaserc.json` — semantic-release plugin chain.
- `scripts/release-extension-plugin.mjs` — stamps extension version + zips dist.
- `packages/cli/package.json` — `private:false`, `publishConfig.access:public`, `files`,
  `repository`/`bugs`/`homepage`.
- `package.json` — `semantic-release` + `@semantic-release/changelog` devDeps, `release`
  script.
- Docs: README release section, `docs/plans/f20-release-pipeline.md`, install guide
  (public npm).

## AC mapping

- AC-001 CLI published to npm on release → `@semantic-release/npm` (pkgRoot cli).
- AC-002 Extension ZIP attached to GitHub Release → local plugin + `@semantic-release/github`.
- AC-003 Consistent CLI/extension/git-tag version → single semantic-release version.
- AC-004 Static site deploys on PR merge → `deploy-site.yml` on push to `main`.

## Open / handoff

- Add `NPM_TOKEN` repo secret; enable Pages (GitHub Actions source).
- First release needs no prior tag; semantic-release defaults to `1.0.0`.
