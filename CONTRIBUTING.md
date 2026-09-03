# Contributing to Rogatio

Thanks for your interest in contributing. This document covers how to set up a local
development environment, the workflow we expect, and the standards every change must meet.

## Code of conduct

Be respectful and constructive. We want Rogatio to be a welcoming project for newcomers and
experienced contributors alike.

## Getting started

Rogatio is a pnpm monorepo. You need:

- **Node.js 24** or newer (Node 24 is the CI baseline)
- **pnpm 10.32.1**
- **Chromium** for browser smoke tests

```sh
git clone git@github.com:drmaas/rogatio.git
cd rogatio
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Verify your environment with the full validation sequence:

```sh
pnpm validate
```

`pnpm validate` runs formatting, linting, typechecking, the build, the unit suite, and the
browser smoke journey in a fail-fast order, including negative fixtures. It is the same
sequence CI runs, so a green local `pnpm validate` is a strong signal your change will pass.

## Development workflow

1. **Create a branch** off the default branch for your change.
2. **Make the change**, keeping package boundaries intact (see
   [`docs/architecture.md`](docs/architecture.md)). Each package owns a single
   responsibility; do not reach across boundaries.
3. **Add or update tests** for any behavior change. Unit tests live with their package;
   browser journeys live in the root `test/` directory.
4. **Run `pnpm validate`** and make it pass before committing.
5. **Open a pull request** describing the change, the motivation, and how you verified it.

Keep changes focused. A pull request should do one thing well; larger refactors are easier
to review when split.

## Coding standards

- **Language:** strict TypeScript 7, ESM/NodeNext. No `any` escapes without a clear reason.
- **Formatting & linting:** Biome is authoritative. Run `pnpm format` and `pnpm lint`.
- **Builds:** esbuild. Produced artifacts must stay browser-safe for MV3 packages (no Node
  globals, dynamic evaluation, remote code, or Ajv runtime compilation in extension code).
- **Tests:** Vitest for units, Playwright for browser journeys. Prefer real execution over
  mocks; do not accept false-green checks.
- **Dependencies:** adding a dependency requires review. pnpm's default install-script
  blocking is intentional; any exception must be documented.

## Commit messages

Every commit must reference an open issue. This is enforced locally by the
`.husky/commit-msg` hook, which rejects any message whose footer does not contain
`#<NN>` or `Closes #<NN>`. Conventional Commits format is also required
(`type(scope): description` or `type: description`).

Before you commit:

1. **Use an existing issue** when one already tracks the change. Reference it in the
   footer, e.g. `Refs #42` or `Closes #42`.
2. **Create one automatically** when no issue exists yet. Open the issue first (a short
   title and one-line description is enough), then reference its number in the commit
   footer. Do not skip the issue step — a commit without a linked issue will be rejected
   by the hook.

For agent-driven work, the agent must confirm an issue number with the user (reuse an
existing issue or create one) before committing, rather than inventing a number.

If a commit legitimately has no associated issue, open one first — there is no
exception path in the hook.

## Documentation

If your change affects behavior, boundaries, or the public contract, update the relevant
file so these stay in sync:

- `README.md` — user-facing overview and usage.
- `docs/architecture.md` — package boundaries and decisions.
- `AGENTS.md` — agent workflow and tier rules.

Spec and plan files under `docs/specs/` and `docs/plans/` are frozen decision history and
must not be edited. If a feature is in flight, write its spec and plan under
`docs/decisions/<feature>/`; on release they are moved into the frozen locations.

Raw brainstorm output is ephemeral and is not part of durable documentation.

## Reporting issues

Open an issue with a clear reproduction, the expected behavior, and what you observed.
Include your Node and pnpm versions and the browser you tested against.

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
