import {
  createEditor,
  createMockRuleType,
  createRedirectRuleType,
  createResponseBodyRuleType,
  type EditorController,
} from "@rogatio/editor";
import { validateProjectDetailed } from "./browser-schema.js";

interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
  readonly revision: number;
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
}

interface Envelope {
  readonly projects: Readonly<Record<string, StoredProject>>;
  readonly activeProjectId: string | null;
  readonly ruleStatuses?: readonly Record<string, unknown>[];
  readonly badge?: { readonly text: string; readonly attention: boolean };
  readonly nativeRuntimeState?: { readonly phase: string };
}

interface ExtensionResponse {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly diagnostic?: { readonly code?: string };
}

interface MessageClient {
  send(message: Record<string, unknown>): Promise<ExtensionResponse>;
}

const extensionRoot = document.querySelector<HTMLElement>(
  "#rogatio-extension-root",
);
if (!extensionRoot) throw new Error("extension.invalid-root");
const root = extensionRoot;

const client: MessageClient = {
  send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({
            ok: false,
            diagnostic: { code: "extension.message-failed" },
          });
        } else resolve(response as ExtensionResponse);
      });
    });
  },
};

let state: Envelope = { projects: {}, activeProjectId: null };
let pendingProjectId: string | null = null;
let activeTab: "dashboard" | "workspace" = "dashboard";
let editor: EditorController | undefined;
let statusMessage = "";
/** Ready-to-run native host install command shown with a copy button. */
let installCommand: string | null = null;
let permissionOrigins: readonly string[] = [];
let permissionGranted = false;

