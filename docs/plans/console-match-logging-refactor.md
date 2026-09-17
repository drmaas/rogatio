# console-match-logging — refactor candidates

Proposal only. No behavior change on the sequential install/match path. Conservative: close duplication and two residuals the final review left (index lost-update, write-time truncate gaps on enum-like strings). Do not add match queues, keepalive, CAS on the index key, or browser-core installer ports.

Self-review discarded shared defensive-read helpers, a public `toMatcherOperations`, merging format with redaction, and chrome.storage CAS for the index. Those are low benefit, fight ADRs, or expand the storage contract.

---

## 1. One write-time sanitizer; truncate every stored string

### Candidate

`entryFromOperation` and `sanitizeMatchIndexEntry` in `packages/extension/src/match-index.ts` both switch on kind and apply deny-list / `truncateLogString`. Header construction duplicates `sanitizeHeaderIntent`. Query param mapping is copied.

Fold: build a raw entry from the operation, then run **one** sanitizer used by `writeMatchIndex`. Truncate **every** stored string, including `ruleId`, `kind`, header `direction` / `operation`, and query `operation`. Today those enum-like fields and `ruleId` skip write-time truncate (ADR 0003 / checklist: truncate every stored string). Console output already truncates them in `formatMatchRecord` via `logString`, so valid schema enums (short) do not change on the line.

While rewriting the switches, drop `as RedirectIntent` / `as QueryIntent` / `as HeaderIntent` with kind predicates on `MatchIndexEntry`. Keep `intent` as a kind-discriminated subset; do not add a second `kind` on the intent object.

### Expected benefit

Write-time bound matches ADR 0003. A tampered oversize `direction` / `operation` / `ruleId` cannot sit unbounded in `chrome.storage.local` until the next format call. Next indexed kind is one sanitizer, not two. Casts cannot lie when kind and intent shape disagree.

### Risk

Low. Sanitization is already idempotent (`[redacted]` and `...` re-applied). Schema enums stay under 200 characters, so stored snapshots for honest installs stay byte-identical. Tests that assert stored `direction: "request"` / `operation: "set"` keep passing. Do not start rejecting unknown enum strings at parse (that would turn a truncated log line into an unknown-id no-op).

### Scope

`packages/extension/src/match-index.ts` only. Formatter stays the format-time re-apply seam. No Chrome API, schema, or editor changes.

### Test plan

Existing `packages/extension/test/match-index.test.ts`: install / sanitize-helper / header-intent cases unchanged for valid ops. Add: oversize `ruleId`, header `direction` / `operation`, and query `operation` on `sanitizeMatchIndexEntry` → each stored string ≤200 and ends with `...` when cut. Format fixtures still pass (format-time bound already covered). `pnpm --filter @rogatio/extension test`.

**Recommendation:** yes

---

## 2. Serialize wholesale index writes (lost-update)

### Candidate

`writeWholesaleMatchIndex` in `packages/extension/src/dnr.ts` is the sole writer (ADR 0003) but two call sites read-merge-write without a lock:

- `install()` overlays redirect/query from `tracked`, keeps stored header entries
- `syncHeaderMatchIndex()` overlays header entries, keeps stored redirect/query when `tracked` is empty (SW restart)

Overlapping commands (e.g. `install` vs `state()` → header sync) can both read, then last write drops the other slice. Sequential `await install(); await state()` is fine; the race is concurrent.

Copy the in-process tail used by `createStorageAdapter` (`packages/extension/src/chrome.ts` `withMutationLock`): the whole read-merge-write of `writeWholesaleMatchIndex` runs on one installer-instance queue. Optionally rename the flags (`headerEntries?`, `preserveUntrackedRedirectQuery?`) to an explicit slice overlay (`redirectQuery: tracked | stored | empty`, `headers: entries | stored`) in the same edit — same merge rules, readable.

Do **not** add chrome.storage CAS, a second writer in `installer.ts`, or a match queue. UI still must not write this key.

### Expected benefit

Overlapping redirect/query install and header sync keep both slices. Matches the envelope mutation-lock pattern already in this package. Flag soup becomes one overlay description, cheaper for the next kind that must join the same snapshot.

