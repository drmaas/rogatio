import { LIMITS } from "@rogatio/schema";
import type {
  EditorDiagnostic,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";

interface MockHeader {
  name: string;
  value: string;
}

interface MockAction {
  status: number;
  headers?: MockHeader[];
  delayMs?: number;
  body?: string;
  file?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMockAction(value: unknown): MockAction | undefined {
  if (!isRecord(value) || typeof value.status !== "number") return undefined;
  const action = value as unknown as MockAction;
  if (action.headers !== undefined && !Array.isArray(action.headers)) {
    return undefined;
  }
  return action;
}

/** Drops undefined keys so the draft never carries `file: undefined`. */
function compact(action: MockAction): MockAction {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action)) {
    if (value !== undefined) next[key] = value;
  }
  return next as unknown as MockAction;
}

export function createMockRuleType(): RuleTypeFieldExtension {
  return {
    id: "mock",
    label: "Mock response",
    actionField: "mock",

    matches(rule): boolean {
      const type = rule.type;
      if (type === "mock") return true;
      if (type !== undefined) return false;
      return asMockAction(rule.mock) !== undefined;
    },

    // Validation is owned by the host-supplied `validate` adapter (schema and
    // semantic rules, including the 204/205/304 status ban). This extension adds
    // no editor-local policy; mount() registers controls at the `/mock/...`
    // paths so host diagnostics land on the matching fields.
    validate(): readonly EditorDiagnostic[] {
      return [];
    },

    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const { document, container } = context;

      const getCurrent = (): MockAction | undefined =>
        asMockAction(context.getField("mock"));

      const setAction = (next: MockAction): void => {
        context.setField("mock", compact(next));
      };

      const render = (): void => {
        const current = getCurrent();
        container.replaceChildren();
        if (current === undefined) return;

        const statusLabel = document.createElement("label");
        statusLabel.textContent = "Status";
        const statusInput = document.createElement("input");
        statusInput.type = "number";
        statusInput.min = String(LIMITS.minMockStatus);
        statusInput.max = String(LIMITS.maxMockStatus);
        statusInput.step = "1";
        statusInput.value = String(current.status);
        statusInput.dataset.editorField = "true";
        statusInput.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          setAction({ ...c, status: Number(statusInput.value) });
        });
        context.registerControl("/mock/status", statusInput);
        statusLabel.append(statusInput);

        const delayLabel = document.createElement("label");
        delayLabel.textContent = "Delay (ms)";
        const delayInput = document.createElement("input");
        delayInput.type = "number";
        delayInput.min = "0";
        delayInput.max = String(LIMITS.maxMockDelayMs);
        delayInput.step = "1";
        delayInput.value =
          current.delayMs === undefined ? "" : String(current.delayMs);
        delayInput.dataset.editorField = "true";
        delayInput.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          const raw = delayInput.value;
          const next =
            raw === ""
              ? { ...c, delayMs: undefined }
              : { ...c, delayMs: Number(raw) };
          setAction(next);
        });
        context.registerControl("/mock/delayMs", delayInput);
        delayLabel.append(delayInput);

        const sourceLabel = document.createElement("label");
        sourceLabel.textContent = "Body source";
        const sourceSelect = document.createElement("select");
        sourceSelect.dataset.editorField = "true";
        const bodyOption = document.createElement("option");
        bodyOption.value = "body";
        bodyOption.textContent = "Inline body";
        const fileOption = document.createElement("option");
        fileOption.value = "file";
        fileOption.textContent = "File snapshot";
        sourceSelect.append(bodyOption, fileOption);
        sourceSelect.value = typeof current.file === "string" ? "file" : "body";
        // Host body-source diagnostics are reported at `/mock`.
        context.registerControl("/mock", sourceSelect);
        sourceLabel.append(sourceSelect);

        const bodyArea = document.createElement("textarea");
        bodyArea.value = typeof current.body === "string" ? current.body : "";
        bodyArea.dataset.editorField = "true";
        bodyArea.setAttribute("aria-label", "Body");
        bodyArea.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          setAction({ ...c, body: bodyArea.value, file: undefined });
        });
        context.registerControl("/mock/body", bodyArea);

        const fileLabel = document.createElement("label");
        fileLabel.textContent = "File path";
        const fileInput = document.createElement("input");
        fileInput.type = "text";
        fileInput.value = typeof current.file === "string" ? current.file : "";
        fileInput.dataset.editorField = "true";
        fileInput.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          setAction({ ...c, body: undefined, file: fileInput.value });
        });
        context.registerControl("/mock/file", fileInput);
        fileLabel.append(fileInput);

        const syncSource = (): void => {
          const useFile = sourceSelect.value === "file";
          bodyArea.hidden = useFile;
          fileLabel.hidden = !useFile;
        };
        sourceSelect.addEventListener("change", () => {
          const c = getCurrent();
          if (c === undefined) return;
          if (sourceSelect.value === "file") {
            setAction({
              ...c,
              body: undefined,
              file: typeof c.file === "string" ? c.file : "",
            });
          } else {
            setAction({
              ...c,
              file: undefined,
              body: typeof c.body === "string" ? c.body : "",
            });
          }
          syncSource();
        });
        syncSource();

        const headersFieldset = document.createElement("fieldset");
        const headersLegend = document.createElement("legend");
        headersLegend.textContent = "Response headers";
        headersFieldset.append(headersLegend);

        const renderHeaders = (): void => {
          const c = getCurrent();
          if (c === undefined) return;
          headersFieldset
            .querySelectorAll("[data-mock-header-row]")
            .forEach((row) => {
              row.remove();
            });
          headersFieldset
            .querySelectorAll("[data-mock-add-header]")
            .forEach((button) => {
              button.remove();
            });
          const headers = c.headers ?? [];
          headers.forEach((header, index) => {
            const row = document.createElement("div");
            row.dataset.mockHeaderRow = String(index);

            const nameLabel = document.createElement("label");
            nameLabel.textContent = "Name";
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = header.name;
            nameInput.dataset.editorField = "true";
            nameInput.addEventListener("input", () => {
              const cc = getCurrent();
              if (cc === undefined) return;
              const next = (cc.headers ?? []).map((entry, itemIndex) =>
                itemIndex === index
                  ? { ...entry, name: nameInput.value }
                  : entry,
              );
              setAction({ ...cc, headers: next });
            });
            context.registerControl(`/mock/headers/${index}/name`, nameInput);
            nameLabel.append(nameInput);

            const valueLabel = document.createElement("label");
            valueLabel.textContent = "Value";
            const valueInput = document.createElement("input");
            valueInput.type = "text";
            valueInput.value = header.value;
            valueInput.dataset.editorField = "true";
            valueInput.addEventListener("input", () => {
              const cc = getCurrent();
              if (cc === undefined) return;
              const next = (cc.headers ?? []).map((entry, itemIndex) =>
                itemIndex === index
                  ? { ...entry, value: valueInput.value }
                  : entry,
              );
              setAction({ ...cc, headers: next });
            });
            context.registerControl(`/mock/headers/${index}/value`, valueInput);
            valueLabel.append(valueInput);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove";
            remove.dataset.editorField = "true";
            remove.addEventListener("click", () => {
              const cc = getCurrent();
              if (cc === undefined) return;
              const next = (cc.headers ?? []).filter(
                (_, itemIndex) => itemIndex !== index,
              );
              setAction({
                ...cc,
                headers: next.length > 0 ? next : undefined,
              });
            });

            row.append(nameLabel, valueLabel, remove);
            headersFieldset.append(row);
          });

          const add = document.createElement("button");
          add.type = "button";
          add.textContent = "Add header";
          add.dataset.editorField = "true";
          add.dataset.mockAddHeader = "true";
          add.addEventListener("click", () => {
            const cc = getCurrent();
            if (cc === undefined) return;
            setAction({
              ...cc,
              headers: [...(cc.headers ?? []), { name: "", value: "" }],
            });
          });
          headersFieldset.append(add);
        };
        renderHeaders();

        container.append(
          statusLabel,
          delayLabel,
          sourceLabel,
          bodyArea,
          fileLabel,
          headersFieldset,
        );
      };

      render();
      return { destroy() {} };
    },

    defaultAction(): unknown {
      return { status: 200, body: "" };
    },
  };
}