function safeProjectData(): unknown {
  if (!state.activeProjectId)
    return { version: 1, name: "Rogatio project", groups: [] };
  return (
    state.projects[state.activeProjectId]?.data ?? {
      version: 1,
      name: "Rogatio project",
      groups: [],
    }
  );
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function button(label: string, command: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  result.dataset.command = command;
  return result;
}

/** The browser-assigned extension ID, needed for the native host install. */
function extensionId(): string {
  const id = chrome.runtime.id;
  return typeof id === "string" && id.length > 0 ? id : "";
}

/** Tone class for the runtime status dot: running, failed, or neutral. */
function runtimeStatusTone(): string {
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  if (phase === "started") return "rogatio-runtime-running";
  if (phase === "failed" || phase === "error") return "rogatio-runtime-failed";
  if (phase === "starting") return "rogatio-runtime-starting";
  return "rogatio-runtime-idle";
}

/** Human-readable runtime phase for the sidebar status line. */
function runtimeStatusText(): string {
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  switch (phase) {
    case "starting":
      return "starting";
    case "started":
      return "running";
    case "failed":
      return "failed to start";
    case "unsupported":
      return "unavailable on this platform";
    case "error":
      return "error";
    default:
      return "stopped";
  }
}

/**
 * The blocking status behind the badge's attention flag, derived from the
 * actual rule statuses (REQ-GAV-004) with the shared f21 precedence
 * (error > needs proxy > needs permission > unsupported). The badge and the
 * sidebar note must describe what is actually blocking — never a canned
 * "grant access" hint when permissions are already granted.
 */
interface AttentionExplanation {
  readonly blocking: string;
  readonly explanation: string;
  readonly fix: string;
}

const ATTENTION_PRECEDENCE: readonly string[] = [
  "error",
  "needs proxy",
  "needs permission",
  "unsupported",
];

function attentionFromStatuses(): AttentionExplanation | null {
  if (state.badge?.attention !== true) return null;
  const statuses = state.ruleStatuses ?? [];
  for (const blocking of ATTENTION_PRECEDENCE) {
    if (!statuses.some((status) => status.status === blocking)) continue;
    if (blocking === "error") {
      return {
        blocking:
          "rules failed to install: re-activate the group or restart the runtime",
        explanation: "some rules failed to install.",
        fix: "Re-activate the group, or restart the runtime for proxy-backed rules.",
      };
    }
    if (blocking === "needs proxy") {
      return {
        blocking: "needs proxy: start runtime",
        explanation: "some rules need the proxy runtime.",
        fix: "Click 'Start runtime'.",
      };
    }
    if (blocking === "needs permission") {
      return {
        blocking: "needs permission: grant declared access",
        explanation: "some rules need permission.",
        fix: "Click 'Grant declared access' after reviewing origins.",
      };
    }
    return {
      blocking: "unsupported rules: no action available",
      explanation: "some rules are unsupported in this browser.",
      fix: "",
    };
  }
  return null;
}

function countGroups(value: unknown): number {
  return isProjectRecord(value) && Array.isArray(value.groups)
    ? value.groups.length
    : 0;
}

function countRules(value: unknown): number {
  if (!isProjectRecord(value) || !Array.isArray(value.groups)) return 0;
  let total = 0;
  for (const group of value.groups) {
    if (isProjectRecord(group) && Array.isArray(group.rules)) {
      total += group.rules.length;
    }
  }
  return total;
}

function renderTopbar(shell: HTMLElement): void {
  const topbar = document.createElement("header");
  topbar.className = "rogatio-topbar";
  const heading = document.createElement("h1");
  heading.id = "rogatio-title";
  heading.textContent = "Rogatio";
  topbar.append(heading);

  const tabs = document.createElement("div");
  tabs.className = "rogatio-tabs";
  for (const tab of ["dashboard", "workspace"] as const) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.textContent = tab === "dashboard" ? "Dashboard" : "Workspace";
    tabButton.dataset.tab = tab;
    if (activeTab === tab) tabButton.setAttribute("aria-current", "true");
    tabs.append(tabButton);
  }
  topbar.append(tabs);

  const actions = document.createElement("div");
  actions.className = "rogatio-topbar-actions";
  actions.append(
    button("Refresh", "refresh"),
    button("Export project", "export"),
    button("Remove project", "remove"),
  );
  const badge = document.createElement("span");
  badge.dataset.badgeState = "true";
  badge.className = "rogatio-badge-pill";
  const attention = attentionFromStatuses();
  const attentionText = state.badge?.attention ? " (attention needed)" : "";
  const attentionReason =
    attention !== null && state.ruleStatuses ? ` — ${attention.blocking}` : "";
  badge.textContent = state.badge
    ? `Active rules: ${state.badge.text}${attentionText}${attentionReason}`
    : `Active rules: 0${attentionText}${attentionReason}`;
  actions.append(badge);
  topbar.append(actions);
  shell.append(topbar);
}