### Risk

Low–medium. Sequential tests and production command handlers (`await install` then `await state()`) stay ordered. A broken lock (shared across installer instances, or awaiting unrelated envelope CAS inside the lock) could stall installs. Production constructs one `createDnrInstaller`. Empty-tracked header sync must still preserve stored redirect/query (AC12 / P6). Failed `updateDynamicRules` still must not write.

### Scope

`packages/extension/src/dnr.ts` (`createDnrInstaller` closure). Tests in `packages/extension/test/match-index.test.ts`. No `browser-core` port change. No `installHeaderRules` writer.

### Test plan

Keep: failed install leaves previous index; empty success writes `{}`; redirect install keeps stored header ids; header sync after empty `tracked` keeps stored redirect/query.

Add: overlapping `install([...redirect])` and `syncHeaderMatchIndex([{ ruleId: 2_000_001, ... }])` against one installer — after both settle, snapshot has the new redirect **and** the header id (neither slice dropped). `pnpm --filter @rogatio/extension test`.

**Recommendation:** yes

---

## 3. Persist editor checkboxes by `dataset.path`, not field name

### Candidate

`handleChange` in `packages/editor/src/editor.ts` special-cases `decodePointer(path)?.at(-1) === "redactSensitiveInLogs"` so a checkbox writes `target.checked` instead of `target.value` (`"on"`). Resource-type checkboxes already return earlier via `dataset.resourcePath` and do not set `dataset.path`.

Treat any `HTMLInputElement` with `type === "checkbox"` and `dataset.path` as a boolean persist through `setValueAtPath`. Keep `input` skipping checkboxes. Do not add the flag to `ACTION_PAYLOAD_FIELDS`.

### Expected benefit

Next boolean rule field (body-rule log checkbox in GitHub issue #163, or another non-body flag) does not copy a field-name branch. The `"on"` string bug cannot return for a new `renderField` checkbox.

### Risk

Low. Only the redact checkbox currently pairs `type=checkbox` with `dataset.path`. A future checkbox that meant to persist a string would start writing a boolean — do not point `renderField` at non-boolean checkboxes. Resource-type checks stay on `dataset.resourcePath`.

### Scope

`packages/editor/src/editor.ts` `handleChange` only.

### Test plan

Existing `packages/editor/test/redact-sensitive-in-logs.test.ts`: `change` writes booleans; `input` does not persist; omitted/`false` unchecked; body cards still hide the control; type change keeps the flag. No new Playwright editor journey. `pnpm --filter @rogatio/editor test`.

**Recommendation:** yes

---

## Skipped (self-review)

| Idea | Why skip |
| --- | --- |
| Shared `ownRecord` / format `readProperty` | Index uses `Object.hasOwn`; formatter must catch accessors on already-parsed entries. Different trust edges; AC requires format-time re-apply. |
| `toMatcherOperations` on `@rogatio/compiler` | Three 6-line maps (cli runtime/test/routes + dry-run test). New public export for a fixture sweep. |
| Merge `match-format.ts` + `match-log-redaction.ts` | Plan split: pure redaction vs record shape. Tests already target that seam. |
| UI `loadMatchLoggingEnabled` → `readMatchLoggingEnabled(chrome)` | Eight duplicated lines; helper already exists. One-liner, not leverage. |
| `syncHeaderMatchIndex` on `RuleInstallerAdapter` | Plan: `browser-core` untouched. Duck-type stays the extension boundary. |
| chrome.storage CAS on the index key | Envelope CAS exists because many pages write `rogatio`. Index has one SW writer; in-process lock is enough. CAS would invent a retry protocol. |
| Probe / Playwright fixture extract | `header-match-probe.spec.ts` is P6 evidence, not a product module. Toggle spec seeds are local. |
| Validate stored direction/operation against schema enums | Behavior change: tampered strings become unknown-id no-ops instead of truncated log text. Fail-closed already covers malformed entries. |

---

## Summary ranking

1. One write-time sanitizer; truncate every stored string — **yes**
2. Serialize wholesale index writes (lost-update) — **yes**
3. Editor checkbox persist by `dataset.path` — **yes**
