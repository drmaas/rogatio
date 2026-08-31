import { createPopupModel, type PopupModel } from "./popup-model.js";

const rootElement = document.querySelector<HTMLElement>("#rogatio-popup-root");
if (!rootElement) throw new Error("popup.invalid-root");
const container: HTMLElement = rootElement;
container.className = "rogatio-popup";

/**
 * Mirrors the schema label bound (`LIMITS.maxLabelLength`) so the inline
 * create form cannot submit an over-long name. Hard-coded instead of imported
 * from the browser-safe schema adapter to keep the popup bundle minimal; the
 * service worker remains the authoritative validator either way.
 */
const MAX_PROJECT_NAME_LENGTH = 100;

interface ExtensionResponse {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly diagnostic?: { readonly code?: string };
}

const client = {
  send(message: Record<string, unknown>): Promise<ExtensionResponse> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, diagnostic: { code: "popup.message-failed" } });
        } else {
          resolve(response as ExtensionResponse);
        }
      });
    });
  },
};

let model: PopupModel | undefined;
/** Whether the inline create-project form is expanded. */
let createFormOpen = false;
/** Draft project name preserved across re-renders (e.g. a failed create). */
let createDraft = "";
/** Last one-line outcome shown in the popup's status region. */
let statusMessage = "";

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "disabled":
      return "Disabled";
    case "needs permission":
      return "Needs permission";
    case "needs proxy":
      return "Needs proxy";
    case "unsupported":
      return "Unsupported";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function managementAnchor(
  label: string,
  url: string,
  ariaLabel: string,
): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.textContent = label;
  anchor.dataset.managementLink = "true";
  anchor.setAttribute("aria-label", ariaLabel);
  return anchor;
}

function projectAction(label: string, datasetKey: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset[datasetKey] = "true";
  return button;
}

/** The inline create form (an inline input instead of `window.prompt`,
 * which is unavailable inside Chrome action popups). */
function createForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.id = "rogatio-popup-create-form";
  form.dataset.createForm = "true";

  const label = document.createElement("label");
  label.textContent = "Project name";
  const name = document.createElement("input");
  name.type = "text";
  name.required = true;
  name.maxLength = MAX_PROJECT_NAME_LENGTH;
  name.value = createDraft;
  name.placeholder = "New Rogatio project";
  name.dataset.projectName = "true";
  name.setAttribute("autocomplete", "off");
  name.addEventListener("input", () => {
    createDraft = name.value;
  });
  label.append(name);

  const row = document.createElement("div");
  row.dataset.createActions = "true";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Create";
  submit.dataset.createSubmit = "true";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.dataset.createCancel = "true";
  cancel.addEventListener("click", () => {
    createFormOpen = false;
    createDraft = "";
    statusMessage = "";
    render();
  });
  row.append(submit, cancel);

  form.append(label, row);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCreate(name.value);
  });
  return form;
}

function statusLine(): HTMLParagraphElement {
  const status = document.createElement("p");
  status.dataset.popupStatus = "true";
  status.setAttribute("role", "status");
  status.textContent = statusMessage;
  return status;
}

/** Hidden file input behind the "Import project" button. */
function importField(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.rogatio.json,application/json";
  input.hidden = true;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.dataset.importInput = "true";
  input.addEventListener("change", () => void importProjectFile(input));
  return input;
}

async function submitCreate(name: string): Promise<void> {
  const current = model;
  if (!current) return;
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    statusMessage = "Enter a project name to create a project.";
    render();
    return;
  }
  createDraft = trimmed;
  const ok = await current.createProject(trimmed);
  if (ok) {
    createFormOpen = false;
    createDraft = "";
    statusMessage = "Project created.";
  } else {
    statusMessage = "The project could not be created.";
  }
  await refresh();
}

async function importProjectFile(input: HTMLInputElement): Promise<void> {
  const current = model;
  const file = input.files?.[0];
  input.value = "";
  if (!current || !file) return;
  let data: unknown;
  try {
    // Read and dispatch immediately: Chrome may close the popup right after
    // the file picker resolves, so no UI work happens before the message.
    data = JSON.parse(await file.text()) as unknown;
  } catch {
    statusMessage = "The selected file is not valid JSON.";
    render();
    return;
  }
  const ok = await current.importProject(data);
  statusMessage = ok
    ? "Project imported."
    : "The project could not be imported.";
  await refresh();
}

function render(): void {
  const current = model;
  if (!current) return;
  container.replaceChildren();

  const header = document.createElement("header");
  const title = document.createElement("h1");
  title.textContent = "Rogatio";
  const project = document.createElement("p");
  project.dataset.activeProject = "true";
  project.textContent = current.activeProjectName
    ? `Active project: ${current.activeProjectName}`
    : "No active project";
  const openApp = managementAnchor(
    "Open app",
    current.openAppUrl(),
    "Open the Rogatio management page",
  );
  openApp.dataset.openApp = "true";
  header.append(title, project, openApp);

  const actions = document.createElement("div");
  actions.dataset.projectActions = "true";
  const newProject = projectAction("New project", "createProject");
  newProject.setAttribute("aria-expanded", String(createFormOpen));
  newProject.setAttribute("aria-controls", "rogatio-popup-create-form");
  newProject.addEventListener("click", () => {
    createFormOpen = !createFormOpen;
    if (!createFormOpen) {
      createDraft = "";
      statusMessage = "";
    }
    render();
    if (createFormOpen) {
      container.querySelector<HTMLInputElement>("[data-project-name]")?.focus();
    }
  });
  const importProject = projectAction("Import project", "importProject");
  importProject.addEventListener("click", () => {
    container.querySelector<HTMLInputElement>("[data-import-input]")?.click();
  });
  actions.append(newProject, importProject);

  const list = document.createElement("ul");
  list.dataset.groupList = "true";
  const rows = current.rows();
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "This project has no saved groups.";
    list.append(empty);
  }
  for (const row of rows) {
    const item = document.createElement("li");
    item.dataset.ruleId = row.id;
    item.dataset.groupId = row.groupId;

    const name = document.createElement("span");
    name.textContent = row.name;

    const group = document.createElement("span");
    group.dataset.ruleGroup = "true";
    group.textContent = row.groupId;

    const status = document.createElement("span");
    status.dataset.groupStatus = "true";
    status.textContent = statusLabel(row.status);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = row.enabled;
    toggle.dataset.groupToggle = "true";
    toggle.setAttribute(
      "aria-label",
      `${row.enabled ? "Deactivate" : "Activate"} group ${row.name}`,
    );
    toggle.addEventListener("change", async () => {
      await current.toggle(row.groupId, toggle.checked);
      await refresh();
    });

    const pencil = managementAnchor(
      "Edit group",
      current.groupUrl(row.groupId),
      `Open ${row.name} in the editor`,
    );
    pencil.dataset.groupEdit = "true";

    item.append(name, group, status, toggle, pencil);
    list.append(item);
  }

  const parts: HTMLElement[] = [header, actions];
  if (createFormOpen) parts.push(createForm());
  if (statusMessage) parts.push(statusLine());
  parts.push(list, importField());
  container.append(...parts);
}

async function refresh(): Promise<void> {
  const response = await client.send({ version: 1, command: "get-state" });
  if (response?.ok !== true || !response.value) return;
  model = createPopupModel({
    envelope: response.value as Parameters<
      typeof createPopupModel
    >[0]["envelope"],
    send: (message) => client.send(message),
  });
  render();
}

void refresh();
