# Research — dashboard-runtime-ai

> Status: frozen 2026-10-04

## Problem restatement

Creating an AI project needs the native runtime started plus AI configured. The Dashboard shows a disabled Create using AI button with a hint, but no runtime status, no AI status, and no Start/Stop controls. The user must discover the Workspace sidebar cards to fix it (`docs/decisions/dashboard-runtime-ai/prd.md:9`).

Goal: show the same runtime/AI truth on the Dashboard, with working controls, styled to match, reusing existing commands and state (`docs/decisions/dashboard-runtime-ai/prd.md:25-28`).

## Codebase findings

### Dashboard render path

- Page entry owns all Dashboard/Workspace rendering in one file: `packages/extension/src/extension-page-entry.ts`.
- `renderOverview(shell)` builds the Dashboard: heading "Projects", subtitle, project grid, creation section, projects section (`packages/extension/src/extension-page-entry.ts:1098-1108`).
- `renderShell()` builds topbar, layout, status line, optional runtime guidance, then Dashboard or Workspace (`packages/extension/src/extension-page-entry.ts:1350-1424`).
- Layout marks the view: `layout.dataset.view = activeTab` (`packages/extension/src/extension-page-entry.ts:1366`).
- Sidebar mounts only on workspace: `if (activeTab === "workspace") layout.append(createSidebar())` (`packages/extension/src/extension-page-entry.ts:1367`).
- Dashboard path calls `renderOverview(main)`; workspace path mounts an editor root instead (`packages/extension/src/extension-page-entry.ts:1415-1421`).
- So today the Dashboard never renders `createSidebar()` output. Any runtime/AI card on the Dashboard must be new DOM in `renderOverview`, reusing sidebar logic.
- `createSidebar()` builds: inert active-project card, runtime card, AI card, attention note, rules card, rule error card (`packages/extension/src/extension-page-entry.ts:783-1014`).
- Card helper `createSidebarCard(name, headingText, tone)` makes a `section.rogatio-sidebar-card` with `data-card` plus a heading with `data-tone` (`packages/extension/src/extension-page-entry.ts:349-365`).
- Dashboard project card status today only says Active Runtime / Runtime failed / Runtime unavailable / Runtime starting / Idle, from `state.nativeRuntimeState.phase` (`packages/extension/src/extension-page-entry.ts:1121-1147`). No Start/Stop, no AI status.
- Dashboard creation tiles: Create (`data-command="create"`), Import (`data-command="import"`), Create using AI (`data-command="ai-generate"`) inside `.rogatio-creation-grid` inside a `section.rogatio-dashboard-card[data-dashboard-section="create"]` (`packages/extension/src/extension-page-entry.ts:1181-1254`).
- Click dispatch for these commands lives on the shell handler: `refresh`, `switch`, `create`, `import`, `ai-generate`, `ai-cancel`, `ai-create`, copy commands, `start-native-runtime`, `stop-native-runtime`, `show-diagnostics` (`packages/extension/src/extension-page-entry.ts:1470-1486`).
- Tab switching sets `activeTab` and calls `renderShell()` (`packages/extension/src/extension-page-entry.ts:1464-1469`).

### State sources

