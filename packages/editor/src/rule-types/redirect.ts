import { validateRedirectDestination } from "@rogatio/schema";
import type {
  EditorDiagnostic,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";

export function createRedirectRuleType(): RuleTypeFieldExtension {
  return {
    id: "redirect",
    label: "Redirect",
    actionField: "redirect",
    matches(rule) {
      return rule.type === "redirect";
    },
    defaultAction() {
      return { destination: "" };
    },
    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const document = context.document;
      const label = document.createElement("label");
      label.textContent = "Redirect destination URL";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 2048;
      const existing = context.getField("redirect.destination");
      input.value = typeof existing === "string" ? existing : "";
      input.addEventListener("input", () => {
        context.setField("redirect.destination", input.value);
      });
      context.registerControl("/redirect/destination", input);
      label.append(input);
      context.container.append(label);
      return {
        destroy() {
          input.removeEventListener("input", () => {});
        },
      };
    },
    validate(rule, rulePath): readonly EditorDiagnostic[] {
      const redirect = rule.redirect;
      const destination =
        redirect !== null &&
        typeof redirect === "object" &&
        typeof (redirect as Record<string, unknown>).destination === "string"
          ? ((redirect as Record<string, unknown>).destination as string)
          : "";
      const source = rule.source;
      const urlRegex =
        source !== null &&
        typeof source === "object" &&
        (source as Record<string, unknown>).key === "url" &&
        typeof (source as Record<string, unknown>).value === "string"
          ? ((source as Record<string, unknown>).value as string)
          : "";
      const issues = validateRedirectDestination(destination, urlRegex);
      return issues.map((issue) => ({
        code: `schema.${issue.code}`,
        severity: "error" as const,
        path: `${rulePath}/redirect/destination`,
        message: issue.message,
      }));
    },
  };
}