function renderSidebar(shell: HTMLElement): void {
  const sidebar = document.createElement("aside");
  sidebar.className = "rogatio-sidebar";

  const activeProject = state.activeProjectId
    ? state.projects[state.activeProjectId]
    : undefined;
  if (activeProject && isProjectRecord(activeProject.data)) {
    const projectCard = document.createElement("div");
    projectCard.className = "rogatio-project-card";
    projectCard.dataset.activeProjectCard = "true";
    const title = document.createElement("p");
    title.className = "rogatio-project-card-title";
    title.textContent = text(activeProject.data.name, activeProject.id);
    const status = document.createElement("p");
    status.className = "rogatio-project-status";
    status.textContent = "Active project";
    projectCard.append(title, status);
    sidebar.append(projectCard);
  }

  const selectorLabel = document.createElement("label");
  selectorLabel.textContent = "Project to switch";
  const selector = document.createElement("select");
  selector.dataset.projectSelector = "true";
  const ids = Object.keys(state.projects).sort();
  for (const id of ids) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text(state.projects[id]?.name, id);
    selector.append(option);
  }
  if (ids.length > 0) {
    selector.value = pendingProjectId ?? state.activeProjectId ?? ids[0];
  }
  selectorLabel.append(selector);
  sidebar.append(selectorLabel);

  const actions = document.createElement("div");
  actions.className = "rogatio-sidebar-actions";
  actions.append(
    button("Switch project", "switch"),
    button("Import project", "import"),
    button("Review permissions", "review-permissions"),
    button(
      permissionGranted ? "Access granted" : "Grant declared access",
      "grant-permissions",
    ),
    button("Start runtime", "start-native-runtime"),
    button("Stop runtime", "stop-native-runtime"),
  );
  sidebar.append(actions);

  // Runtime status sits directly under the Start/Stop controls so the current
  // phase is always visible next to the actions that change it.
  const nativeRuntime = document.createElement("p");
  nativeRuntime.dataset.nativeRuntimeState = "true";
  nativeRuntime.className = `rogatio-runtime-status ${runtimeStatusTone()}`;
  nativeRuntime.textContent = `Runtime status: ${runtimeStatusText()}`;
  sidebar.append(nativeRuntime);

  // The browser-assigned extension ID is what `rogatio runtime install` pins
  // in the native-messaging manifest; always show it so the install step
  // never requires hunting through chrome://extensions.
  const extensionIdLine = document.createElement("p");
  extensionIdLine.dataset.extensionId = "true";
  extensionIdLine.className = "rogatio-extension-id";
  extensionIdLine.textContent = `Extension ID: ${extensionId() || "unknown"}`;
  sidebar.append(extensionIdLine);

  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".json,.rogatio.json,application/json";
  importInput.hidden = true;
  importInput.dataset.importInput = "true";
  sidebar.append(importInput);

  if (permissionOrigins.length > 0) {
    const permissionSummary = document.createElement("p");
    permissionSummary.dataset.permissionSummary = "true";
    permissionSummary.textContent = permissionGranted
      ? `Declared access granted: ${permissionOrigins.join(", ")}`
      : `Declared access needed: ${permissionOrigins.join(", ")}`;
    sidebar.append(permissionSummary);
  }

  if (activeProject && isProjectRecord(activeProject.data)) {
    const groups = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Group activation";
    groups.append(legend);
    const enabled = new Set(activeProject.enabledGroupIds);
    const sourceGroups = Array.isArray(activeProject.data.groups)
      ? activeProject.data.groups
      : [];
    for (const group of sourceGroups) {
      if (!isProjectRecord(group) || typeof group.id !== "string") continue;
      const label = document.createElement("label");
      label.className = enabled.has(group.id)
        ? "rogatio-group-label rogatio-group-active"
        : "rogatio-group-label rogatio-group-inactive";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = enabled.has(group.id);
      checkbox.dataset.groupId = group.id;
      checkbox.dataset.groupToggle = "true";
      label.append(
        checkbox,
        document.createTextNode(text(group.name, group.id)),
      );
      groups.append(label);
    }
    sidebar.append(groups);
  }

  const attention = attentionFromStatuses();
  if (attention !== null) {
    const attentionNote = document.createElement("p");
    attentionNote.className = "rogatio-attention-note";
    const noteParts = [attention.explanation, attention.fix].filter(
      (part) => part.length > 0,
    );
    attentionNote.textContent = `Attention needed: ${noteParts.join(" ")}`;
    sidebar.append(attentionNote);
  }

  const ruleStatuses = document.createElement("ul");
  ruleStatuses.dataset.ruleStatuses = "true";
  for (const ruleStatus of state.ruleStatuses ?? []) {
    const item = document.createElement("li");
    const groupId = text(ruleStatus.groupId, "unknown group");
    const ruleId = text(ruleStatus.ruleId, "unknown rule");
    const statusValue = text(ruleStatus.status, "error");
    item.textContent = `${groupId}/${ruleId}: ${statusValue}`;
    ruleStatuses.append(item);
  }
  sidebar.append(ruleStatuses);

  shell.append(sidebar);
}

