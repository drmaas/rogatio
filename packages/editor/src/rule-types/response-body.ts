import { LIMITS } from "@rogatio/schema";
import type {
  EditorDiagnostic,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";

interface Replacement {
  pattern: string;
  replacement: string;
}

type ResponseBodyForm =
  | { mode: "replace"; body?: string }
  | { mode: "regex"; replacements: Replacement[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseBodyOf(value: unknown): ResponseBodyForm | undefined {
  if (!isRecord(value)) return undefined;
  if (value.mode === "replace") {
    return { mode: "replace", body: value.body as string | undefined };
  }
  if (value.mode === "regex" && Array.isArray(value.replacements)) {
    return {
      mode: "regex",
      replacements: value.replacements as Replacement[],
    };
  }
  if (Array.isArray(value.replacements)) {
    return {
      mode: "regex",
      replacements: value.replacements as Replacement[],
    };
  }
  return undefined;
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

function validateRegexReplacements(
  replacements: Replacement[],
  rulePath: string,
): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  if (
    replacements.length === 0 ||
    replacements.length > LIMITS.maxResponseBodyReplacements
  ) {
    diagnostics.push({
      code: "editor.response-body-replacements",
      severity: "error",
      path: `${rulePath}/responseBody/replacements`,
      message: `Response-body rules need 1-${LIMITS.maxResponseBodyReplacements} replacements.`,
    });
  }
  replacements.forEach((entry, index) => {
    const patternPath = `${rulePath}/responseBody/replacements/${index}/pattern`;
    const replacementPath = `${rulePath}/responseBody/replacements/${index}/replacement`;
    try {
      if (
        typeof entry?.pattern !== "string" ||
        entry.pattern.length === 0 ||
        entry.pattern.length > LIMITS.maxResponseBodyPatternLength
      )
        throw new Error();
      new RegExp(entry.pattern, "u");
    } catch {
      diagnostics.push({
        code: "editor.response-body-pattern",
        severity: "error",
        path: patternPath,
        message:
          "Replacement pattern must be a valid bounded regular expression.",
      });
    }
    if (
      typeof entry?.replacement !== "string" ||
      entry.replacement.length > LIMITS.maxResponseBodyReplacementLength
    ) {
      diagnostics.push({
        code: "editor.response-body-replacement",
        severity: "error",
        path: replacementPath,
        message: "Replacement text exceeds the permitted size.",
      });
    }
  });
  return diagnostics;
}

export function createResponseBodyRuleType(): RuleTypeFieldExtension {
  return {
    id: "response-body",
    label: "Response body",
    actionField: "responseBody",
    matches(rule) {
      return (
        rule.type === "response-body" ||
        responseBodyOf(rule.responseBody) !== undefined
      );
    },
    validate(rule, rulePath) {
      const raw = rule.responseBody;
      if (
        isRecord(raw) &&
        "mode" in raw &&
        raw.mode !== "replace" &&
        raw.mode !== "regex"
      ) {
        return stable([
          {
            code: "editor.response-body-mode",
            severity: "error",
            path: `${rulePath}/responseBody/mode`,
            message: 'responseBody.mode must be "replace" or "regex"',
          },
        ]);
      }
      const action = responseBodyOf(raw);
      if (action === undefined) {
        if (isRecord(raw) && raw.mode === "regex") {
          return stable(validateRegexReplacements([], rulePath));
        }
        return [];
      }
      const diagnostics: EditorDiagnostic[] = [];
      if (action.mode === "replace") {
        if (typeof action.body !== "string") {
          diagnostics.push({
            code: "editor.response-body-replace-body",
            severity: "error",
            path: `${rulePath}/responseBody/body`,
            message: "Replace mode requires a body string.",
          });
        } else if (action.body.length > LIMITS.maxResponseBodyBytes) {
          diagnostics.push({
            code: "editor.response-body-replace-body",
            severity: "error",
            path: `${rulePath}/responseBody/body`,
            message: `Replace body exceeds the maximum size of ${LIMITS.maxResponseBodyBytes} bytes.`,
          });
        } else if (hasLoneSurrogate(action.body)) {
          diagnostics.push({
            code: "editor.response-body-lone-surrogate",
            severity: "error",
            path: `${rulePath}/responseBody/body`,
            message: "Replace body must not contain lone UTF-16 surrogates.",
          });
        }
      } else {
        diagnostics.push(
          ...validateRegexReplacements(action.replacements, rulePath),
        );
      }
      return stable(diagnostics);
    },
    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const { document, container } = context;
      const currentReplacements = (): Replacement[] => {
        const action = responseBodyOf(context.getField("responseBody"));
        return action?.mode === "regex" ? action.replacements : [];
      };
      const renderRegexRows = (
        onUpdate: (next: Replacement[]) => void,
      ): void => {
        currentReplacements().forEach((entry, index) => {
          const row = document.createElement("div");
          row.dataset.responseBodyReplacement = String(index);
          const pattern = document.createElement("input");
          pattern.type = "text";
          pattern.value = entry.pattern;
          pattern.placeholder = "Pattern";
          pattern.addEventListener("input", () => {
            const next = [...currentReplacements()];
            next[index] = { ...next[index], pattern: pattern.value };
            onUpdate(next);
          });
          context.registerControl(
            `/responseBody/replacements/${index}/pattern`,
            pattern,
          );
          const replacement = document.createElement("input");
          replacement.type = "text";
          replacement.value = entry.replacement;
          replacement.placeholder = "Replacement";
          replacement.addEventListener("input", () => {
            const next = [...currentReplacements()];
            next[index] = { ...next[index], replacement: replacement.value };
            onUpdate(next);
          });
          context.registerControl(
            `/responseBody/replacements/${index}/replacement`,
            replacement,
          );
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove replacement";
          remove.addEventListener("click", () => {
            onUpdate(
              currentReplacements().filter(
                (_, itemIndex) => itemIndex !== index,
              ),
            );
            render();
          });
          row.append(pattern, replacement, remove);
          container.append(row);
        });
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "Add replacement";
        add.addEventListener("click", () => {
          onUpdate([
            ...currentReplacements(),
            { pattern: "", replacement: "" },
          ]);
          render();
        });
        container.append(add);
      };
      const render = (): void => {
        const current = responseBodyOf(context.getField("responseBody"));
        container.replaceChildren();
        if (current === undefined) return;

        const modeSelect = document.createElement("select");
        const replaceOption = document.createElement("option");
        replaceOption.value = "replace";
        replaceOption.textContent = "Replace body";
        const regexOption = document.createElement("option");
        regexOption.value = "regex";
        regexOption.textContent = "Regex rewrite";
        modeSelect.append(replaceOption, regexOption);
        modeSelect.value = current.mode;
        modeSelect.addEventListener("change", () => {
          if (modeSelect.value === "replace") {
            context.setField("responseBody", { mode: "replace", body: "" });
          } else {
            context.setField("responseBody", {
              mode: "regex",
              replacements: [{ pattern: "", replacement: "" }],
            });
          }
          render();
        });
        context.registerControl("/responseBody/mode", modeSelect);
        container.append(modeSelect);

        if (current.mode === "replace") {
          const bodyInput = document.createElement("textarea");
          bodyInput.value = current.body ?? "";
          bodyInput.placeholder = "Replacement body";
          bodyInput.addEventListener("input", () => {
            context.setField("responseBody", {
              mode: "replace",
              body: bodyInput.value,
            });
          });
          context.registerControl("/responseBody/body", bodyInput);
          container.append(bodyInput);
        } else {
          const stored = context.getField("responseBody");
          const writeRegex = (replacements: Replacement[]): void => {
            if (
              isRecord(stored) &&
              !("mode" in stored) &&
              Array.isArray(stored.replacements)
            ) {
              context.setField("responseBody", { replacements });
            } else {
              context.setField("responseBody", {
                mode: "regex",
                replacements,
              });
            }
          };
          renderRegexRows(writeRegex);
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
