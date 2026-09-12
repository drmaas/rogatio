import {
  createEditor,
  createMockRuleType,
  createRedirectRuleType,
  createResponseBodyRuleType,
  type EditorController,
} from "@rogatio/editor";
import { validateProjectDetailed } from "./browser-schema.js";
import {
  checkAISupport,
  type NativeEnvelope,
  type NativeSessionOptions,
} from "./native-session.js";

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
  readonly nativeRuntimeError?: string | null;
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
/** AI support status from native host */
let aiSupported = false;
let aiStatusChecked = false;
let aiPromptOpen = false;
let aiBusy = false;
let aiPreview: unknown | null = null;
let aiMessage = "";
/** Diagnostics modal state */
let diagnosticsOpen = false;
let diagnosticsData: {
  phase: string;
  extensionId: string | null;
  hostName: string;
  chromeError: string | null;
  runtimeError: string | null;
  connectNativeAvailable: boolean;
  timestamp: number;
} | null = null;

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

function runtimeRecoveryText(): string {
  const error = state.nativeRuntimeError?.toLowerCase() ?? "";
  if (error.includes("native-host-missing")) {
    return "Install the host using the command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (error.includes("host")) {
    return "Re-run the install command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (
    error.includes("trust") ||
    error.includes("certificate") ||
    error.includes("ca")
  ) {
    return "Run the install command below to register the host and trust the device-local CA, then restart Chrome and click Start runtime again.";
  }
  if ((state.nativeRuntimeState?.phase ?? "stopped") === "unsupported") {
    return "This device cannot provide the capabilities required by the selected runtime rules. You can still edit and verify the project.";
  }
  return "Open Show diagnostics for the concrete host error. After correcting it, click Start runtime again.";
}