function renderOverview(shell: HTMLElement): void {
  const overview = document.createElement("section");
  overview.dataset.overview = "true";
  overview.className = "rogatio-overview";

  const heading = document.createElement("h2");
  heading.textContent = "Projects";
  const subtitle = document.createElement("p");
  subtitle.className = "rogatio-overview-subtitle";
  subtitle.textContent =
    "Manage your active modification rules and mock environments.";
  overview.append(heading, subtitle);

  const grid = document.createElement("div");
  grid.className = "rogatio-project-grid";
  const ids = Object.keys(state.projects).sort();
  for (const id of ids) {
    const project = state.projects[id];
    if (!project) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "rogatio-project-card";
    card.dataset.projectCard = "true";
    card.dataset.projectId = id;
    if (state.activeProjectId === id) card.dataset.active = "true";

    const title = document.createElement("p");
    title.className = "rogatio-project-card-title";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = text(project.name, id);
    title.append(nameSpan);
    card.append(title);

    const status = document.createElement("span");
    status.dataset.projectStatus = "true";
    status.className = "rogatio-project-status";
    status.textContent =
      state.activeProjectId === id ? "Active Runtime" : "Idle";
    card.append(status);

    const stats = document.createElement("div");
    stats.className = "rogatio-project-stats";
    const groups = countGroups(project.data);
    const rules = countRules(project.data);
    const enabled = project.enabledGroupIds.length;
    const statRow = (label: string, selector: string, value: string) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const count = document.createElement("span");
      count.dataset[selector] = "true";
      count.textContent = value;
      row.append(name, count);
      return row;
    };
    stats.append(
      statRow("Groups", "projectGroups", String(groups)),
      statRow("Rules", "projectRules", String(rules)),
      statRow("Enabled", "projectEnabled", `${enabled} of ${groups}`),
    );
    card.append(stats);

    const footer = document.createElement("div");
    footer.className = "rogatio-project-footer";
    const projectId = document.createElement("span");
    projectId.dataset.projectIdLabel = "true";
    projectId.textContent = `ID: ${id}`;
    footer.append(projectId);
    const actions = document.createElement("span");
    actions.className = "rogatio-project-actions";
    const exportAction = document.createElement("button");
    exportAction.type = "button";
    exportAction.textContent = "Export";
    exportAction.dataset.command = "export";
    exportAction.dataset.projectAction = id;
    const removeAction = document.createElement("button");
    removeAction.type = "button";
    removeAction.textContent = "Remove";
    removeAction.dataset.command = "remove";
    removeAction.dataset.projectAction = id;
    actions.append(exportAction, removeAction);
    footer.append(actions);
    card.append(footer);
    grid.append(card);
  }

  const createCard = document.createElement("button");
  createCard.type = "button";
  createCard.className = "rogatio-create-project";
  createCard.dataset.createProject = "true";
  const icon = document.createElement("span");
  icon.className = "rogatio-create-icon";
  icon.textContent = "+";
  const createTitle = document.createElement("span");
  createTitle.className = "rogatio-create-title";
  createTitle.textContent = "Create New Project";
  const hint = document.createElement("span");
  hint.className = "rogatio-create-hint";
  hint.textContent = "Setup a new environment for rules and mocks.";
  createCard.append(icon, createTitle, hint);
  grid.append(createCard);

  overview.append(grid);
  shell.append(overview);
}

