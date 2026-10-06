import { isAbsoluteMockFileRoot } from "@rogatio/browser-core";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export interface MockFileRootControlOptions {
  readonly saved?: string;
  readonly draft?: string;
  readonly error?: string;
  readonly onDraft?: (value: string) => void;
}

/** Project-details control for the device-local mock folder. */
export function renderMockFileRootControl(
  document: Document,
  options: MockFileRootControlOptions,
): HTMLElement {
  const section = document.createElement("div");
  section.dataset.editorField = "true";
  section.dataset.mockFileRoot = "true";

  const heading = document.createElement("span");
  heading.textContent = "Mock files";

  const hint = document.createElement("p");
  hint.dataset.mockFileRootHint = "true";
  hint.textContent =
    "File-backed mock rules read from this folder. It stays on this device and is not part of the project file.";

  const current = document.createElement("p");
  current.dataset.mockFileRootValue = "true";
  current.textContent =
    options.saved === undefined || options.saved.length === 0
      ? "No folder set"
      : options.saved;

  const actions = document.createElement("div");
  actions.dataset.mockFileRootActions = "true";
  const choose = document.createElement("button");
  choose.type = "button";
  choose.dataset.btn = "primary";
  choose.dataset.command = "pick-mock-file-root";
  choose.textContent = "Choose folder";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.dataset.btn = "secondary";
  clear.dataset.command = "clear-mock-file-root";
  clear.textContent = "Clear";
  clear.disabled = options.saved === undefined || options.saved.length === 0;
  actions.append(choose, clear);

  const pathLabel = document.createElement("label");
  pathLabel.textContent = "Full path";
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.mockFileRootInput = "true";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "/home/you/projects/samples/basic";
  input.value = options.draft ?? options.saved ?? "";
  input.setAttribute("aria-label", "Mock files folder path");
  input.addEventListener("input", () => {
    options.onDraft?.(input.value);
  });
  pathLabel.append(input);

  const error = document.createElement("p");
  error.dataset.mockFileRootError = "true";
  error.setAttribute("role", "alert");
  if (options.error && options.error.length > 0) {
    input.setAttribute("aria-invalid", "true");
    error.textContent = options.error;
  } else {
    error.hidden = true;
  }

  const saveRow = document.createElement("div");
  saveRow.dataset.mockFileRootActions = "true";
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.btn = "secondary";
  save.dataset.command = "set-mock-file-root";
  save.textContent = "Save path";
  saveRow.append(save);

  section.append(heading, hint, current, actions, pathLabel, error, saveRow);
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

/** Inline rejection for a pasted path. Empty and relative paths never reach the host. */
export function mockFileRootFieldError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Enter a full path, or choose a folder.";
  }
  if (hasControlCharacter(trimmed)) {
    return "Remove control characters from the path.";
  }
  if (!isAbsoluteMockFileRoot(trimmed)) {
    return "Use a full path to a folder. A relative path such as samples/basic is not a folder on this device.";
  }
  return null;
}
