> Status: frozen 2026-09-20

# Editor copy rule / copy group — notes

Audience: hybrid  
Issue: #196  
Workflow: doit

## Outcome

Draft-only Copy rule and Copy group in `@rogatio/editor`. Hosts and schema unchanged.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Rule placement | Same group; insert immediately after source |
| Group placement | Insert immediately after source group; navigate to new group |
| New IDs | `nextId("rule-new")` / `nextId("group-new")` |
| Names | Suffix `" (copy)"` only when result ≤ `LIMITS.maxLabelLength`; else keep name. Nested rule names on group copy unchanged |
| Invalid source | Allow copy; validate on Validate/Save |
| Clone | Soft `snapshotOwnData`; on failure set status, no throw |
| Public API | No new `EditorController` methods |
| UI | Copy rule on rule actions; Copy group on Project list + group heading |

## Acceptance

| ID | Criterion |
| --- | --- |
| AC-196-01 | Copy rule → new independent rule (new id; nested edit does not change source) |
| AC-196-02 | Copy group → new independent group + rules (new group/rule ids; nested edit does not change source) |
| AC-196-03 | Copies in draft, dirty, existing validate/save |
| AC-196-04 | Unit coverage: happy paths + id uniqueness + deep independence |
| AC-196-05 | Browser journey: Copy rule + Copy group reachable; ids distinct |