- Envelope from `refresh` carries `nativeRuntimeState?: { phase: string }` and `nativeRuntimeError?: string | null` (`packages/extension/src/extension-page-entry.ts:37-44`).
- Page AI state is four module vars: `aiSupported`, `aiStatusChecked`, `aiReported`, `aiProvider: { url, model } | null`; key is never stored (`packages/extension/src/extension-page-entry.ts:146-152`).
- `checkNativeAISupport()` sends `check-ai-support`, reads `supported/reported/providerUrl/model`, copies only the two display strings to `aiProvider`, treats partial metadata as not-reported (`packages/extension/src/extension-page-entry.ts:1922-1973`).
- `refresh()` loads match-logging flag, sends `refresh`, replaces `state`, resets AI vars when phase is not `started`, else awaits `checkNativeAISupport()` (`packages/extension/src/extension-page-entry.ts:2108-2140`).
- Refresh preserves Dashboard context by calling `renderShell()`, which rebuilds from `activeTab`; the dirty-editor guard (`remountEditor === false` → `patchWorkspaceEnablementChrome()`) only matters on workspace (`packages/extension/src/extension-page-entry.ts:2143-2155`).
- `runtimeControlDisabled(phase)` returns `{ start, stop }`; Start is off while `started`/`starting`, Stop is off otherwise (`packages/extension/src/runtime-controls.ts:6-13`).
- Sidebar wires it as `controlsDisabled.start` / `.stop` on the two buttons (`packages/extension/src/extension-page-entry.ts:823-828`).
- `runtimeStatusText()` maps phase to stopped / starting / running / failed to start / unavailable on this platform / error (`packages/extension/src/extension-page-entry.ts:553-569`).
- `runtimeStatusTone()` maps phase to CSS class `rogatio-runtime-running/-failed/-starting/-idle` (`packages/extension/src/extension-page-entry.ts:334-340`).
- Sidebar runtime card order: Start/Stop buttons, status line `[data-native-runtime-state]`, extension-ID row `[data-extension-id]` + copy button, then only on `failed`/`unsupported`: Show diagnostics button + `[data-runtime-error]` + optional `[data-runtime-origin-mismatch]` re-pin line (`packages/extension/src/extension-page-entry.ts:820-875`).
- `runtimeRecoveryText()` picks the fix hint by matching error text: allowed_origins, native-host-missing, host, trust/certificate/ca, unsupported, else ask to open diagnostics (`packages/extension/src/extension-page-entry.ts:571-593`).
- `runtimeInstallCommand(extensionId)` returns plain `rogatio runtime install` for the release ID, `--extension-id <id>` for other valid IDs, placeholder otherwise (`packages/extension/src/extension-id.ts:13-19`).
- Extension ID comes from `chrome.runtime.id` via `extensionId()` (`packages/extension/src/extension-page-entry.ts:328-331`).
- Diagnostics modal state is `diagnosticsOpen` + `diagnosticsData` (phase, extensionId, hostName, chromeError, runtimeError, connectNativeAvailable, timestamp) (`packages/extension/src/extension-page-entry.ts:176-185`).
- `showDiagnostics()` sends `diagnose-native-runtime` and opens the modal (`packages/extension/src/extension-page-entry.ts:1975-1993`); `renderDiagnosticsModal()` builds overlay, table rows, hint, Copy diagnostics + Close buttons, with direct listeners because the overlay sits outside the shell (`packages/extension/src/extension-page-entry.ts:2019-2097`).
- Copy buttons: `copyExtensionId()` copies `chrome.runtime.id`; `copyInstallCommand()` prefers `installCommand` set by a failed start, else derives from phase `failed` + ID; both fall back from clipboard API to textarea + execCommand (`packages/extension/src/extension-page-entry.ts:1876-1920`).
- `nativeRuntimeCommand()` sends start/stop, maps `extension.native-host-origin-forbidden`, `extension.native-host-missing`, `extension.request-body-needs-trust`, `extension.native-runtime-unavailable` to messages and sets `installCommand` for the copy path, then calls `refresh()` (`packages/extension/src/extension-page-entry.ts:1814-1874`).
- AI card logic: tone ok/warn/muted from `aiSupported` / checked+reported (`packages/extension/src/extension-page-entry.ts:879-884`); status text precedence is needs-runtime (phase not started) > Configured (provider known) > not reported (checked, nothing reported) > Not configured (`packages/extension/src/extension-page-entry.ts:885-902`); provider/model lines render only when supported and known (`packages/extension/src/extension-page-entry.ts:903-913`).
- Service worker is the truth behind these: `check-ai-support` returns not-reported unless runtime started with `send` available, else configured/not-configured shapes (`packages/extension/src/service-worker.ts:490-519`); `generate-project` needs runtime started, validates prompt, validates + compiles the model output (`packages/extension/src/service-worker.ts:520-559`); `diagnose-native-runtime` returns phase, IDs, errors, timestamp (`packages/extension/src/service-worker.ts:921-938`); start works even with no active project against an empty project so first-run AI flows can start runtime before any project exists (`packages/extension/src/service-worker.ts:788-796`).
- Command names are fixed in `packages/extension/src/protocol.ts:7-28` and the `COMMANDS` set (`packages/extension/src/protocol.ts:44-66`).

### AI-gated Create using AI