/**
 * The blocking status behind the badge's attention flag, derived from the
 * actual rule statuses (REQ-GAV-004) with the shared f21 precedence
 * (error > unsupported > needs permission). The badge and the
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
  "needs permission",
  "needs runtime",
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
        fix: "Re-activate the group, or restart the native runtime.",
      };
    }
    if (blocking === "needs permission") {
      return {
        blocking: "needs permission: grant declared access",
        explanation: "some rules need permission.",
        fix: "Click 'Grant declared access' after reviewing origins.",
      };
    }
    if (blocking === "needs runtime") {
      return {
        blocking: "needs runtime: start the native runtime",
        explanation: "some rules need the native runtime.",
        fix: "Click 'Start runtime'.",
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
  if (activeTab === "workspace") {
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
      attention !== null && state.ruleStatuses
        ? ` — ${attention.blocking}`
        : "";
    badge.textContent = state.badge
      ? `Active rules: ${state.badge.text}${attentionText}${attentionReason}`
      : `Active rules: 0${attentionText}${attentionReason}`;
    actions.append(badge);
    topbar.append(actions);
  }
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

  const actions = document.createElement("div");
  actions.className = "rogatio-sidebar-actions";
  actions.append(
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

  // Show diagnostics button when runtime failed or is unsupported
  const runtimePhase = state.nativeRuntimeState?.phase ?? "stopped";
  if (runtimePhase === "failed" || runtimePhase === "unsupported") {
    sidebar.append(button("Show diagnostics", "show-diagnostics"));
  }

  // AI status - check if native host supports AI
  const aiStatus = document.createElement("p");
  aiStatus.dataset.aiStatus = "true";
  aiStatus.className = "rogatio-ai-status";
  if (aiSupported) {
    aiStatus.textContent = "AI: Ready";
    aiStatus.className += " rogatio-ai-ready";
  } else if (state.nativeRuntimeState?.phase !== "started") {
    aiStatus.textContent = "AI: needs runtime";
    aiStatus.className += " rogatio-ai-needs-runtime";
  } else if (state.nativeRuntimeState?.phase === "started" && aiStatusChecked) {
    aiStatus.textContent = "AI: Not configured";
    aiStatus.className += " rogatio-ai-not-configured";
  } else {
    aiStatus.textContent = "AI: Not configured";
    aiStatus.className += " rogatio-ai-not-configured";
  }
  sidebar.append(aiStatus);

  // The browser-assigned extension ID is what `rogatio runtime install` pins
  // in the native-messaging manifest; always show it so the install step
  // never requires hunting through chrome://extensions.
  const extensionIdRow = document.createElement("div");
  extensionIdRow.className = "rogatio-extension-id-row";
  const extensionIdLine = document.createElement("p");
  extensionIdLine.dataset.extensionId = "true";
  extensionIdLine.className = "rogatio-extension-id";
  extensionIdLine.textContent = `Extension ID: ${extensionId() || "unknown"}`;
  const copyId = button("⧉", "copy-extension-id");
  copyId.className = "rogatio-copy-icon";
  copyId.setAttribute("aria-label", "Copy extension ID");
  copyId.title = "Copy extension ID";
  extensionIdRow.append(extensionIdLine, copyId);
  sidebar.append(extensionIdRow);

  const runtimeError = state.nativeRuntimeError;
  if (
    (runtimePhase === "failed" || runtimePhase === "unsupported") &&
    runtimeError
  ) {
    const runtimeErrorLine = document.createElement("p");
    runtimeErrorLine.dataset.runtimeError = "true";
    runtimeErrorLine.className = "rogatio-runtime-error";
    runtimeErrorLine.textContent = `Runtime error: ${runtimeError}`;
    sidebar.append(runtimeErrorLine);
  }

  // Project switching and import are dashboard actions. Workspace controls
  // operate only on the committed active project.

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
  subtitle.textContent = "Manage your active modification rules.";
  overview.append(heading, subtitle);

  const ids = Object.keys(state.projects).sort();
  const grid = document.createElement("div");
  grid.className = "rogatio-project-grid";
  for (const id of ids) {
    const project = state.projects[id];
    if (!project) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "rogatio-project-card";
    card.dataset.projectCard = "true";
    card.dataset.projectId = id;
    const phase = state.nativeRuntimeState?.phase ?? "stopped";
    const isStarted = phase === "started";
    if (state.activeProjectId === id && isStarted) card.dataset.active = "true";

    const title = document.createElement("p");
    title.className = "rogatio-project-card-title";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = text(project.name, id);
    title.append(nameSpan);
    card.append(title);

    const status = document.createElement("span");
    status.dataset.projectStatus = "true";
    status.className = "rogatio-project-status";
    const isActive = state.activeProjectId === id;
    if (isActive && isStarted) {
      status.textContent = "Active Runtime";
    } else if (isActive && (phase === "failed" || phase === "error")) {
      status.textContent = "Runtime failed";
    } else if (isActive && phase === "unsupported") {
      status.textContent = "Runtime unavailable";
    } else if (isActive && phase === "starting") {
      status.textContent = "Runtime starting";
    } else {
      status.textContent = "Idle";
    }
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
    card.append(footer);
    grid.append(card);
  }

  const creationGrid = document.createElement("div");
  creationGrid.className = "rogatio-creation-grid";

  const creationSection = document.createElement("section");
  creationSection.className = "rogatio-dashboard-card rogatio-create-section";
  creationSection.dataset.dashboardSection = "create";
  const creationHeading = document.createElement("div");
  creationHeading.className = "rogatio-dashboard-section-heading";
  const creationTitle = document.createElement("h3");
  creationTitle.textContent = "Start a project";
  const creationHint = document.createElement("p");
  creationHint.textContent = "Choose how you want to begin.";
  creationHeading.append(creationTitle, creationHint);
  creationSection.append(creationHeading, creationGrid);

  const createNewCard = document.createElement("button");
  createNewCard.type = "button";
  createNewCard.className = "rogatio-create-project";
  createNewCard.dataset.command = "create";
  const createNewIcon = document.createElement("span");
  createNewIcon.className = "rogatio-create-icon";
  createNewIcon.textContent = "+";
  const createNewTitle = document.createElement("span");
  createNewTitle.className = "rogatio-create-title";
  createNewTitle.textContent = "Create New Project";
  const createNewHint = document.createElement("span");
  createNewHint.className = "rogatio-create-hint";
  createNewHint.textContent = "Start with a clean project for rules.";
  createNewCard.append(createNewIcon, createNewTitle, createNewHint);
  creationGrid.append(createNewCard);

  const importCard = document.createElement("button");
  importCard.type = "button";
  importCard.className = "rogatio-create-project";
  importCard.dataset.command = "import";
  const importIcon = document.createElement("span");
  importIcon.className = "rogatio-create-icon";
  importIcon.textContent = "↥";
  const importTitle = document.createElement("span");
  importTitle.className = "rogatio-create-title";
  importTitle.textContent = "Import Project";
  const importHint = document.createElement("span");
  importHint.className = "rogatio-create-hint";
  importHint.textContent = "Open a .rogatio.json project from your device.";
  importCard.append(importIcon, importTitle, importHint);
  creationGrid.append(importCard);

  const dashboardImportInput = document.createElement("input");
  dashboardImportInput.type = "file";
  dashboardImportInput.accept = ".json,.rogatio.json,application/json";
  dashboardImportInput.hidden = true;
  dashboardImportInput.dataset.importInput = "true";
  overview.append(dashboardImportInput);

  const aiCard = document.createElement("button");
  aiCard.type = "button";
  aiCard.className = "rogatio-create-project rogatio-create-ai";
  aiCard.dataset.command = "ai-generate";
  aiCard.disabled = !aiSupported;
  aiCard.setAttribute("aria-describedby", "rogatio-ai-create-hint");
  const aiIcon = document.createElement("span");
  aiIcon.className = "rogatio-create-icon";
  aiIcon.textContent = "✦";
  const aiTitle = document.createElement("span");
  aiTitle.className = "rogatio-create-title";
  aiTitle.textContent = "Create using AI";
  const aiHint = document.createElement("span");
  aiHint.className = "rogatio-create-hint";
  aiHint.id = "rogatio-ai-create-hint";
  aiHint.textContent = aiSupported
    ? "Describe the project you want to build."
    : "Start the native runtime and configure AI to enable generation.";
  aiCard.append(aiIcon, aiTitle, aiHint);
  creationGrid.append(aiCard);

  if (aiPromptOpen) {
    const composer = document.createElement("section");
    composer.className = "rogatio-ai-composer";
    composer.setAttribute("aria-labelledby", "rogatio-ai-heading");
    const aiHeading = document.createElement("h3");
    aiHeading.id = "rogatio-ai-heading";
    aiHeading.textContent =
      aiPreview === null ? "Describe your project" : "Review generated project";
    composer.append(aiHeading);

    if (aiPreview === null) {
      const form = document.createElement("form");
      form.dataset.aiForm = "true";
      const label = document.createElement("label");
      label.htmlFor = "rogatio-ai-prompt";
      label.textContent = "What should Rogatio create?";
      const prompt = document.createElement("textarea");
      prompt.id = "rogatio-ai-prompt";
      prompt.name = "prompt";
      prompt.required = true;
      prompt.maxLength = 4000;
      prompt.rows = 4;
      prompt.placeholder =
        "For example: redirect example.com/docs to the new guide...";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.disabled = aiBusy;
      submit.textContent = aiBusy ? "Generating…" : "Generate preview";
      const cancel = button("Cancel", "ai-cancel");
      form.append(label, prompt, submit, cancel);
      composer.append(form);
    } else {
      const preview = document.createElement("div");
      preview.className = "rogatio-ai-preview";
      const name = document.createElement("strong");
      name.textContent = text(
        isProjectRecord(aiPreview) ? aiPreview.name : undefined,
        "Generated project",
      );
      const summary = document.createElement("p");
      summary.textContent = `${countGroups(aiPreview)} groups, ${countRules(aiPreview)} rules. This preview has not been saved.`;
      preview.append(name, summary);
      const create = button("Create project", "ai-create");
      const cancel = button("Cancel", "ai-cancel");
      composer.append(preview, create, cancel);
    }
    if (aiMessage.length > 0) {
      const message = document.createElement("p");
      message.className = "rogatio-ai-message";
      message.setAttribute("role", "status");
      message.textContent = aiMessage;
      composer.append(message);
    }
    creationSection.append(composer);
  }

  const projectsSection = document.createElement("section");
  projectsSection.className = "rogatio-dashboard-card rogatio-projects-section";
  projectsSection.dataset.dashboardSection = "projects";
  const projectsHeading = document.createElement("div");
  projectsHeading.className = "rogatio-dashboard-section-heading";
  const projectsCopy = document.createElement("div");
  const projectsTitle = document.createElement("h3");
  projectsTitle.textContent = "Your projects";
  const projectsHint = document.createElement("p");
  projectsHint.textContent =
    ids.length === 0
      ? "Your saved projects will appear here."
      : "Select a project to open it in Workspace.";
  projectsCopy.append(projectsTitle, projectsHint);

  const projectActions = document.createElement("div");
  projectActions.className = "rogatio-dashboard-section-actions";
  const selectorLabel = document.createElement("label");
  selectorLabel.textContent = "Project to switch";
  const selector = document.createElement("select");
  selector.dataset.projectSelector = "true";
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
  projectActions.append(selectorLabel, button("Switch project", "switch"));
  projectsHeading.append(projectsCopy, projectActions);
  projectsSection.append(projectsHeading, grid);

  overview.append(creationSection, projectsSection);
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
  layout.dataset.view = activeTab;
  if (activeTab === "workspace") renderSidebar(layout);

  const main = document.createElement("main");
  main.className = "rogatio-main";
  const status = document.createElement("p");
  status.className = "rogatio-status";
  status.setAttribute("role", "status");
  status.textContent = statusMessage;
  main.append(status);

  const runtimePhase = state.nativeRuntimeState?.phase ?? "stopped";
  if (
    activeTab === "workspace" &&
    (runtimePhase === "failed" || runtimePhase === "unsupported")
  ) {
    const guidance = document.createElement("section");
    guidance.className = "rogatio-runtime-guidance";
    guidance.dataset.runtimeGuidance = "true";
    const guidanceTitle = document.createElement("h2");
    guidanceTitle.textContent = "Runtime needs attention";
    const guidanceError = document.createElement("p");
    guidanceError.className = "rogatio-runtime-guidance-error";
    guidanceError.textContent = state.nativeRuntimeError
      ? `Error: ${state.nativeRuntimeError}`
      : `Status: ${runtimeStatusText()}`;
    const guidanceFix = document.createElement("p");
    guidanceFix.textContent = runtimeRecoveryText();
    guidance.append(guidanceTitle, guidanceError, guidanceFix);
    if (runtimePhase === "failed") {
      const id = extensionId();
      const cmd =
        id.length > 0
          ? `rogatio runtime install --extension-id ${id}`
          : installCommand;
      if (cmd) {
        const guidanceCommand = document.createElement("code");
        guidanceCommand.dataset.runtimeInstallCommand = "true";
        guidanceCommand.textContent = cmd;
        guidance.append(
          guidanceCommand,
          button("Copy install command", "copy-install-command"),
        );
      }
    }
    main.append(guidance);
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

  // Render diagnostics modal if open
  if (diagnosticsOpen && diagnosticsData) {
    renderDiagnosticsModal(root);
  }

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
    const commandTarget = target.closest<HTMLElement>("[data-command]");
    const command = commandTarget?.dataset.command;
    if (command === "refresh") void refresh();
    if (command === "switch") void switchProject();
    if (command === "create") void createProject();
    if (command === "import") importInput().click();
    if (command === "ai-generate") openAIComposer();
    if (command === "ai-cancel") cancelAIComposer();
    if (command === "ai-create") void createGeneratedProject();
    if (command === "copy-install-command") void copyInstallCommand();
    if (command === "copy-extension-id") void copyExtensionId();
    if (command === "review-permissions") void reviewPermissions();
    if (command === "grant-permissions") void grantPermissions();
    if (command === "start-native-runtime")
      void nativeRuntimeCommand("start-native-runtime");
    if (command === "stop-native-runtime")
      void nativeRuntimeCommand("stop-native-runtime");
    if (command === "show-diagnostics") void showDiagnostics();
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

  const aiForm = shell.querySelector<HTMLFormElement>("[data-ai-form]");
  aiForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt =
      aiForm.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
    void generateProject(prompt);
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

function openAIComposer(): void {
  if (!aiSupported) return;
  aiPromptOpen = true;
  aiPreview = null;
  aiMessage = "";
  renderShell();
  root.querySelector<HTMLTextAreaElement>("#rogatio-ai-prompt")?.focus();
}

function cancelAIComposer(): void {
  aiPromptOpen = false;
  aiBusy = false;
  aiPreview = null;
  aiMessage = "";
  renderShell();
}

async function generateProject(prompt: string): Promise<void> {
  aiBusy = true;
  aiMessage = "";
  renderShell();
  const response = await client.send({
    version: 1,
    command: "generate-project",
    prompt,
  });
  aiBusy = false;
  if (response.ok === true && response.value !== undefined) {
    aiPreview = response.value;
    aiMessage = "Review the safe preview before saving it.";
  } else {
    aiMessage =
      "AI could not generate a valid project. Check the runtime and try again.";
  }
  renderShell();
}

async function createGeneratedProject(): Promise<void> {
  if (aiPreview === null) return;
  const response = await client.send({
    version: 1,
    command: "import-project",
    data: aiPreview,
  });
  if (response.ok === true) {
    statusMessage = "AI project created.";
    aiPromptOpen = false;
    aiPreview = null;
    aiMessage = "";
  } else {
    aiMessage = "The generated project could not be saved.";
  }
  await refresh();
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
  const responseParams = response?.diagnostic as
    | { readonly params?: Readonly<Record<string, unknown>> }
    | undefined;
  const responseReason =
    typeof responseParams?.params?.reason === "string"
      ? responseParams.params.reason
      : null;
  installCommand = null;
  if (response?.ok === true) {
    statusMessage =
      command === "start-native-runtime"
        ? "Runtime started."
        : "Runtime stopped.";
  } else if (
    code === "extension.native-host-missing" ||
    code === "extension.request-body-needs-trust"
  ) {
    const id = extensionId();
    if (id.length > 0) {
      installCommand = `rogatio runtime install --extension-id ${id}`;
    } else {
      installCommand = null;
    }
    statusMessage =
      code === "extension.native-host-missing"
        ? "The native runtime host is not installed on this device. Run the install command below once in a terminal, then restart Chrome and click Start runtime again. If you just ran install, try restarting Chrome first."
        : "Request-body rules need the device-local CA trusted on this device. Run the install command below to register the host and (on capable platforms) trust the device-local CA, then restart Chrome and click Start runtime again. Mocks and response-body rules do not need trust.";
  } else if (code === "extension.native-runtime-unavailable") {
    statusMessage = "Runtime action unavailable on this platform.";
  } else {
    statusMessage = [
      "The runtime action failed.",
      responseReason ? `Runtime error: ${responseReason}` : "",
      "Open Show diagnostics for details.",
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }
  await refresh();
  if (response?.ok !== true && state.nativeRuntimeError) {
    statusMessage = [
      "The runtime action failed.",
      `Runtime error: ${state.nativeRuntimeError}`,
      "Fix: run the install command if the host is missing, then reload the extension and restart Chrome.",
    ].join(" ");
    renderShell();
  }
}

async function copyInstallCommand(): Promise<void> {
  const id = extensionId();
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  const cmd =
    installCommand ??
    (phase === "failed" && id.length > 0
      ? `rogatio runtime install --extension-id ${id}`
      : null);
  if (!cmd) return;
  statusMessage = (await copyText(cmd))
    ? "Install command copied. Paste it in a terminal, run it, then click Start runtime again."
    : "Copying failed. Select the command text and copy it manually.";
  await refresh();
}

async function copyExtensionId(): Promise<void> {
  const id = extensionId();
  if (!id) {
    statusMessage = "The extension ID is unavailable.";
    renderShell();
    return;
  }
  statusMessage = (await copyText(id))
    ? "Extension ID copied to clipboard."
    : "Copying failed. Select the extension ID and copy it manually.";
  renderShell();
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

async function checkNativeAISupport(): Promise<void> {
  try {
    const adapter: NativeSessionOptions = {
      extensionId: extensionId(),
      nativeRuntime: {
        start: async () => ({
          state: "unsupported",
          message: "not implemented",
        }),
        stop: async () => ({ state: "stopped" }),
        status: async () => ({ state: "stopped" }),
        sendPolicy: async () => {},
        send: async (envelope) => {
          return new Promise((resolve) => {
            chrome.runtime.sendMessage(envelope, (response: unknown) => {
              const error = chrome.runtime.lastError;
              if (error) {
                resolve({
                  protocol: "v1",
                  type: "ai.error",
                  timestamp: Date.now(),
                  metadata: {
                    code: "extension.message-failed",
                    message: error.message,
                    retryable: false,
                  },
                });
              } else {
                const extResponse = response as ExtensionResponse;
                if (extResponse.ok && extResponse.value !== undefined) {
                  resolve(extResponse.value as NativeEnvelope);
                } else {
                  resolve({
                    protocol: "v1",
                    type: "ai.error",
                    timestamp: Date.now(),
                    metadata: {
                      code:
                        extResponse.diagnostic?.code ??
                        "extension.message-failed",
                      message: "AI request failed",
                      retryable: false,
                    },
                  });
                }
              }
            });
          });
        },
      },
      getProject: async () => {
        if (!state.activeProjectId) return null;
        const project = state.projects[state.activeProjectId];
        if (!project) return null;
        return { data: project.data, enabledGroupIds: project.enabledGroupIds };
      },
      getGrantedOrigins: async () => {
        const projectId = state.activeProjectId;
        return projectId
          ? (state.projects[projectId]?.grantedOrigins ?? [])
          : [];
      },
    };
    const supported = await checkAISupport(adapter);
    aiSupported = supported;
    aiStatusChecked = true;
    renderShell();
  } catch {
    aiSupported = false;
    aiStatusChecked = true;
    renderShell();
  }
}

async function showDiagnostics(): Promise<void> {
  const response = await client.send({
    version: 1,
    command: "diagnose-native-runtime",
  });
  if (response?.ok === true && response.value) {
    diagnosticsData = response.value as {
      phase: string;
      extensionId: string | null;
      hostName: string;
      chromeError: string | null;
      runtimeError: string | null;
      connectNativeAvailable: boolean;
      timestamp: number;
    };
    diagnosticsOpen = true;
  }
  renderShell();
}

function formatDiagnosticsText(): string {
  if (!diagnosticsData) return "";
  const lines = [
    `Phase: ${diagnosticsData.phase}`,
    `Extension ID: ${diagnosticsData.extensionId ?? "unknown"}`,
    `Host name: ${diagnosticsData.hostName}`,
    `connectNative available: ${diagnosticsData.connectNativeAvailable}`,
    `Chrome error: ${diagnosticsData.chromeError ?? "none"}`,
    `Runtime error: ${diagnosticsData.runtimeError ?? "none"}`,
    `Timestamp: ${new Date(diagnosticsData.timestamp).toISOString()}`,
  ];
  return lines.join("\n");
}

async function copyDiagnostics(): Promise<void> {
  const text = formatDiagnosticsText();
  if (!text) return;
  const ok = await copyText(text);
  statusMessage = ok
    ? "Diagnostics copied to clipboard."
    : "Copying failed. Select the text and copy manually.";
  renderShell();
}

function renderDiagnosticsModal(container: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.className = "rogatio-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "rogatio-modal";

  const header = document.createElement("div");
  header.className = "rogatio-modal-header";
  const title = document.createElement("h3");
  title.textContent = "Runtime Diagnostics";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "\u00d7";
  closeBtn.className = "rogatio-modal-close";
  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "rogatio-modal-body";
  if (diagnosticsData) {
    const table = document.createElement("div");
    table.className = "rogatio-diag-table";
    const row = (label: string, value: string) => {
      const r = document.createElement("div");
      r.className = "rogatio-diag-row";
      const l = document.createElement("span");
      l.className = "rogatio-diag-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "rogatio-diag-value";
      v.textContent = value;
      r.append(l, v);
      return r;
    };
    table.append(
      row("Phase", diagnosticsData.phase),
      row("Extension ID", diagnosticsData.extensionId ?? "unknown"),
      row("Host name", diagnosticsData.hostName),
      row(
        "connectNative",
        diagnosticsData.connectNativeAvailable ? "available" : "missing",
      ),
      row("Chrome error", diagnosticsData.chromeError ?? "none"),
      row("Runtime error", diagnosticsData.runtimeError ?? "none"),
    );
    const hint = document.createElement("p");
    hint.className = "rogatio-diag-hint";
    hint.textContent =
      "If the error mentions a missing host, file, or permission, copy the extension ID, run the install command, reload the extension, and restart Chrome.";
    body.append(table, hint);
  }

  const footer = document.createElement("div");
  footer.className = "rogatio-modal-footer";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy diagnostics";
  const closeFooterBtn = document.createElement("button");
  closeFooterBtn.type = "button";
  closeFooterBtn.textContent = "Close";
  footer.append(copyBtn, closeFooterBtn);

  modal.append(header, body, footer);
  overlay.append(modal);
  container.append(overlay);

  // Direct listeners — the overlay is a sibling of shell, not a child, so
  // the shell delegated click handler cannot reach these elements.
  function closeModal(): void {
    diagnosticsOpen = false;
    renderShell();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  closeFooterBtn.addEventListener("click", closeModal);
  copyBtn.addEventListener("click", () => void copyDiagnostics());
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

  // Check AI support when runtime is running
  if (state.nativeRuntimeState?.phase === "started") {
    await checkNativeAISupport();
  } else {
    aiSupported = false;
    aiStatusChecked = false;
  }

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
