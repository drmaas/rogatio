/** Workspace control for the device-local mock file root. */
export function renderMockFileRootControl(
  document: Document,
  root: string | undefined,
): HTMLElement {
  const section = document.createElement("section");
  section.dataset.mockFileRoot = "true";
  section.setAttribute("aria-label", "Mock file root");

  const heading = document.createElement("h2");
  heading.textContent = "Mock file root";
  const current = document.createElement("p");
  current.dataset.mockFileRootValue = "true";
  current.textContent =
    root === undefined || root.length === 0 ? "No mock file root" : root;

  const input = document.createElement("input");
  input.type = "text";
  input.dataset.mockFileRootInput = "true";
  input.value = root ?? "";
  input.setAttribute("aria-label", "Mock file root path");

  const set = document.createElement("button");
  set.type = "button";
  set.dataset.command = "set-mock-file-root";
  set.textContent = "Set root";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.dataset.command = "clear-mock-file-root";
  clear.textContent = "Clear root";

  section.append(heading, current, input, set, clear);
  return section;
}

/** Value the management page should store for a root command. */
export function mockFileRootCommandValue(
  section: ParentNode,
  command: string,
): string | null | undefined {
  if (command === "clear-mock-file-root") return null;
  if (command !== "set-mock-file-root") return undefined;
  const input = section.querySelector("[data-mock-file-root-input]");
  if (!(input instanceof HTMLInputElement)) return undefined;
  return input.value;
}
