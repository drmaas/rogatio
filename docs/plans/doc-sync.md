# Doc-sync plan (free tier, doit)

**Branch:** feature/doc-sync  
**Worktree:** /home/drmaas/.local/share/opencode/worktree/rogatio/doc-sync  
**Tier:** free

## Architecture note
- docs/architecture.md status line is outdated (mentions f13 mock-rules in progress, stage 10, but repo is at F22 design-system on main).
- docs-site architecture reference needs to include docs-site package and current package list.
- Root docs/f*-workflow.md (f1-f19) should be moved to docs/workflows/ without content changes (per user: no edits to spec/plan/workflow content, just move).
- docs/specs/* and docs/plans/* for f1-f19: ignore (no changes).
- Other docs to sync: rogatio-overview.md, CONTRIBUTING.md, docs-site.

## Plan
1. Update docs/architecture.md status line to reflect current reality (F22 released, mock rules not mentioned as in-progress).
2. Move docs/f*-workflow.md files into docs/workflows/ (content unchanged).
3. Update docs-site reference/architecture.md for package list/reality.
4. Check rogatio-overview.md and CONTRIBUTING.md for outdated info; sync if needed.
5. Verify build passes (format/check not needed for docs but confirm no syntax issues).
6. Commit with conventional message.
