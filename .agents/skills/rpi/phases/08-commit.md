# Phase 8 — Commit (asked, never auto)

Goal: ask the user to commit the phase. Never auto-commit.

## Behavior

1. The skill prints:

   ```
   === Commit gate: Phase <N> ===
   Files changed: <list>
   Validation: <last validation output summary>
   Suggested commit message:
   <conventional-commit subject>
   <body explaining why>
   === end gate ===
   ```

2. The skill then calls `question` with options:

   - **Commit as suggested** — the skill runs the user's command verbatim.
   - **Commit with my message** — user provides the exact command; the skill runs it.
    - **Skip commit, continue** — the user wants to keep iterating; the skill does not commit, returns to phase 5 for the next phase (or phase 9 if all phases done).
   - **Abort** — stop the workflow.

3. The skill never runs `git add` or `git commit` without the user explicitly choosing one of the first two options.

4. If the user provides a custom message, the skill uses that exact message. The skill does not reformat, shorten, or rewrite it.

5. The skill does not run `git push`, open a PR, merge, or remove the worktree. Those are separate release actions, each requiring its own authorization.

## Commit message style

Match the repository's existing convention. Read `git log --oneline -20` to see the pattern. If the repository uses Conventional Commits, follow it; otherwise match whatever is in use.

Every commit message must reference an open issue (`#<NN>` or `Closes #<NN>`) per the repository's commit-msg hook. The user must supply the issue number; the skill does not invent one.

## Audit before commit

Before asking the user, run:

- `git status` — confirm only intended files are staged/unstaged.
- `git diff --stat <base-branch>..HEAD` — confirm only intended files changed.
- A quick scan for secrets, local settings, generated artifacts, and unrelated changes.

If anything looks off, stop and surface it to the user before asking to commit.

## Exit conditions

- The user replied Commit, Commit with my message, Skip, or Abort.
- If Commit or Commit with my message: the commit succeeded; the next phase reads the new HEAD.

After Commit: return to phase 5 for the next phase, or move to phase 9 if all phases in `CHECKLIST.md` are done.
