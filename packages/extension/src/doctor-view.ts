import { doctorCheckTitle } from "./doctor-report.js";
import {
  type CombinedDiagnostics,
  EXTENSION_UI_TITLES,
  type ExtensionUiCheckId,
  serializeCombinedDiagnostics,
} from "./ui-doctor.js";

function titleFor(id: string): string {
  if (Object.hasOwn(EXTENSION_UI_TITLES, id)) {
    return EXTENSION_UI_TITLES[id as ExtensionUiCheckId];
  }
  if (
    id === "node" ||
    id === "project" ||
    id === "host" ||
    id === "ca" ||
    id === "pac" ||
    id === "ai"
  ) {
    return doctorCheckTitle(id);
  }
  return id;
}

function appendCheck(
  list: HTMLElement,
  item: {
    readonly id: string;
    readonly status: string;
    readonly summary: string;
    readonly fix: string | null;
  },
): void {
  const line = document.createElement("p");
  line.className = "rogatio-doctor-check";
  line.dataset.status = item.status;
  line.dataset.check = item.id;
  const title = titleFor(item.id);
  line.textContent =
    item.fix === null
      ? `${item.status}  ${title}  ${item.summary}`
      : `${item.status}  ${title}  ${item.summary}\nFix: ${item.fix}`;
  list.append(line);
}

/** Render UI checks, then the host report, with textContent only. */
export function renderDoctorReport(
  parent: HTMLElement,
  report: CombinedDiagnostics | null,
): void {
  if (report === null) return;
  const list = document.createElement("div");
  list.className = "rogatio-doctor-report";
  list.dataset.doctorReport = "true";
  for (const item of report.ui.checks) appendCheck(list, item);
  if (report.host !== null) {
    for (const item of report.host.checks) appendCheck(list, item);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.dataset.command = "copy-doctor";
  copy.textContent = "Copy diagnostics";
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const json = serializeCombinedDiagnostics(report);
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard.writeText(json).catch(() => undefined);
    }
  });
  list.append(copy);
  parent.append(list);
}
