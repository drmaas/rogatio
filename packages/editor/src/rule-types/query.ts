import type {
  EditorDiagnostic,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";
import { createSelect } from "./dom.js";

const MAX_QUERY_NAME_LENGTH = 256;
const MAX_QUERY_VALUE_LENGTH = 2048;
const MAX_QUERY_PARAMS = 64;
const QUERY_OPERATIONS = Object.freeze(["set", "remove"] as const);

type QueryParamOperation = (typeof QUERY_OPERATIONS)[number];

interface QueryParam {
  name: string;
  operation?: QueryParamOperation;
  value?: string;
}

interface QueryAction {
  type: "query";
  params: QueryParam[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asQueryAction(value: unknown): QueryAction | undefined {
  if (!isRecord(value)) return undefined;
  if ((value as Record<string, unknown>).type !== "query") return undefined;
  const params = (value as Record<string, unknown>).params;
  if (!Array.isArray(params)) return undefined;
  return value as unknown as QueryAction;
}

function paramOperation(param: QueryParam): QueryParamOperation {
  return param.operation ?? "set";
}

function buildSetParam(name: string, value: string): QueryParam {
  return { name, operation: "set", value };
}

function buildRemoveParam(name: string): QueryParam {
  return { name, operation: "remove" };
}

function normalizeParam(param: QueryParam): QueryParam {
  if (paramOperation(param) === "remove") {
    return buildRemoveParam(param.name);
  }
  return buildSetParam(param.name, param.value ?? "");
}

function stable(diagnostics: EditorDiagnostic[]): readonly EditorDiagnostic[] {
  return [...diagnostics].sort((a, b) =>
    a.path === b.path
      ? a.code.localeCompare(b.code)
      : a.path.localeCompare(b.path),
  );
}

export const queryRuleType: RuleTypeFieldExtension = {
  id: "query",
  label: "Query parameters",

  matches(rule): boolean {
    return rule.type === "query";
  },

  validate(rule, rulePath): readonly EditorDiagnostic[] {
    const action = asQueryAction((rule as Record<string, unknown>).action);
    if (action === undefined) return [];
    const diagnostics: EditorDiagnostic[] = [];
    if (!Array.isArray(action.params) || action.params.length === 0) {
      diagnostics.push({
        code: "editor.query-params-required",
        severity: "error",
        path: `${rulePath}/action/params`,
        message: "Query rules need at least one parameter.",
      });
      return stable(diagnostics);
    }
    if (action.params.length > MAX_QUERY_PARAMS) {
      diagnostics.push({
        code: "editor.query-too-many-params",
        severity: "error",
        path: `${rulePath}/action/params`,
        message: `A query rule may define at most ${MAX_QUERY_PARAMS} parameters.`,
      });
    }
    const seen = new Set<string>();
    action.params.forEach((param, index) => {
      const namePath = `${rulePath}/action/params/${index}/name`;
      const valuePath = `${rulePath}/action/params/${index}/value`;
      const operation = paramOperation(param);
      if (typeof param?.name !== "string" || param.name.length === 0) {
        diagnostics.push({
          code: "editor.query-param-name-required",
          severity: "error",
          path: namePath,
          message: "Query parameter name is required.",
        });
      } else if (param.name.length > MAX_QUERY_NAME_LENGTH) {
        diagnostics.push({
          code: "editor.query-param-name-too-long",
          severity: "error",
          path: namePath,
          message: "Query parameter name is too long.",
        });
      }
      if (operation === "set") {
        if (typeof param?.value !== "string" || param.value.length === 0) {
          diagnostics.push({
            code: "editor.query-param-value-required",
            severity: "error",
            path: valuePath,
            message: "Query parameter value is required.",
          });
        } else if (param.value.length > MAX_QUERY_VALUE_LENGTH) {
          diagnostics.push({
            code: "editor.query-param-value-too-long",
            severity: "error",
            path: valuePath,
            message: "Query parameter value is too long.",
          });
        }
      } else if (param?.value !== undefined) {
        diagnostics.push({
          code: "schema.unexpected",
          severity: "error",
          path: valuePath,
          message:
            "Query parameter value must not be provided for remove operation.",
        });
      }
      if (typeof param?.name === "string" && seen.has(param.name)) {
        diagnostics.push({
          code: "editor.query-duplicate-param",
          severity: "error",
          path: namePath,
          message: "Query parameter names must be unique within a rule.",
        });
      }
      if (typeof param?.name === "string") seen.add(param.name);
    });
    return stable(diagnostics);
  },

  mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
    const { document, container } = context;

    const getCurrent = (): QueryAction | undefined =>
      asQueryAction(context.getField("action"));

    const setAction = (next: QueryAction): void => {
      context.setField("action", next);
    };

    const render = (): void => {
      const current = getCurrent();
      container.replaceChildren();
      if (current === undefined) return;

      current.params.forEach((param, index) => {
        const row = document.createElement("div");
        row.dataset.queryParamRow = String(index);
        const operation = paramOperation(param);

        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Name";
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = param.name;
        nameInput.dataset.editorField = "true";
        nameInput.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          const params = c.params.map((p, i) => {
            if (i !== index) return p;
            return normalizeParam({ ...p, name: nameInput.value });
          });
          setAction({ type: "query", params });
        });
        context.registerControl(`/action/params/${index}/name`, nameInput);
        nameLabel.append(nameInput);

        const operationLabel = document.createElement("label");
        operationLabel.textContent = "Operation";
        const operationSelect = createSelect(
          document,
          QUERY_OPERATIONS,
          operation,
          (value) => {
            const c = getCurrent();
            if (c === undefined) return;
            const params = c.params.map((p, i) => {
              if (i !== index) return p;
              if (value === "remove") {
                return buildRemoveParam(p.name);
              }
              return buildSetParam(p.name, p.value ?? "");
            });
            setAction({ type: "query", params });
            render();
          },
        );
        operationSelect.dataset.queryParamOperation = String(index);
        context.registerControl(
          `/action/params/${index}/operation`,
          operationSelect,
        );
        operationLabel.append(operationSelect);

        const valueLabel = document.createElement("label");
        valueLabel.textContent = "Value";
        const valueInput = document.createElement("input");
        valueInput.type = "text";
        valueInput.value = param.value ?? "";
        valueInput.dataset.editorField = "true";
        valueInput.addEventListener("input", () => {
          const c = getCurrent();
          if (c === undefined) return;
          const params = c.params.map((p, i) =>
            i === index ? buildSetParam(p.name, valueInput.value) : p,
          );
          setAction({ type: "query", params });
        });
        context.registerControl(`/action/params/${index}/value`, valueInput);
        valueLabel.append(valueInput);
        valueLabel.hidden = operation === "remove";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.dataset.editorField = "true";
        remove.addEventListener("click", () => {
          const c = getCurrent();
          if (c === undefined) return;
          const params = c.params.filter((_, i) => i !== index);
          setAction({ type: "query", params });
          render();
        });

        row.append(nameLabel, operationLabel, valueLabel, remove);
        container.append(row);
      });

      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "Add parameter";
      add.dataset.editorField = "true";
      add.addEventListener("click", () => {
        const c = getCurrent();
        if (c === undefined) return;
        setAction({
          type: "query",
          params: [...c.params, buildSetParam("", "")],
        });
        render();
      });
      container.append(add);
    };

    render();
    return { destroy() {} };
  },

  defaultAction(): unknown {
    return {
      type: "query",
      params: [buildSetParam("", "")],
    };
  },
};
