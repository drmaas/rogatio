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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function replacementsOf(value: unknown): Replacement[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.replacements)) return undefined;
  return value.replacements as Replacement[];
}

function stable(values: EditorDiagnostic[]): readonly EditorDiagnostic[] {
  return [...values].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

export function createResponseBodyRuleType(): RuleTypeFieldExtension {
  return {
    id: "response-body",
    label: "Response body rewrite",
    actionField: "responseBody",
    matches(rule) {
      return (
        rule.type === "response-body" ||
        replacementsOf(rule.responseBody) !== undefined
      );
    },
    validate(rule, rulePath) {
      const replacements = replacementsOf(rule.responseBody);
      if (replacements === undefined) return [];
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
      return stable(diagnostics);
    },
    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const { document, container } = context;
      const render = (): void => {
        const current = replacementsOf(context.getField("responseBody"));
        container.replaceChildren();
        if (current === undefined) return;
        current.forEach((entry, index) => {
          const row = document.createElement("div");
          row.dataset.responseBodyReplacement = String(index);
          const pattern = document.createElement("input");
          pattern.type = "text";
          pattern.value = entry.pattern;
          pattern.placeholder = "Pattern";
          pattern.addEventListener("input", () => {
            const next = [
              ...(replacementsOf(context.getField("responseBody")) ?? []),
            ];
            next[index] = { ...next[index], pattern: pattern.value };
            context.setField("responseBody", { replacements: next });
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
            const next = [
              ...(replacementsOf(context.getField("responseBody")) ?? []),
            ];
            next[index] = { ...next[index], replacement: replacement.value };
            context.setField("responseBody", { replacements: next });
          });
          context.registerControl(
            `/responseBody/replacements/${index}/replacement`,
            replacement,
          );
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove replacement";
          remove.addEventListener("click", () => {
            const next = (
              replacementsOf(context.getField("responseBody")) ?? []
            ).filter((_, itemIndex) => itemIndex !== index);
            context.setField("responseBody", { replacements: next });
            render();
          });
          row.append(pattern, replacement, remove);
          container.append(row);
        });
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "Add replacement";
        add.addEventListener("click", () => {
          const next = [
            ...(replacementsOf(context.getField("responseBody")) ?? []),
            { pattern: "", replacement: "" },
          ];
          context.setField("responseBody", { replacements: next });
          render();
        });
        container.append(add);
      };
      render();
      return { destroy() {} };
    },
    defaultAction() {
      return { replacements: [{ pattern: "", replacement: "" }] };
    },
  };
}
