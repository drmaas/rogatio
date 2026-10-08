import { type DoctorReport, doctorCheckTitle } from "./doctor-report.js";

/** Render doctor lines with textContent. Titles match the CLI report. */
export function renderDoctorReport(
  parent: HTMLElement,
  report: DoctorReport | null,
): void {
  if (report === null) return;
  const list = document.createElement("div");
  list.className = "rogatio-doctor-report";
  list.dataset.doctorReport = "true";
  for (const item of report.checks) {
    const line = document.createElement("p");
    line.className = "rogatio-doctor-check";
    line.dataset.status = item.status;
    line.dataset.check = item.id;
    const title = doctorCheckTitle(item.id);
    line.textContent =
      item.fix === null
        ? `${item.status}  ${title}  ${item.summary}`
        : `${item.status}  ${title}  ${item.summary}\nFix: ${item.fix}`;
    list.append(line);
  }
  parent.append(list);
}
