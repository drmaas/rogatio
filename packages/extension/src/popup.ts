import { createPopupModel, type PopupModel } from "./popup-model.js";

const rootElement = document.querySelector<HTMLElement>("#rogatio-popup-root");
if (!rootElement) throw new Error("popup.invalid-root");
const container: HTMLElement = rootElement;

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

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

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

function render(): void {
  const current = model;
  if (!current) return;
  container.replaceChildren();

  const header = document.createElement("header");
  const title = document.createElement("h1");
  title.textContent = "Requestify";
  const project = document.createElement("p");
  project.dataset.activeProject = "true";
  project.textContent = current.activeProjectName
    ? `Active project: ${current.activeProjectName}`
    : "No active project";
  const openApp = managementAnchor(
    "Open app",
    current.openAppUrl(),
    "Open the Requestify management page",
  );
  openApp.dataset.openApp = "true";
  header.append(title, project, openApp);

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
    item.dataset.groupId = row.id;

    const name = document.createElement("span");
    name.textContent = row.name;

    const count = document.createElement("span");
    count.dataset.ruleCount = "true";
    count.textContent = `${row.ruleCount} rule${row.ruleCount === 1 ? "" : "s"}`;

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
      await current.toggle(row.id, toggle.checked);
      await refresh();
    });

    const pencil = managementAnchor(
      "Edit group",
      current.groupUrl(row.id),
      `Open ${row.name} in the editor`,
    );
    pencil.dataset.groupEdit = "true";

    item.append(name, count, status, toggle, pencil);
    list.append(item);
  }

  container.append(header, list);
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
