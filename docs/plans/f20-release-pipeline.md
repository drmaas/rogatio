# F20 — Release pipeline

**Status:** Implemented
**Branch:** `feature/f20-release-pipeline`

## Scope

F20 delivers the automated release pipeline described in `sequence.md` plus the
on-merge static-site deployment requested alongside it:

- **`Release` workflow** (`.github/workflows/release.yml`) runs on merge to `main`
  (and `workflow_dispatch`). It builds the monorepo, then runs semantic-release.
- **semantic-release** (`.releaserc.json`) with:
  - `commit-analyzer` + `release-notes-generator` (conventional commits).
  - `changelog` (`CHANGELOG.md`).
  - `@semantic-release/npm` publishing `@rogatio/cli` (pkgRoot `packages/cli`).
  - a local plugin (`scripts/release-extension-plugin.mjs`) that stamps the extension
    package version and zips `packages/extension/dist` into
    `rogatio-extension.zip`.
  - a local `generateNotes` plugin (`scripts/release-notes-plugin.mjs`) that appends an
    npm section linking the GitHub Release to the published `@rogatio/cli` version.
  - `@semantic-release/github` creating the GitHub Release and attaching the ZIP.
- **`Deploy docs site` workflow** (`.github/workflows/deploy-site.yml`) builds
  `packages/docs-site` and deploys to GitHub Pages on merge to `main`.

## Decisions (confirmed with user)

- CLI publishes to the **public npm registry** (`registry.npmjs.org`), not GitHub
  Packages. Package stays `@rogatio/cli`; `private:false` + `publishConfig.access:public`.
- Static site deploys to **GitHub Pages** via `actions/deploy-pages`.

## Consumed packages

- `semantic-release@24.2.5`, `@semantic-release/changelog@6.0.3` (root devDependencies).
- `@semantic-release/npm` and `@semantic-release/github` ship inside semantic-release.

## Required repository secrets / settings

- `NPM_TOKEN` — npm automation/publish token (classic or granular with `read/write`
  on `@rogatio/cli`).
- Pages enabled with source **GitHub Actions** (the deploy workflow handles the rest).
- `GITHUB_TOKEN` is provided automatically with `contents: write` (release) and
  `pages: write` / `id-token: write` (deploy).

## Versioning

semantic-release owns the single version. The git tag, the `@rogatio/cli` version, and
the extension ZIP version are all set to the same release version. The extension
`package.json` is stamped by the local plugin during `prepare`.

## Verification

- `node --check scripts/release-extension-plugin.mjs` — plugin parses.
- `node --check scripts/release-notes-plugin.mjs` — plugin parses.
- `.releaserc.json` is valid JSON.
- Full CI validation (`format:check`, `lint`, `typecheck`, `build`, `test`) passes.
- `pnpm release --dry-run` validates the semantic-release configuration end-to-end.