function renderShell(): void {
  editor?.destroy();
  editor = undefined;
  root.replaceChildren();
  const shell = document.createElement("section");
  shell.className = "rogatio-shell";
  shell.setAttribute("aria-labelledby", "rogatio-title");

  renderTopbar(shell);

  const layout = document.createElement("div");
  layout.className = "rogatio-layout";
  renderSidebar(layout);

  const main = document.createElement("main");
  main.className = "rogatio-main";
  const status = document.createElement("p");
  status.className = "rogatio-status";
  status.setAttribute("role", "status");
  status.textContent = statusMessage;
  main.append(status);
  if (installCommand) {
    const row = document.createElement("div");
    row.className = "rogatio-install-command";
    const code = document.createElement("code");
    code.dataset.installCommand = "true";
    code.textContent = installCommand;
    row.append(code, button("Copy install command", "copy-install-command"));
    main.append(row);
  }

  if (activeTab === "dashboard") {
    renderOverview(main);
  } else {
    const editorRoot = document.createElement("div");
    editorRoot.dataset.editorRoot = "true";
    main.append(editorRoot);
  }
  layout.append(main);
  shell.append(layout);
  root.append(shell);

  // Tab switching
  shell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tab = target.dataset.tab;
    if (tab === "dashboard" || tab === "workspace") {
      activeTab = tab;
      renderShell();
      return;
    }
    const command = target.dataset.command;
    if (command === "refresh") void refresh();
    if (command === "switch") void switchProject();
    if (command === "create") void createProject();
    if (command === "import") importInput().click();
    if (command === "copy-install-command") void copyInstallCommand();
    if (command === "review-permissions") void reviewPermissions();
    if (command === "grant-permissions") void grantPermissions();
    if (command === "start-native-runtime")
      void nativeRuntimeCommand("start-native-runtime");
    if (command === "stop-native-runtime")
      void nativeRuntimeCommand("stop-native-runtime");
    if (command === "export") {
      const projectId = target.dataset.projectAction ?? pendingProjectId;
      if (projectId) pendingProjectId = projectId;
      void exportProject();
    }
    if (command === "remove") {
      const projectId = target.dataset.projectAction ?? pendingProjectId;
      if (projectId) pendingProjectId = projectId;
      void removeProject();
    }
  });

  const selector = shell.querySelector<HTMLSelectElement>(
    "[data-project-selector]",
  );
  selector?.addEventListener("change", () => {
    pendingProjectId = selector.value;
    statusMessage = `Selected ${text(
      state.projects[pendingProjectId]?.name,
      pendingProjectId ?? "",
    )}. Choose Switch project to activate it.`;
    renderShell();
  });

  const overview = shell.querySelector<HTMLElement>("[data-overview]");
  overview?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const createCardEl = target.closest<HTMLElement>("[data-create-project]");
    if (createCardEl) {
      void createProject();
      return;
    }
    if (target.dataset.command) return; // action buttons handled at shell level
    const card = target.closest<HTMLElement>("[data-project-card]");
    if (!card?.dataset.projectId) return;
    if (card.dataset.projectId === state.activeProjectId) {
      activeTab = "workspace";
      renderShell();
      return;
    }
    pendingProjectId = card.dataset.projectId;
    await switchProject();
    activeTab = "workspace";
    statusMessage = `Opened ${text(
      state.projects[pendingProjectId]?.name,
      pendingProjectId,
    )}.`;
    renderShell();
  });

  const importControl = shell.querySelector<HTMLInputElement>(
    "[data-import-input]",
  );
  importControl?.addEventListener(
    "change",
    () => void importProject(importControl),
  );
  shell.addEventListener("change", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.dataset.groupToggle !== "true"
    )
      return;
    void setGroupEnabled(target.dataset.groupId ?? "", target.checked);
  });

  if (activeTab === "workspace" && ids().length > 0) {
    const editorRoot = shell.querySelector<HTMLElement>("[data-editor-root]");
    if (editorRoot) {
      editor = createEditor({
        root: editorRoot,
        ruleTypes: [
          createRedirectRuleType(),
          createMockRuleType(),
          createResponseBodyRuleType(),
        ],
        initialProject: safeProjectData(),
        validate(value) {
          const result = validateProjectDetailed(value);
          if (result.valid) return [];
          return result.errors.map((error) => ({
            code: `schema.${error.keyword}`,
            severity: "error" as const,
            path: error.instancePath,
            message: "The project contains invalid data.",
          }));
        },
        save: async (draft) => {
          if (!state.activeProjectId)
            return { ok: false, code: "extension.not-found" };
          const response = await client.send({
            version: 1,
            command: "save-project",
            projectId: state.activeProjectId,
            expectedRevision: state.projects[state.activeProjectId]?.revision,
            data: draft,
          });
          if (response?.ok === true) {
            await refresh();
            return { ok: true };
          }
          return {
            ok: false,
            code: response?.diagnostic?.code ?? "extension.storage-failed",
            message:
              response?.diagnostic?.code === "extension.conflict"
                ? "The committed project changed. Refresh before saving."
                : "The project could not be saved.",
          };
        },
      });
      if (deepLinkGroup) editor.navigateToGroup(deepLinkGroup);
    }
  }
}