- AI card button: class `rogatio-create-project rogatio-create-ai`, `data-command="ai-generate"`, `disabled = !aiSupported`, `aria-describedby="rogatio-ai-create-hint"` (`packages/extension/src/extension-page-entry.ts:1235-1240`).
- Hint text swaps: supported → "Describe the project you want to build.", else "Start the native runtime and configure AI to enable generation." (`packages/extension/src/extension-page-entry.ts:1247-1252`).
- `openAIComposer()` returns early when `!aiSupported`, else opens composer and focuses the prompt (`packages/extension/src/extension-page-entry.ts:1673-1680`).
- `generateProject(prompt)` sends `generate-project`, shows safe-preview message or a retry message (`packages/extension/src/extension-page-entry.ts:1690-1708`).
- `createGeneratedProject()` sends `import-project` with the preview, then `refresh()` (`packages/extension/src/extension-page-entry.ts:1710-1726`).
- Editor `aiAssist` is also gated: only passed to `createEditor` when `aiSupported` (`packages/extension/src/extension-page-entry.ts:1610-1634`); refresh remounts the editor when AI support flips (`packages/extension/src/extension-page-entry.ts:2143-2155`).
- Edge case: AI support is only checked when phase is `started`; otherwise the page resets all AI vars to not-checked (`packages/extension/src/extension-page-entry.ts:2132-2140`). Dashboard must read the same vars so the gate and the status never disagree.

### CSS

- Dashboard cards use `.rogatio-dashboard-card`: grid, border, radius, dark surface, responsive padding, shadow (`packages/extension/src/extension.css:592-602`).
- Sidebar cards use `.rogatio-sidebar-card` + heading with tone dot via `::before` and `data-tone="ok/warn/error"` (`packages/extension/src/extension.css:263-305`).
- Creation tiles use `.rogatio-creation-grid` (3 columns) and `.rogatio-create-project` tiles with icon/title/hint areas (`packages/extension/src/extension.css:759-783`); AI tile adds purple border/gradient (`packages/extension/src/extension.css:811-821`).
- Tone dots: runtime `.rogatio-runtime-status::before` with running/failed/starting classes (`packages/extension/src/extension.css:397-420`); AI `.rogatio-ai-status::before` with ready/needs-runtime/not-configured/not-reported classes (`packages/extension/src/extension.css:361-387`).
- Responsive + forced-colors follow existing tokens: creation/project grids collapse at 48rem, AI composer and shell/cards remap to Canvas/Highlight (`packages/extension/src/extension.css:953-977`, `packages/extension/src/extension.css:1029-1098`).
- Popup is separate: `packages/extension/src/popup.ts` with its own `popup.css`; it has no runtime/AI cards, so it is out of scope.

### Tests

- Unit: `packages/extension/test/runtime-controls.test.ts:1-41` covers start/stop disabled logic per phase; `packages/extension/test/extension-page.test.ts:1-20` covers the pending-select page model; `packages/extension/test/ai-provider-status.test.ts` covers the metadata-only AI check harness; `packages/extension/test/ai-generation.test.ts` covers the generate-project harness and validation.
- Browser sidebar suite (`test/browser/sidebar-cards.test.ts`) covers card order, runtime controls/status/ID, diagnostics + error on failure, AI configured/not-configured/not-reported/needs-runtime precedence, key never in DOM, rule links, focus restore, 360px usability.
- Browser dashboard suite (`test/browser/design-system.test.ts:321-410`) covers topbar, tabs, `[data-overview]`, two dashboard sections, 3 creation tiles, no sidebar on dashboard, workspace switch; `test/browser/extension.test.ts` covers Start/Stop, install command, guidance, diagnostics modal, allowed_origins re-pin, AI needs-runtime → configured flow.
- Browser AI live (`test/browser/ai-live.test.ts:322-368`) covers Dashboard `ai-generate` enabled, preview counts, `ai-create` saving with "AI project created." status.

## Constraints and invariants

