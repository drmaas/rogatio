# Worktree setup

RPI always runs in a dedicated feature worktree. Never edit in the main checkout.

## Procedure

Run at the start of the workflow, after the user picks `<feature>` and provider tier.

1. Verify the active root:

   ```bash
   git rev-parse --show-toplevel
   git worktree list
   git status --short
   ```

2. If uncommitted changes exist in the main checkout, stop and ask the user. Do not stash, do not commit, do not mix changes.

3. Create the worktree at the canonical OpenCode path:

   ```bash
   git worktree add -b feature/<feature-slug> \
     /home/drmaas/.local/share/opencode/worktree/<repo name>/<feature-slug> \
     <base-branch>
   ```

   - `<repo name>` matches the directory name of the repository root.
   - `<feature-slug>` is the kebab-case feature slug.
   - `<base-branch>` is the branch the user wants as the base (usually `main`).

4. Switch the active session to the new worktree by `cd`-ing the shell and re-running `git rev-parse --show-toplevel` to confirm.

5. Run the repository setup in the new worktree (e.g. `pnpm install`) and confirm the shell is operating there before any edits.

6. Reject if the worktree already exists with a different branch. The user must explicitly authorize reuse.

## Conventions

- Worktree branch names use `feature/<slug>` unless the user specifies otherwise.
- Never use the `opencode-worktree` plugin. Use `git worktree add` directly.
- The pre-existing manual worktree `~/Projects/github/drmaas/rogatio-f7` (branch `feature/f7-extension-shell`) is exempt and may stay in place.

## Cleanup

- Never remove a worktree without explicit user authorization. The worktree's branch is the source of truth for the feature work; removal is a release action.
- After the feature is merged, ask before running `git worktree remove`.
