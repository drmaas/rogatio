import type {
  EditorDiagnostic,
  HeaderDirection,
  HeaderOperationKind,
  RuleTypeFieldContext,
  RuleTypeFieldExtension,
  RuleTypeFieldMount,
} from "../types.js";

const FORBIDDEN_REQUEST_HEADERS = Object.freeze([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

const FORBIDDEN_RESPONSE_HEADERS = Object.freeze([
  "connection",
  "content-encoding",
  "content-length",
  "date",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const);

const FORBIDDEN_REQUEST_PREFIXES = Object.freeze(["proxy-", "sec-"]);

function isForbiddenHeader(name: string, direction: HeaderDirection): boolean {
  const normalized = name.toLowerCase();
  const forbidden =
    direction === "request"
      ? FORBIDDEN_REQUEST_HEADERS
      : FORBIDDEN_RESPONSE_HEADERS;

  return (
    forbidden.includes(normalized as never) ||
    (direction === "request" &&
      FORBIDDEN_REQUEST_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      ))
  );
}

const HEADER_DIRECTIONS: ReadonlyArray<HeaderDirection> = [
  "request",
  "response",
];
const HEADER_OPERATIONS: ReadonlyArray<HeaderOperationKind> = [
  "set",
  "append",
  "remove",
];

function createSelect(
  document: Document,
  options: ReadonlyArray<string>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === value) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function createInput(
  document: Document,
  value: string,
  onChange: (value: string) => void,
  maxLength?: number,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  if (maxLength !== undefined) input.maxLength = maxLength;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

export function createHeaderRuleType(): RuleTypeFieldExtension {
  return {
    id: "header",
    label: "Header",
    matches(rule) {
      return rule.type === "header";
    },
    mount(context: RuleTypeFieldContext): RuleTypeFieldMount {
      const document = context.document;
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "Header rule";
      fieldset.append(legend);

      const directionLabel = document.createElement("label");
      directionLabel.textContent = "Direction";
      const directionValue =
        (context.getField("headerDirection") as HeaderDirection) ?? "request";
      const directionSelect = createSelect(
        document,
        HEADER_DIRECTIONS,
        directionValue,
        (value) => {
          context.setField("headerDirection", value);
        },
      );
      context.registerControl("/headerDirection", directionSelect);
      directionLabel.append(directionSelect);
      fieldset.append(directionLabel);

      const operationLabel = document.createElement("label");
      operationLabel.textContent = "Operation";
      const operationValue =
        (context.getField("headerOperation") as HeaderOperationKind) ?? "set";
      const operationSelect = createSelect(
        document,
        HEADER_OPERATIONS,
        operationValue,
        (value) => {
          context.setField("headerOperation", value);
        },
      );
      context.registerControl("/headerOperation", operationSelect);
      operationLabel.append(operationSelect);
      fieldset.append(operationLabel);

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Header name";
      const nameValue = (context.getField("headerName") as string) ?? "";
      const nameInput = createInput(
        document,
        nameValue,
        (value) => {
          context.setField("headerName", value);
        },
        256,
      );
      context.registerControl("/headerName", nameInput);
      nameLabel.append(nameInput);
      fieldset.append(nameLabel);

      const valueLabel = document.createElement("label");
      valueLabel.textContent = "Header value";
      const valueValue = (context.getField("headerValue") as string) ?? "";
      const valueInput = createInput(
        document,
        valueValue,
        (value) => {
          context.setField("headerValue", value);
        },
        4096,
      );
      context.registerControl("/headerValue", valueInput);
      valueLabel.append(valueInput);
      fieldset.append(valueLabel);

      context.container.append(fieldset);

      return {
        destroy() {
          directionSelect.removeEventListener("change", () => {});
          operationSelect.removeEventListener("change", () => {});
          nameInput.removeEventListener("input", () => {});
          valueInput.removeEventListener("input", () => {});
        },
      };
    },
    validate(rule, rulePath): readonly EditorDiagnostic[] {
      const diagnostics: EditorDiagnostic[] = [];
      const direction = rule.headerDirection as HeaderDirection | undefined;
      const operation = rule.headerOperation as HeaderOperationKind | undefined;
      const headerName = rule.headerName as string | undefined;
      const headerValue = rule.headerValue as string | undefined;

      if (!direction || !HEADER_DIRECTIONS.includes(direction)) {
        diagnostics.push({
          code: "schema.invalid-value",
          severity: "error",
          path: `${rulePath}/headerDirection`,
          message: 'Direction must be "request" or "response".',
        });
      }
      if (!operation || !HEADER_OPERATIONS.includes(operation)) {
        diagnostics.push({
          code: "schema.invalid-value",
          severity: "error",
          path: `${rulePath}/headerOperation`,
          message: 'Operation must be "set", "append", or "remove".',
        });
      }
      if (
        typeof headerName !== "string" ||
        headerName.length === 0 ||
        headerName.length > 256
      ) {
        diagnostics.push({
          code: "schema.out-of-range",
          severity: "error",
          path: `${rulePath}/headerName`,
          message: "Header name must be 1-256 characters.",
        });
      } else if (direction && isForbiddenHeader(headerName, direction)) {
        diagnostics.push({
          code: "extension.forbidden-header",
          severity: "error",
          path: `${rulePath}/headerName`,
          message: `Header "${headerName}" is forbidden for ${direction} headers.`,
        });
      }
      if (
        (operation === "set" || operation === "append") &&
        typeof headerValue !== "string"
      ) {
        diagnostics.push({
          code: "schema.required",
          severity: "error",
          path: `${rulePath}/headerValue`,
          message: "Header value is required for set and append operations.",
        });
      } else if (
        (operation === "set" || operation === "append") &&
        typeof headerValue === "string" &&
        headerValue.length > 4096
      ) {
        diagnostics.push({
          code: "schema.out-of-range",
          severity: "error",
          path: `${rulePath}/headerValue`,
          message: "Header value must be at most 4096 characters.",
        });
      }
      if (operation === "remove" && headerValue !== undefined) {
        diagnostics.push({
          code: "schema.unexpected",
          severity: "error",
          path: `${rulePath}/headerValue`,
          message: "Header value must not be provided for remove operation.",
        });
      }
      return diagnostics;
    },
  };
}
