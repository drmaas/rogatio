import {
  createEditor,
  createMockRuleType,
  createRedirectRuleType,
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
  readonly mockRuntimeState?: {
    readonly phase: "disconnected" | "checking" | "connected" | "failed";
    readonly lastCheck?: {
      readonly at?: number;
      readonly ok?: boolean;
      readonly message?: string;
    } | null;
  };
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
let editor: EditorController | undefined;
let statusMessage = "";
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

function renderShell(): void {
  editor?.destroy();
  editor = undefined;
  root.replaceChildren();
  const shell = document.createElement("section");
  shell.setAttribute("aria-labelledby", "rogatio-title");
  const heading = document.createElement("h1");
  heading.id = "rogatio-title";
  heading.textContent = "Rogatio";
  shell.append(heading);

  const controls = document.createElement("div");
  controls.setAttribute("role", "toolbar");
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
  controls.append(
    selectorLabel,
    button("Switch project", "switch"),
    button("Create project", "create"),
    button("Import project", "import"),
    button("Review permissions", "review-permissions"),
    button(
      permissionGranted ? "Access granted" : "Grant declared access",
      "grant-permissions",
    ),
    button("Check and connect", "check-mock-runtime"),
    button("Refresh", "refresh"),
    button("Export project", "export"),
    button("Remove project", "remove"),
  );
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".json,.rogatio.json,application/json";
  importInput.hidden = true;
  importInput.dataset.importInput = "true";
  controls.append(importInput);
  shell.append(controls);

  if (permissionOrigins.length > 0) {
    const permissionSummary = document.createElement("p");
    permissionSummary.dataset.permissionSummary = "true";
    permissionSummary.textContent = permissionGranted
      ? `Declared access granted: ${permissionOrigins.join(", ")}`
      : `Declared access needed: ${permissionOrigins.join(", ")}`;
    shell.append(permissionSummary);
  }

  const activeProject = state.activeProjectId
    ? state.projects[state.activeProjectId]
    : undefined;
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
    shell.append(groups);
  }

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = statusMessage;
  shell.append(status);

  const badge = document.createElement("p");
  badge.dataset.badgeState = "true";
  badge.textContent = state.badge
    ? `Active rules: ${state.badge.text}${state.badge.attention ? " (attention needed)" : ""}`
    : "Active rules: 0";
  shell.append(badge);

  const mockRuntime = document.createElement("p");
  mockRuntime.dataset.mockRuntimeState = "true";
  const mockPhase = state.mockRuntimeState?.phase ?? "disconnected";
  const lastCheck = state.mockRuntimeState?.lastCheck;
  if (mockPhase === "checking") {
    mockRuntime.textContent = "Mock runtime: checking…";
  } else if (mockPhase === "connected") {
    mockRuntime.textContent = lastCheck?.ok
      ? "Mock runtime: connected."
      : "Mock runtime: connected.";
  } else if (mockPhase === "failed") {
    mockRuntime.textContent = `Mock runtime: unreachable${lastCheck?.message ? ` (${lastCheck.message})` : ""}. Start rogatio runtime and check again.`;
  } else {
    mockRuntime.textContent =
      "Mock runtime: not connected. Start rogatio runtime, then choose Check and connect.";
  }
  shell.append(mockRuntime);

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
  shell.append(ruleStatuses);

  const editorRoot = document.createElement("div");
  editorRoot.dataset.editorRoot = "true";
  shell.append(editorRoot);
  root.append(shell);

  selector.addEventListener("change", () => {
    pendingProjectId = selector.value;
    statusMessage = `Selected ${text(state.projects[pendingProjectId]?.name, pendingProjectId)}. Choose Switch project to activate it.`;
    renderShell();
  });
  controls.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const command = target.dataset.command;
    if (command === "refresh") void refresh();
    if (command === "switch") void switchProject();
    if (command === "create") void createProject();
    if (command === "import") importInput.click();
    if (command === "review-permissions") void reviewPermissions();
    if (command === "grant-permissions") void grantPermissions();
    if (command === "check-mock-runtime") void checkMockRuntime();
    if (command === "export") void exportProject();
    if (command === "remove") void removeProject();
  });
  importInput.addEventListener("change", () => void importProject(importInput));
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.dataset.groupToggle !== "true"
    )
      return;
    void setGroupEnabled(target.dataset.groupId ?? "", target.checked);
  });

  if (ids.length > 0) {
    editor = createEditor({
      root: editorRoot,
      ruleTypes: [createRedirectRuleType(), createMockRuleType()],
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
  }
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
  const response = await client.send({
    version: 1,
    command: "grant-permissions",
    projectId,
    origins: permissionOrigins,
  });
  if (response.ok === true) permissionGranted = true;
  statusMessage =
    response.ok === true
      ? "Declared access granted."
      : "Declared access was not granted.";
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

async function checkMockRuntime(): Promise<void> {
  const response = await client.send({
    version: 1,
    command: "check-mock-runtime",
  });
  statusMessage =
    response?.ok === true
      ? "Mock runtime check complete."
      : "The mock runtime could not be checked. Start rogatio runtime and try again.";
  await refresh();
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

void refresh();