- Reuse existing commands and state: `refresh`, `check-ai-support`, `runtimeControlDisabled`, `runtimeStatusText` (`docs/decisions/dashboard-runtime-ai/prd.md:26`).
- No new runtime lifecycle, host install flow, AI setup UI, permissions, storage keys, or network calls (`docs/decisions/dashboard-runtime-ai/prd.md:32-35`).
- Dashboard and Workspace must show the same runtime/AI truth and share command handlers + disabled logic (`docs/decisions/dashboard-runtime-ai/prd.md:19`, `docs/decisions/dashboard-runtime-ai/prd.md:42`).
- Never render the API key: page copies only `providerUrl` + `model` from the check response (`packages/extension/src/extension-page-entry.ts:1950-1954`); leak test asserts the key is absent from the DOM (`test/browser/sidebar-cards.test.ts:326`).
- Partial AI metadata is non-conforming: show "not reported", never a half-populated card (`packages/extension/src/extension-page-entry.ts:1955-1960`).
- AI needs-runtime takes precedence over reported metadata (`packages/extension/src/extension-page-entry.ts:889-891`, `test/browser/sidebar-cards.test.ts:368-387`).
- Sidebar is workspace-only; Dashboard additions must live in `renderOverview` and keep `layout[data-view="dashboard"]` single-column (`packages/extension/src/extension-page-entry.ts:1366-1367`, `packages/extension/src/extension.css:589-591`).
- Keep `renderShell` focus restore working for both rebuild paths (`packages/extension/src/extension-page-entry.ts:1351-1354`, `packages/extension/src/extension-page-entry.ts:1670`).
- Match F22 tokens, responsive, focus, live status, forced colors, narrow widths (`docs/decisions/dashboard-runtime-ai/prd.md:27`).
- Popup (`packages/extension/src/popup.ts`) is not in scope.

## Plan inputs still needed

- Signatures to reuse, not re-derive: `runtimeControlDisabled(phase: string | undefined): { start, stop }` (`packages/extension/src/runtime-controls.ts:6-13`); `runtimeStatusText(): string`, `runtimeStatusTone(): string`, `runtimeRecoveryText(): string` read module `state` (`packages/extension/src/extension-page-entry.ts:553-593`); `createSidebarCard(name, headingText, tone): { card, body }` (`packages/extension/src/extension-page-entry.ts:349-365`); page AI vars `aiSupported/aiStatusChecked/aiReported/aiProvider: { url, model } | null` (`packages/extension/src/extension-page-entry.ts:146-152`).
- Private vs exported: only `runtimeControlDisabled` (`packages/extension/src/runtime-controls.ts`) and `runtimeInstallCommand` (`packages/extension/src/extension-id.ts:13-19`) are importable; card builders, `nativeRuntimeCommand`, `showDiagnostics`, `checkNativeAISupport`, status/tone helpers are private in `extension-page-entry.ts` — plan must extract or duplicate deliberately.
- Error paths the Dashboard inherits: `nativeRuntimeCommand` maps 4 failure codes (`extension.native-host-origin-forbidden`, `extension.native-host-missing`, `extension.request-body-needs-trust`, `extension.native-runtime-unavailable`) and sets `installCommand` for the copy path (`packages/extension/src/extension-page-entry.ts:1814-1874`); `diagnose-native-runtime` shape is phase/extensionId/hostName/chromeError/runtimeError/connectNativeAvailable/timestamp (`packages/extension/src/service-worker.ts:921-938`).
- Dashboard-relevant edge: start with no active project is valid (starts against empty project for first-run AI, `packages/extension/src/service-worker.ts:788-796`); `refresh()` failure sets "could not be refreshed" and still calls `renderShell()` (`packages/extension/src/extension-page-entry.ts:2108-2121`); focus restore goes through `captureSidebarFocus()` (`packages/extension/src/extension-page-entry.ts:1351-1354`); status lines today are plain `<p>` with no `aria-live` — plan must decide the live-region for the new surface.

## Open questions

- Where exactly should the new Dashboard status surface sit: above "Start a project", between the two dashboard cards, or inside the creation section? PRD says "next to Start a project / Your projects" (`docs/decisions/dashboard-runtime-ai/prd.md:43`) but does not fix the order.
- Should the Dashboard reuse `createSidebarCard` markup (with `data-card="runtime"/"ai"`) or new `data-dashboard-section` hooks? Reuse keeps tone dots and tests cheap, but `data-card` hooks currently imply sidebar in browser tests (`test/browser/sidebar-cards.test.ts:181-183`).
- How much of the runtime card moves over: full extension-ID + copy + diagnostics modal entry + error text, or a slimmer status + Start/Stop? PRD scope lists all of them (`docs/decisions/dashboard-runtime-ai/prd.md:25`) but space on the Dashboard is tighter.
- Self-review: re-read after edit; all path:line cites resolve, PRD cites corrected (:25-28, :26, :32-35, :27, :43), import-input/clipboard/CSS/test-suite over-detail trimmed, plan inputs (signatures, private-vs-exported, error paths, no-project start, refresh failure, live-region gap) added.