function importInput(): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>("[data-import-input]");
  if (input) return input;
  const created = document.createElement("input");
  created.type = "file";
  created.accept = ".json,.rogatio.json,application/json";
  created.hidden = true;
  created.dataset.importInput = "true";
  created.addEventListener("change", () => void importProject(created));
  root.append(created);
  return created;
}

function ids(): readonly string[] {
  return Object.keys(state.projects).sort();
}

function isProjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function createProject(): Promise<void> {
  const name = window.prompt("Project name", "New Rogatio project")?.trim();
  if (!name) return;
  const response = await client.send({
    version: 1,
    command: "create-project",
    data: { version: 1, name, groups: [] },
  });
  statusMessage =
    response.ok === true
      ? "Project created."
      : "The project could not be created.";
  await refresh();
}

async function importProject(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as unknown;
    const response = await client.send({
      version: 1,
      command: "import-project",
      data,
    });
    statusMessage =
      response.ok === true
        ? "Project imported."
        : "The project could not be imported.";
  } catch {
    statusMessage = "The selected file is not valid JSON.";
  }
  await refresh();
}

async function reviewPermissions(): Promise<void> {
  const projectId = state.activeProjectId;
  if (!projectId) return;
  const response = await client.send({
    version: 1,
    command: "review-permissions",
    projectId,
  });
  if (response.ok !== true || !isProjectRecord(response.value)) {
    statusMessage = "Declared permissions could not be reviewed.";
    renderShell();
    return;
  }
  if (isProjectRecord(response.value.state)) {
    state = response.value.state as unknown as Envelope;
  }
  permissionOrigins = Array.isArray(response.value.origins)
    ? response.value.origins.filter(
        (origin): origin is string => typeof origin === "string",
      )
    : [];
  permissionGranted = response.value.granted === true;
  statusMessage = "Permissions reviewed.";
  renderShell();
}

async function grantPermissions(): Promise<void> {
  const projectId = state.activeProjectId;
  if (!projectId) return;
  if (permissionOrigins.length === 0) await reviewPermissions();
  if (permissionOrigins.length === 0) return;
  // chrome.permissions.request must run inside a user gesture, which is lost
  // across the runtime message round trip to the service worker. The page
  // therefore owns the exact-origin request and asks the worker to re-sync
  // stored grants from the actual permission state afterwards.
  const origins = permissionOrigins.map((origin) =>
    origin.endsWith("/") ? origin : `${origin}/*`,
  );
  const granted = await chrome.permissions.request({ origins });
  permissionGranted = granted;
  statusMessage = granted
    ? "Declared access granted."
    : "Declared access was not granted.";
  if (granted && projectId) {
    await client.send({
      version: 1,
      command: "grant-permissions",
      projectId,
      origins: permissionOrigins,
      granted: true,
    });
  }
  await refresh();
}

async function setGroupEnabled(
  groupId: string,
  enabled: boolean,
): Promise<void> {
  if (!state.activeProjectId || !groupId) return;
  const response = await client.send({
    version: 1,
    command: "set-group-enabled",
    projectId: state.activeProjectId,
    groupId,
    enabled,
  });
  statusMessage =
    response.ok === true
      ? enabled
        ? "Group activated."
        : "Group deactivated."
      : "The group activation could not be changed.";
  await refresh();
}

