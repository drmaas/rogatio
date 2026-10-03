> Status: frozen 2026-10-03

# Workspace chrome — specification

> Audience: hybrid
> Status: approved (plan gate, 2026-10-03). Frozen on release. Issue #280.

## 1. Problem and goals

Workspace chrome repeats navigation. The extension top bar has a breadcrumb. A bar under it holds Refresh, Export project, Remove project, the Active rules label, and a group menu. The editor rail lists every group plus Test console.

**Goals**

- Put project lifecycle actions on the project details page.
- Put the Active rules label on the Rules card.
- Remove the subheader and the top-bar breadcrumb.
- Make the editor rail a two-link breadcrumb. The group link opens a picker.
- Put Test console on the command bar.

## 2. Scope and non-goals

### In scope

- Shared editor rail, group picker, command bar, and optional project actions.
- Extension Workspace header, sidebar Rules card, and removal of the subheader.
- Unit tests, browser tests, and living docs that describe this chrome.

### Non-goals

- Dashboard project cards, popup, or deep-link URLs.
- Removing the project page group list (open, copy, remove).
- Editing frozen decision records.

## 3. Actors and entry points

- A person using `rogatio edit` or the extension Workspace.
- The extension host, which supplies `EditorOptions.projectActions`.
- The CLI host, which omits that port.

## 4. Requirements

- **REQ-001:** The editor rail is a breadcrumb with two links. The first shows the draft project name, or `Project` when the name is empty. It opens the project page. It has `aria-current="page"` on that page.
- **REQ-002:** The second link shows the open group name, or `Groups` when no group is open. It always opens the group picker. It has `aria-current="page"` only on a group page.
- **REQ-003:** Search stays on the rail. The rail stays visible at narrow widths. The compact mobile route select is removed.
- **REQ-004:** The group picker lists each group with its name, rule count, and Enabled or Disabled when the host passed `groupEnablement` and the group has a saved id. Choosing a row opens that group and closes the picker. Escape, Close, and the backdrop close it without navigating. Focus returns to the group link. An empty project shows `No groups yet.` and Close.
- **REQ-005:** Test console is a command-bar control with `data-route="test"`. It has `aria-current="page"` on the test route. Run test stays on that route.
- **REQ-006:** `EditorOptions.projectActions` renders inside Project details. Each entry has `command`, `label`, and an optional `danger` tone. The CLI omits the port and shows no buttons. The extension supplies Refresh, Export project, and Remove project, with Remove as danger. Commands stay `refresh`, `export`, and `remove`.
- **REQ-007:** The extension removes the Workspace subheader, the top-bar breadcrumb, and the group menu. The Active rules string moves to the Rules card and keeps `data-badge-state`.
- **REQ-008:** `?group=` deep links, `navigateToGroup`, and sidebar rule links still open the right place.

## 5. Acceptance criteria

- **AC-001:** The rail shows the project name and `Groups` on the project page. The project link is current.
- **AC-002:** Opening the group link shows one row per group. Selecting a row shows that group. The group link label becomes the group name and is current.
- **AC-003:** Escape, Close, and a backdrop click close the picker and leave the route unchanged. Focus returns to the group link.
- **AC-004:** With no groups, the picker shows `No groups yet.` and Close.
- **AC-005:** With `groupEnablement`, a saved group row shows Enabled or Disabled.
- **AC-006:** Test console is in the command bar, not the rail. Activating it opens the test page and marks that control current.
- **AC-007:** Project actions render only when supplied, inside Project details, and survive a re-render.
- **AC-008:** At a narrow viewport the rail is visible and the mobile route select is absent.
- **AC-009:** Workspace has no subheader, no top-bar breadcrumb, and no group menu. Refresh, Export project, and Remove project are on Project details. The Rules card shows the Active rules text.
- **AC-010:** A sidebar rule link and a `?group=` URL still open that group.

## 6. Compatibility

The project file format does not change. Dashboard and the popup do not change. Frozen specs stay frozen. This record supersedes the chrome described in the F5 and F22 living layout text only where those docs are updated.
