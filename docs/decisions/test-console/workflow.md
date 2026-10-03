# Test console — workflow

> Audience: agent
> Status: draft for review with the implementation (issue #278)
> Issue: [#278](https://github.com/drmaas/rogatio/issues/278)
> Spec: `docs/decisions/test-console/spec.md`
> Plan: `docs/decisions/test-console/plan.md`

Branch: `cursor/test-console-e906`

## Tasks

- [x] Record this spec, plan, and workflow.
- [x] Add `previewRuleAction` in `@rogatio/dry-run` and use it from `rogatio test` and `POST /api/dry-run`.
- [x] Teach the editor page to treat a non-2xx dry-run body as field diagnostics.
- [x] Add the extension `dry-run` command and pass `dryRun` from the management page. Keep Ajv off that page.
- [x] Render the test console from the spec: copy, defaults, one Run test control, sentences, collapsed misses, rule navigation, disabled-group label, invalid-draft recovery.
- [x] Unit tests: CLI route, extension command, default GET/`main_frame` case, editor render after an invalid draft.
- [x] Browser tests: one Run test control, collapsed misses, rule-name navigation, disabled-group label.
- [x] Update the quick start, the dry-run guide, and the architecture editor section.
- [ ] `pnpm validate` passes.

## Notes

No product question was left open. The judgment calls in the plan cover preview wording, where "Try a URL from this rule" sits, and how the checking sentence tracks the selects.