async function nativeRuntimeCommand(
  command: "start-native-runtime" | "stop-native-runtime",
): Promise<void> {
  const response = await client.send({ version: 1, command });
  const code = response?.diagnostic?.code;
  installCommand = null;
  if (response?.ok === true) {
    statusMessage =
      command === "start-native-runtime"
        ? "Runtime started."
        : "Runtime stopped.";
  } else if (code === "extension.native-host-missing") {
    const id = extensionId();
    if (id.length > 0) {
      installCommand = `rogatio runtime install --extension-id ${id}`;
      statusMessage =
        "The native runtime host is not installed on this device. Run the install command below once in a terminal, then click Start runtime again.";
    } else {
      statusMessage =
        "The native runtime host is not installed on this device. Run `rogatio runtime install --extension-id <extension ID>` once in a terminal, then click Start runtime again.";
    }
  } else if (code === "extension.native-runtime-unavailable") {
    statusMessage = "Runtime action unavailable on this platform.";
  } else {
    statusMessage =
      "The runtime action failed. Check the runtime status in the sidebar and try again.";
  }
  await refresh();
}

async function copyInstallCommand(): Promise<void> {
  if (!installCommand) return;
  statusMessage = (await copyText(installCommand))
    ? "Install command copied. Paste it in a terminal, run it, then click Start runtime again."
    : "Copying failed. Select the command text and copy it manually.";
  await refresh();
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API can be unavailable in some contexts; fall back to a
    // selection-based copy on a temporary textarea.
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

async function refresh(): Promise<void> {
  const response = await client.send({ version: 1, command: "refresh" });
  if (response?.ok !== true || !response.value) {
    statusMessage = "The project state could not be refreshed.";
    renderShell();
    return;
  }
  const previousActiveProjectId = state.activeProjectId;
  state = response.value as Envelope;
  if (previousActiveProjectId !== state.activeProjectId) {
    permissionOrigins = [];
    permissionGranted = false;
  }
  if (pendingProjectId && !Object.hasOwn(state.projects, pendingProjectId))
    pendingProjectId = state.activeProjectId;
  renderShell();
}

async function switchProject(): Promise<void> {
  if (!pendingProjectId || pendingProjectId === state.activeProjectId) return;
  const response = await client.send({
    version: 1,
    command: "switch-project",
    projectId: pendingProjectId,
  });
  if (response?.ok !== true) {
    statusMessage =
      response?.diagnostic?.code === "extension.conflict"
        ? "The committed project changed. Choose Refresh to continue."
        : "The project could not be switched. Refresh and try again.";
    renderShell();
    return;
  }
  statusMessage = "Project switched.";
  await refresh();
}

async function exportProject(): Promise<void> {
  const projectId = pendingProjectId ?? state.activeProjectId;
  if (!projectId) return;
  const response = await client.send({
    version: 1,
    command: "export-project",
    projectId,
  });
  if (response?.ok !== true) {
    statusMessage = "The project could not be exported.";
    renderShell();
    return;
  }
  const blob = new Blob([JSON.stringify(response.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${text(state.projects[projectId]?.name, "rogatio")}.rogatio.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  statusMessage = "Project exported.";
  renderShell();
}

async function removeProject(): Promise<void> {
  const projectId = pendingProjectId ?? state.activeProjectId;
  if (!projectId) return;
  const name = text(state.projects[projectId]?.name, projectId);
  if (!window.confirm(`Remove project ${name}?`)) return;
  const response = await client.send({
    version: 1,
    command: "remove-project",
    projectId,
    confirm: true,
  });
  if (response?.ok !== true) {
    statusMessage = "The project could not be removed.";
    renderShell();
    return;
  }
  pendingProjectId = null;
  statusMessage = `Project ${name} removed.`;
  await refresh();
}

// Deep links from the popup open the workspace editor at the group.
const deepLinkGroup = new URLSearchParams(window.location.search).get("group");
if (deepLinkGroup) activeTab = "workspace";
void refresh();
