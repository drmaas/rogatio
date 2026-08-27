import { LIMITS } from "@rogatio/schema";
import type {
  EditorDiagnostic,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestBodyOf(
  value: unknown,
):
  | { mode: string; body?: string; pattern?: string; replacement?: string }
  | undefined {
  if (!isRecord(value) || !("mode" in value)) return undefined;
  return value as {
    mode: string;
    body?: string;
    pattern?: string;
    replacement?: string;
  };
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) return true;
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      if (i === 0) return true;
      const prev = value.charCodeAt(i - 1);
      if (prev < 0xd800 || prev > 0xdbff) return true;
    }
  }
  return false;
}

function stable(values: EditorDiagnostic[]): readonly EditorDiagnostic[] {
  return [...values].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

export function createRequestBodyRuleType(): RuleTypeFieldExtension {
  return {
    id: "request-body",
    label: "Request body",
    actionField: "requestBody",
    matches(rule) {
      return (
        rule.type === "request-body" ||
        requestBodyOf(rule.requestBody) !== undefined
      );
    },
    validate(rule, rulePath) {
      const action = requestBodyOf(rule.requestBody);
      if (action === undefined) return [];
      const diagnostics: EditorDiagnostic[] = [];
      if (action.mode !== "replace" && action.mode !== "regex") {
        diagnostics.push({
          code: "editor.request-body-mode",
          severity: "error",
          path: `${rulePath}/requestBody/mode`,
          message: 'requestBody.mode must be "replace" or "regex"',
        });
      }
      if (action.mode === "replace") {
        if (typeof action.body !== "string") {
          diagnostics.push({
            code: "editor.request-body-replace-body",
            severity: "error",
            path: `${rulePath}/requestBody/body`,
            message: "Replace mode requires a body string.",
          });
        } else if (action.body.length > LIMITS.maxRequestBodyBytes) {
          diagnostics.push({
            code: "editor.request-body-replace-body",
            severity: "error",
            path: `${rulePath}/requestBody/body`,
            message: `Replace body exceeds the maximum size of ${LIMITS.maxRequestBodyBytes} bytes.`,
          });
        } else if (hasLoneSurrogate(action.body)) {
          diagnostics.push({
            code: "editor.request-body-lone-surrogate",
            severity: "error",
            path: `${rulePath}/requestBody/body`,
            message: "Replace body must not contain lone UTF-16 surrogates.",
          });
        }
      }
      if (action.mode === "regex") {
        if (typeof action.pattern !== "string" || action.pattern.length === 0) {
          diagnostics.push({
            code: "editor.request-body-pattern",
            severity: "error",
            path: `${rulePath}/requestBody/pattern`,
            message: "Regex mode requires a non-empty pattern string.",
          });
        } else if (action.pattern.length > LIMITS.maxRequestBodyPatternLength) {
          diagnostics.push({
            code: "editor.request-body-pattern",
            severity: "error",
            path: `${rulePath}/requestBody/pattern`,
            message: `Regex pattern exceeds the maximum length of ${LIMITS.maxRequestBodyPatternLength} characters.`,
          });
        } else if (hasLoneSurrogate(action.pattern)) {
          diagnostics.push({
            code: "editor.request-body-lone-surrogate",
            severity: "error",
            path: `${rulePath}/requestBody/pattern`,
            message: "Regex pattern must not contain lone UTF-16 surrogates.",
          });
        } else {
          try {
            new RegExp(action.pattern, "u");
          } catch {
            diagnostics.push({
              code: "editor.request-body-pattern",
              severity: "error",
              path: `${rulePath}/requestBody/pattern`,
              message: "Regex pattern must be a valid regular expression.",
            });
          }
        }
        if (
          typeof action.replacement !== "string" ||
          action.replacement.length > LIMITS.maxRequestBodyReplacementLength
        ) {
          diagnostics.push({
            code: "editor.request-body-replacement",
            severity: "error",
            path: `${rulePath}/requestBody/replacement`,
            message: `Regex replacement exceeds the maximum length of ${LIMITS.maxRequestBodyReplacementLength} characters.`,
          });
        } else if (hasLoneSurrogate(action.replacement)) {
          diagnostics.push({
            code: "editor.request-body-lone-surrogate",
            severity: "error",
            path: `${rulePath}/requestBody/replacement`,
            message:
              "Regex replacement must not contain lone UTF-16 surrogates.",
          });
        }
      }
      if (
        rule.method !== "POST" &&
        rule.method !== "PUT" &&
        rule.method !== "PATCH"
      ) {
        diagnostics.push({
          code: "editor.request-body-method",
          severity: "error",
          path: `${rulePath}/method`,
          message:
            'Request-body rules require method "POST", "PUT", or "PATCH".',
        });
      }
      const resourceTypes = rule.resourceTypes;
      if (
        !Array.isArray(resourceTypes) ||
        resourceTypes.length !== 1 ||
        resourceTypes[0] !== "xmlhttprequest"
      ) {
        diagnostics.push({
          code: "editor.request-body-resource-types",
          severity: "error",
          path: `${rulePath}/resourceTypes`,
          message:
            'Request-body rules require exactly one resource type: "xmlhttprequest".',
        });
      }
      return stable(diagnostics);
    },
    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const { document, container } = context;
      const render = (): void => {
        const current = requestBodyOf(context.getField("requestBody"));
        container.replaceChildren();
        if (current === undefined) return;

        const modeSelect = document.createElement("select");
        modeSelect.value = current.mode;
        const replaceOption = document.createElement("option");
        replaceOption.value = "replace";
        replaceOption.textContent = "Replace body";
        const regexOption = document.createElement("option");
        regexOption.value = "regex";
        regexOption.textContent = "Regex replace";
        modeSelect.append(replaceOption, regexOption);
        modeSelect.addEventListener("change", () => {
          const next = { ...current, mode: modeSelect.value };
          if (modeSelect.value === "replace") {
            delete next.pattern;
            delete next.replacement;
          } else {
            delete next.body;
          }
          context.setField("requestBody", next);
          render();
        });
        context.registerControl("/requestBody/mode", modeSelect);
        container.append(modeSelect);

        if (current.mode === "replace") {
          const bodyInput = document.createElement("textarea");
          bodyInput.value = current.body ?? "";
          bodyInput.placeholder = "Replacement body";
          bodyInput.addEventListener("input", () => {
            const next = { ...current, body: bodyInput.value };
            context.setField("requestBody", next);
          });
          context.registerControl("/requestBody/body", bodyInput);
          container.append(bodyInput);
        } else {
          const patternInput = document.createElement("input");
          patternInput.type = "text";
          patternInput.value = current.pattern ?? "";
          patternInput.placeholder = "Regex pattern";
          patternInput.addEventListener("input", () => {
            const next = { ...current, pattern: patternInput.value };
            context.setField("requestBody", next);
          });
          context.registerControl("/requestBody/pattern", patternInput);
          container.append(patternInput);

          const replacementInput = document.createElement("input");
          replacementInput.type = "text";
          replacementInput.value = current.replacement ?? "";
          replacementInput.placeholder = "Replacement";
          replacementInput.addEventListener("input", () => {
            const next = { ...current, replacement: replacementInput.value };
            context.setField("requestBody", next);
          });
          context.registerControl("/requestBody/replacement", replacementInput);
          container.append(replacementInput);
        }
      };
      render();
      return { destroy() {} };
    },
    defaultAction() {
      return { mode: "replace", body: "" };
    },
  };
}
