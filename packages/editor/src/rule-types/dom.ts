export type SelectOption = string | { value: string; label: string };

function normalizeOption(option: SelectOption): {
  value: string;
  label: string;
} {
  if (typeof option === "string") {
    return { value: option, label: option };
  }
  return option;
}

export function createSelect(
  document: Document,
  options: ReadonlyArray<SelectOption>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (const option of options) {
    const { value: optionValue, label } = normalizeOption(option);
    const opt = document.createElement("option");
    opt.value = optionValue;
    opt.textContent = label;
    if (optionValue === value) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

export function createTextInput(
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
