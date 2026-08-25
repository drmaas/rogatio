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

function stable(diagnostics: EditorDiagnostic[]): readonly EditorDiagnostic[] {
  return [...diagnostics].sort((a, b) =>
    a.path === b.path
      ? a.code.localeCompare(b.code)
      : a.path.localeCompare(b.path),
  );
}

function hasControlOrColon(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127 || code === 58) return true;
  }
  return false;
}

export function createMockRuleType(): RuleTypeFieldExtension {
  return {
    id: "mock",
    label: "Mock response",
    actionField: "mock",

    matches(rule): boolean {
      const type = (rule as Record<string, unknown>).type;
      if (type === "mock") return true;
      if (type !== undefined) return false;
      return asMockAction((rule as Record<string, unknown>).mock) !== undefined;
    },

    validate(rule, rulePath): readonly EditorDiagnostic[] {
      const mock = asMockAction((rule as Record<string, unknown>).mock);
      if (mock === undefined) return [];
      const diagnostics: EditorDiagnostic[] = [];

      const status = mock.status;
      if (
        !Number.isInteger(status) ||
        status < LIMITS.minMockStatus ||
        status > LIMITS.maxMockStatus
      ) {
        diagnostics.push({
          code: "editor.mock-status-range",
          severity: "error",
          path: `${rulePath}/mock/status`,
          message: `Mock status must be an integer between ${LIMITS.minMockStatus} and ${LIMITS.maxMockStatus}.`,
        });
      }

      const hasBody = typeof mock.body === "string";
      const hasFile = typeof mock.file === "string";
      if (hasBody === hasFile) {
        diagnostics.push({
          code: "editor.mock-body-source",
          severity: "error",
          path: `${rulePath}/mock`,
          message: "A mock rule must set exactly one of body or file.",
        });
      } else if (hasBody) {
        const body = mock.body as string;
        if (body.length > LIMITS.maxMockInlineBodyLength) {
          diagnostics.push({
            code: "editor.mock-body-too-long",
            severity: "error",
            path: `${rulePath}/mock/body`,
            message: `Mock inline body must be at most ${LIMITS.maxMockInlineBodyLength} characters.`,
          });
        }
      } else if (hasFile) {
        const file = mock.file as string;
        if (file.length === 0 || file.length > LIMITS.maxMockFilePathLength) {
          diagnostics.push({
            code: "editor.mock-file-path",
            severity: "error",
            path: `${rulePath}/mock/file`,
            message: `Mock file path must be 1-${LIMITS.maxMockFilePathLength} characters.`,
          });
        }
      }

      if (
        mock.delayMs !== undefined &&
        (!Number.isInteger(mock.delayMs) ||
          mock.delayMs < 0 ||
          mock.delayMs > LIMITS.maxMockDelayMs)
      ) {
        diagnostics.push({
          code: "editor.mock-delay-range",
          severity: "error",
          path: `${rulePath}/mock/delayMs`,
          message: `Mock delay must be an integer between 0 and ${LIMITS.maxMockDelayMs} milliseconds.`,
        });
      }

      if (mock.headers !== undefined) {
        if (mock.headers.length > LIMITS.maxMockHeadersPerRule) {
          diagnostics.push({
            code: "editor.mock-too-many-headers",
            severity: "error",
            path: `${rulePath}/mock/headers`,
            message: `A mock rule may define at most ${LIMITS.maxMockHeadersPerRule} headers.`,
          });
        }
        mock.headers.forEach((header, index) => {
          const namePath = `${rulePath}/mock/headers/${index}/name`;
          const valuePath = `${rulePath}/mock/headers/${index}/value`;
          if (
            typeof header?.name !== "string" ||
            header.name.length === 0 ||
            header.name.length > LIMITS.maxMockHeaderNameLength
          ) {
            diagnostics.push({
              code: "editor.mock-header-name",
              severity: "error",
              path: namePath,
              message: `Mock header name must be 1-${LIMITS.maxMockHeaderNameLength} characters.`,
            });
          } else if (hasControlOrColon(header.name)) {
            diagnostics.push({
              code: "editor.mock-header-name",
              severity: "error",
              path: namePath,
              message:
                "Mock header name must not contain control characters or a colon.",
            });
          }
          if (
            typeof header?.value !== "string" ||
            header.value.length > LIMITS.maxMockHeaderValueLength
          ) {
            diagnostics.push({
              code: "editor.mock-header-value",
              severity: "error",
              path: valuePath,
              message: `Mock header value must be at most ${LIMITS.maxMockHeaderValueLength} characters.`,
            });
          }
        });
      }

      return stable(diagnostics);
    },

    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const { document, container } = context;

      const getCurrent = (): MockAction | undefined =>
        asMockAction(context.getField("mock"));

      const setAction = (next: MockAction): void => {
        context.setField("mock", next);
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
        context.registerControl("/mock/body-source", sourceSelect);

        const bodyArea = document.createElement("textarea");
        bodyArea.value = typeof current.body === "string" ? current.body : "";
        bodyArea.dataset.editorField = "true";
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
          bodyArea.style.display = useFile ? "none" : "";
          fileLabel.style.display = useFile ? "" : "none";
        };
        sourceSelect.addEventListener("change", syncSource);
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
              const next = (cc.headers ?? []).map((h, i) =>
                i === index ? { ...h, name: nameInput.value } : h,
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
              const next = (cc.headers ?? []).map((h, i) =>
                i === index ? { ...h, value: valueInput.value } : h,
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
              const next = (cc.headers ?? []).filter((_, i) => i !== index);
              setAction({ ...cc, headers: next });
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
