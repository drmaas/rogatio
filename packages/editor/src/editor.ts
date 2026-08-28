import type { HttpMethod, ResourceType } from "@rogatio/schema";
import { hasControl } from "@rogatio/schema";
import { builtInRuleTypes } from "./rule-types/index.js";
import {
  type DryRunResult,
  type DryRunTestCase,
  type EditorController,
  type EditorDiagnostic,
  EditorInitializationError,
  type EditorOptions,
  type EditorProjectSnapshot,
  type RuleTypeFieldContext,
  type RuleTypeFieldExtension,
} from "./types.js";
import { urlToExactRegex } from "./url.js";

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "media",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const satisfies readonly ResourceType[];

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
] as const satisfies readonly HttpMethod[];

const COMMON_RULE_FIELDS = new Set([
  "id",
  "name",
  "urlRegex",
  "origins",
  "resourceTypes",
  "priority",
  "method",
  "type",
]);
const FORBIDDEN_EXTENSION_FIELDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const MAX_SNAPSHOT_ARRAY_LENGTH = 4096;
const F2_MAX_URL_REGEX_LENGTH = 2048;
let editorInstanceCount = 0;

const EDITOR_CSS = `
.rogatio-editor {
  --editor-border: #7a8491;
  --editor-muted: #46515d;
  --editor-accent: #1559a6;
  --editor-danger: #b42318;
  box-sizing: border-box;
  color: #17212b;
  background: #ffffff;
  font: 1rem/1.5 system-ui, sans-serif;
}
.rogatio-editor *, .rogatio-editor *::before, .rogatio-editor *::after {
  box-sizing: border-box;
}
.rogatio-editor button, .rogatio-editor input, .rogatio-editor select,
.rogatio-editor textarea {
  color: inherit;
  font: inherit;
}
.rogatio-editor button {
  border: 1px solid var(--editor-border);
  border-radius: 0.35rem;
  background: #f6f8fa;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}
.rogatio-editor button:hover:not(:disabled) {
  background: #e9f1fb;
}
.rogatio-editor button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.rogatio-editor :focus-visible {
  outline: 3px solid var(--editor-accent);
  outline-offset: 2px;
}
.rogatio-editor [data-editor-layout] {
  display: grid;
  grid-template-columns: minmax(12rem, 17rem) minmax(0, 1fr);
  min-width: 0;
}
.rogatio-editor [data-desktop-route-rail] {
  align-self: start;
  position: sticky;
  top: 0;
  display: grid;
  gap: 0.35rem;
  border-right: 1px solid var(--editor-border);
  padding: 1rem;
}
.rogatio-editor [data-desktop-route-rail] button {
  text-align: left;
}
.rogatio-editor [data-desktop-route-rail] button[aria-current="page"] {
  border-color: var(--editor-accent);
  font-weight: 700;
}
.rogatio-editor [data-editor-main] {
  min-width: 0;
  padding: 1rem clamp(1rem, 3vw, 3rem) 3rem;
}
.rogatio-editor [data-editor-header] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 24rem);
  gap: 1rem;
  align-items: end;
  margin-bottom: 1rem;
}
.rogatio-editor [data-editor-header] h1,
.rogatio-editor [data-editor-form] h2,
.rogatio-editor [data-editor-form] h3 {
  overflow-wrap: anywhere;
}
.rogatio-editor [data-dirty-state] {
  color: var(--editor-muted);
  font-weight: 600;
}
.rogatio-editor [data-editor-header] label,
.rogatio-editor [data-editor-field] > label {
  display: grid;
  gap: 0.3rem;
  font-weight: 650;
}
.rogatio-editor input:not([type="checkbox"]),
.rogatio-editor select,
.rogatio-editor textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--editor-border);
  border-radius: 0.3rem;
  background: #ffffff;
  padding: 0.45rem 0.55rem;
}
.rogatio-editor textarea {
  min-height: 5rem;
  resize: vertical;
}
.rogatio-editor [data-mobile-route-nav] {
  display: none;
}
.rogatio-editor [data-editor-status] {
  min-height: 1.5rem;
  margin-block: 0.5rem;
  color: var(--editor-muted);
}
.rogatio-editor [data-editor-summary] {
  margin-block: 1rem;
  border: 2px solid var(--editor-danger);
  border-radius: 0.4rem;
  padding: 0.8rem 1rem;
}
.rogatio-editor [data-editor-summary] h2 {
  margin-top: 0;
  font-size: 1.1rem;
}
.rogatio-editor [data-editor-summary] ul {
  margin-bottom: 0;
}
.rogatio-editor [data-editor-summary] button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  text-align: left;
  text-decoration: underline;
}
.rogatio-editor [data-editor-command-bar] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 1rem;
}
.rogatio-editor [data-editor-form] {
  display: grid;
  gap: 1rem;
}
.rogatio-editor fieldset {
  min-width: 0;
  border: 1px solid var(--editor-border);
  border-radius: 0.4rem;
  padding: 1rem;
}
.rogatio-editor legend {
  padding-inline: 0.35rem;
  font-weight: 750;
}
.rogatio-editor [data-editor-fields] {
  display: grid;
  gap: 0.85rem;
}
.rogatio-editor [data-editor-field] {
  min-width: 0;
}
.rogatio-editor [data-editor-field] > small {
  display: block;
  margin-top: 0.25rem;
  color: var(--editor-muted);
}
.rogatio-editor [data-editor-field-error] {
  margin-top: 0.25rem;
  color: var(--editor-danger);
  font-weight: 650;
}
.rogatio-editor [data-editor-origin-row] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: end;
  margin-bottom: 0.5rem;
}
.rogatio-editor [data-editor-url-row] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: end;
}
.rogatio-editor [data-editor-checks] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.35rem 0.7rem;
}
.rogatio-editor [data-editor-checks] label {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-weight: 500;
}
.rogatio-editor [data-rule-card] {
  display: grid;
  gap: 1rem;
  border: 1px solid var(--editor-border);
  border-radius: 0.4rem;
  padding: 1rem;
}
.rogatio-editor [data-rule-card] h3 {
  margin: 0;
}
.rogatio-editor [data-rule-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.rogatio-editor [data-search-results] {
  margin-block: 1rem;
  border-block: 1px solid var(--editor-border);
  padding-block: 0.8rem;
}
.rogatio-editor [data-search-results] h2 {
  margin-top: 0;
}
.rogatio-editor [data-search-results] ul {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0;
  padding-left: 1.2rem;
}
.rogatio-editor [data-search-results] button {
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  text-decoration: underline;
}
.rogatio-editor [data-editor-confirmation] {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 45%);
}
.rogatio-editor [data-editor-dialog] {
  width: min(32rem, 100%);
  border: 2px solid var(--editor-border);
  border-radius: 0.5rem;
  background: #ffffff;
  padding: 1rem;
}
.rogatio-editor [data-editor-dialog] h2 {
  margin-top: 0;
}
.rogatio-editor [data-editor-dialog-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.rogatio-editor [data-editor-visually-hidden] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 48rem) {
  .rogatio-editor [data-editor-layout] {
    display: block;
  }
  .rogatio-editor [data-desktop-route-rail] {
    display: none;
  }
  .rogatio-editor [data-mobile-route-nav] {
    display: grid;
    gap: 0.3rem;
    margin-block: 1rem;
  }
  .rogatio-editor [data-editor-header] {
    grid-template-columns: 1fr;
  }
}
@media (forced-colors: active) {
  .rogatio-editor {
    --editor-border: ButtonText;
    --editor-muted: ButtonText;
    --editor-accent: Highlight;
    --editor-danger: Mark;
    color: CanvasText;
    background: Canvas;
  }
  .rogatio-editor button,
  .rogatio-editor input:not([type="checkbox"]),
  .rogatio-editor select,
  .rogatio-editor textarea,
  .rogatio-editor fieldset,
  .rogatio-editor [data-rule-card] {
    border-color: ButtonText;
    background: Canvas;
  }
  .rogatio-editor :focus-visible {
    outline-color: Highlight;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rogatio-editor *, .rogatio-editor *::before, .rogatio-editor *::after {
    scroll-behavior: auto !important;
    transition: none !important;
  }
}
.rogatio-editor [data-test-description] {
  color: var(--editor-muted);
  margin-block: 0 1rem;
}
.rogatio-editor [data-test-panel] {
  display: grid;
  gap: 1rem;
}
.rogatio-editor [data-test-defaults] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.rogatio-editor [data-test-result-card] {
  display: grid;
  gap: 0.5rem;
  border: 1px solid var(--editor-border);
  border-radius: 0.4rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}
.rogatio-editor [data-test-result-card][data-matched="false"] {
  border-style: dashed;
}
.rogatio-editor [data-test-result-header] {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.rogatio-editor [data-test-rule] {
  padding: 0.5rem;
  border-radius: 0.3rem;
  background: #f6f8fa;
}
.rogatio-editor [data-test-rule-header] {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.rogatio-editor [data-test-dimension] {
  font-size: 0.85rem;
  margin-top: 0.2rem;
}
.rogatio-editor [data-test-badge] {
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  margin-right: 0.5rem;
}
.rogatio-editor [data-test-badge][data-variant="matched"] {
  background: #dcfce7;
  color: #166534;
}
.rogatio-editor [data-test-badge][data-variant="unmatched"] {
  background: #fee2e2;
  color: #991b1b;
}
.rogatio-editor [data-test-badge][data-variant="na"] {
  background: #e5e7eb;
  color: #374151;
}
.rogatio-editor [data-test-errors] {
  margin-block: 0 1rem;
  color: var(--editor-danger);
}
.rogatio-editor [data-test-action-preview] {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: var(--editor-muted);
}
@media (forced-colors: active) {
  .rogatio-editor [data-test-rule] {
    border: 1px solid ButtonText;
    background: Canvas;
  }
  .rogatio-editor [data-test-badge] {
    border: 1px solid ButtonText;
  }
}
`;

type JsonRecord = Record<string, unknown>;
type DraftRule = JsonRecord & {
  id: unknown;
  name: unknown;
  urlRegex: unknown;
  origins: unknown[];
  resourceTypes: unknown[];
  priority: unknown;
  method?: unknown;
};
type DraftGroup = JsonRecord & {
  id: unknown;
  name: unknown;
  origins: unknown[];
  rules: DraftRule[];
};
type DraftProject = JsonRecord & {
  version: unknown;
  name: unknown;
  groups: DraftGroup[];
};
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Route =
  | { kind: "project" }
  | { kind: "group"; groupId: string }
  | { kind: "test" };
type Confirmation =
  | { kind: "cancel" }
  | { kind: "remove-group"; groupId: string; name: string }
  | {
      kind: "remove-rule";
      groupId: string;
      ruleId: string;
      name: string;
    };
type FocusSnapshot = {
  key: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};
type SnapshotResult = { valid: true; value: unknown } | { valid: false };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotOwnData(
  value: unknown,
  ancestors = new WeakSet<object>(),
): SnapshotResult {
  if (value === null || typeof value !== "object") {
    return { valid: true, value };
  }
  if (ancestors.has(value)) return { valid: false };

  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return { valid: false };
    }
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_SNAPSHOT_ARRAY_LENGTH
      ) {
        return { valid: false };
      }
      const length = lengthDescriptor.value;
      for (const propertyName of Object.getOwnPropertyNames(value)) {
        if (propertyName === "length") continue;
        const index = Number(propertyName);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= length ||
          String(index) !== propertyName
        ) {
          return { valid: false };
        }
      }
      const snapshot: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          return { valid: false };
        }
        const child = snapshotOwnData(descriptor.value, ancestors);
        if (!child.valid) return child;
        snapshot[index] = child.value;
      }
      return { valid: true, value: snapshot };
    }

    const snapshot: JsonRecord = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return { valid: false };
      }
      const child = snapshotOwnData(descriptor.value, ancestors);
      if (!child.valid) return child;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: child.value,
        writable: true,
      });
    }
    return { valid: true, value: snapshot };
  } catch {
    return { valid: false };
  } finally {
    ancestors.delete(value);
  }
}

function cloneSnapshot(value: unknown): unknown {
  const result = snapshotOwnData(value);
  if (!result.valid) throw new Error("editor snapshot invariant failed");
  return result.value;
}

function freezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    freezeSnapshot((value as JsonRecord)[key], seen);
  }
  return value;
}

function asDraftProject(value: unknown): DraftProject | undefined {
  if (!isRecord(value) || !Array.isArray(value.groups)) return undefined;
  for (const group of value.groups) {
    if (!isRecord(group) || !Array.isArray(group.rules)) return undefined;
    for (const rule of group.rules) {
      if (!isRecord(rule)) return undefined;
    }
  }
  return value as DraftProject;
}

function encodePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function decodePointer(path: string): string[] | undefined {
  if (path === "") return [];
  if (!path.startsWith("/")) return undefined;
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function pointer(...segments: (string | number)[]): string {
  return segments.length === 0
    ? ""
    : `/${segments.map((segment) => encodePointerSegment(String(segment))).join("/")}`;
}

function arrayIndex(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return undefined;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : undefined;
}

function valueAtPath(root: unknown, path: string): unknown {
  const segments = decodePointer(path);
  if (!segments) return undefined;
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === undefined || !Object.hasOwn(current, index))
        return undefined;
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function setValueAtPath(root: unknown, path: string, value: unknown): boolean {
  const segments = decodePointer(path);
  if (!segments || segments.length === 0) return false;
  let current: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (Array.isArray(current)) {
      const childIndex = arrayIndex(segment);
      if (childIndex === undefined || !Object.hasOwn(current, childIndex)) {
        return false;
      }
      current = current[childIndex];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return false;
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = arrayIndex(finalSegment);
    if (index === undefined || !Object.hasOwn(current, index)) return false;
    if (Object.is(current[index], value)) return false;
    current[index] = value;
    return true;
  }
  if (!isRecord(current)) return false;
  if (
    !Object.hasOwn(current, finalSegment) &&
    finalSegment !== "description" &&
    finalSegment !== "method" &&
    finalSegment !== "type" &&
    finalSegment !== "action" &&
    finalSegment !== "redirect" &&
    finalSegment !== "mock"
  ) {
    return false;
  }
  if (Object.is(current[finalSegment], value)) return false;
  Object.defineProperty(current, finalSegment, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return true;
}

function deleteValueAtPath(root: unknown, path: string): boolean {
  const segments = decodePointer(path);
  if (!segments || segments.length === 0) return false;
  const parentPath = pointer(...segments.slice(0, -1));
  const parent = valueAtPath(root, parentPath);
  const key = segments[segments.length - 1];
  if (!isRecord(parent) || !Object.hasOwn(parent, key)) return false;
  return delete parent[key];
}

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function diagnostic(
  code: string,
  path: string,
  message: string,
): EditorDiagnostic {
  return { code, severity: "error", path, message };
}

function stableDiagnostics(
  diagnostics: readonly EditorDiagnostic[],
): EditorDiagnostic[] {
  const compareCodeUnits = (left: string, right: string): number => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  };
  return diagnostics
    .map((value) => ({
      code: value.code,
      severity: "error" as const,
      path: value.path,
      message: value.message,
    }))
    .sort(
      (left, right) =>
        compareCodeUnits(left.path, right.path) ||
        compareCodeUnits(left.code, right.code) ||
        compareCodeUnits(left.message, right.message),
    );
}

function normalizeDiagnostics(value: unknown): EditorDiagnostic[] {
  if (!Array.isArray(value)) {
    return [
      diagnostic(
        "editor.validation-failed",
        "",
        "Project validation could not be completed.",
      ),
    ];
  }
  const diagnostics: EditorDiagnostic[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const code = item.code;
    const path = item.path;
    const message = item.message;
    if (
      typeof code === "string" &&
      typeof path === "string" &&
      typeof message === "string"
    ) {
      diagnostics.push(diagnostic(code, path, message));
    }
  }
  return stableDiagnostics(diagnostics);
}

function isValidExtensionName(name: string): boolean {
  return (
    name.length > 0 &&
    !COMMON_RULE_FIELDS.has(name) &&
    !FORBIDDEN_EXTENSION_FIELDS.has(name) &&
    !hasControl(name)
  );
}

const ACTION_FIELDS = ["redirect", "action", "mock"] as const;

function clearActionFields(rule: unknown, keep?: string): boolean {
  if (!isRecord(rule)) return false;
  let changed = false;
  for (const field of ACTION_FIELDS) {
    if (field === keep) continue;
    if (Object.hasOwn(rule, field)) {
      delete rule[field];
      changed = true;
    }
  }
  return changed;
}

function extensionFieldParent(
  rule: JsonRecord,
  name: string,
): { parent: JsonRecord; key: string } | undefined {
  const segments = name.split(".");
  if (segments.length === 0) return undefined;
  let current: unknown = rule;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isRecord(current)) return undefined;
    const next = (current as JsonRecord)[segments[index]];
    if (!isRecord(next)) {
      const created: JsonRecord = {};
      Object.defineProperty(current as JsonRecord, segments[index], {
        configurable: true,
        enumerable: true,
        value: created,
        writable: true,
      });
      current = created;
    } else {
      current = next;
    }
  }
  if (!isRecord(current)) return undefined;
  return { parent: current, key: segments[segments.length - 1] };
}

function toSearchText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).normalize("NFKC").toLowerCase()
    : "";
}

function displayName(value: unknown, fallback: string): string {
  const text = safeText(value, fallback);
  return text.length > 0 ? text : fallback;
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as HTMLElement).nodeType === 1 &&
    typeof (value as HTMLElement).appendChild === "function"
  );
}

function normalizeExtensions(
  value: readonly RuleTypeFieldExtension[] | undefined,
): readonly RuleTypeFieldExtension[] {
  const ids = new Set<string>();
  const merged: RuleTypeFieldExtension[] = [...builtInRuleTypes];
  for (const extension of builtInRuleTypes) ids.add(extension.id);
  if (value === undefined) return Object.freeze(merged);
  if (!Array.isArray(value)) {
    throw new EditorInitializationError([
      diagnostic(
        "editor.extension-registration",
        "",
        "Rule-type extensions are invalid.",
      ),
    ]);
  }
  const passedIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const extension = value[index];
    if (
      !extension ||
      typeof extension.id !== "string" ||
      extension.id.length === 0 ||
      typeof extension.label !== "string" ||
      extension.label.length === 0 ||
      typeof extension.matches !== "function" ||
      typeof extension.mount !== "function" ||
      typeof extension.validate !== "function" ||
      passedIds.has(extension.id)
    ) {
      throw new EditorInitializationError([
        diagnostic(
          "editor.extension-registration",
          `/ruleTypes/${index}`,
          "Rule-type extension registration is invalid or duplicated.",
        ),
      ]);
    }
    passedIds.add(extension.id);
    const existing = merged.findIndex((e) => e.id === extension.id);
    if (existing >= 0) merged[existing] = extension;
    else merged.push(extension);
    ids.add(extension.id);
  }
  return Object.freeze(merged);
}

class EditorControllerImpl implements EditorController {
  private readonly root: HTMLElement;
  private readonly document: Document;
  private readonly options: EditorOptions;
  private readonly extensions: readonly RuleTypeFieldExtension[];
  private readonly instanceId: string;
  private readonly host: HTMLDivElement;
  private readonly rail: HTMLElement;
  private readonly main: HTMLElement;
  private readonly header: HTMLElement;
  private readonly status: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly commandBar: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly searchResults: HTMLElement;
  private draft: DraftProject;
  private committed: DraftProject;
  private revision = 0;
  private route: Route = { kind: "project" };
  private searchQuery = "";
  private errors: EditorDiagnostic[] = [];
  private readonly conversionDiagnostics = new Map<string, EditorDiagnostic>();
  private readonly extensionErrors = new Map<string, EditorDiagnostic>();
  private readonly urlInputs = new Map<string, string>();
  private readonly controls = new Map<string, HTMLElement>();
  private readonly extensionControls = new Map<string, HTMLElement>();
  private extensionCleanups: Array<() => void> = [];
  private confirmation: Confirmation | undefined;
  private focusRequest: string | undefined;
  private saving = false;
  private destroyed = false;
  private composing = false;
  private statusMessage = "";
  private controlNumber = 0;
  private previousFocus: FocusSnapshot | undefined;
  private testUrls = "";
  private testMethod: HttpMethod | "" = "";
  private testResourceType: ResourceType | "" = "";
  private testMaxCases = "256";
  private testResult: DryRunResult | undefined = undefined;
  private testRunning = false;
  private testRequestId = 0;

  constructor(
    options: EditorOptions,
    initial: DraftProject,
    extensions: readonly RuleTypeFieldExtension[],
  ) {
    this.root = options.root;
    this.document = options.root.ownerDocument;
    this.options = options;
    this.extensions = extensions;
    this.instanceId = `rogatio-editor-${++editorInstanceCount}`;
    this.draft = initial;
    this.committed = cloneSnapshot(initial) as DraftProject;

    const initialDiagnostics = this.collectDiagnostics(this.draft);
    if (initialDiagnostics.length > 0) {
      throw new EditorInitializationError(initialDiagnostics);
    }

    this.host = this.document.createElement("div");
    this.host.className = "rogatio-editor";
    this.host.dataset.rogatioEditor = "true";
    const style = this.document.createElement("style");
    style.textContent = EDITOR_CSS;
    this.host.append(style);

    const layout = this.document.createElement("div");
    layout.dataset.editorLayout = "true";
    this.rail = this.document.createElement("nav");
    this.rail.dataset.desktopRouteRail = "true";
    this.rail.setAttribute("aria-label", "Project sections");
    this.main = this.document.createElement("main");
    this.main.dataset.editorMain = "true";
    this.header = this.document.createElement("header");
    this.header.dataset.editorHeader = "true";
    this.status = this.document.createElement("p");
    this.status.dataset.editorStatus = "true";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.summary = this.document.createElement("section");
    this.summary.dataset.editorSummary = "true";
    this.summary.setAttribute("role", "alert");
    this.commandBar = this.document.createElement("div");
    this.commandBar.dataset.editorCommandBar = "true";
    this.commandBar.setAttribute("role", "toolbar");
    this.commandBar.setAttribute("aria-label", "Editor commands");
    this.form = this.document.createElement("form");
    this.form.dataset.editorForm = "true";
    this.form.noValidate = true;
    this.searchResults = this.document.createElement("section");
    this.searchResults.dataset.searchResults = "true";

    this.main.append(
      this.header,
      this.status,
      this.summary,
      this.commandBar,
      this.form,
      this.searchResults,
    );
    layout.append(this.rail, this.main);
    this.host.append(layout);
    this.root.append(this.host);

    this.host.addEventListener("click", this.handleClick);
    this.host.addEventListener("input", this.handleInput);
    this.host.addEventListener("change", this.handleChange);
    this.host.addEventListener("submit", this.handleSubmit);
    this.host.addEventListener("keydown", this.handleKeydown);
    this.host.addEventListener("compositionstart", this.handleCompositionStart);
    this.host.addEventListener("compositionend", this.handleCompositionEnd);
    this.render();
  }

  getDraft(): EditorProjectSnapshot {
    return cloneSnapshot(this.draft) as EditorProjectSnapshot;
  }

  isDirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.committed);
  }

  validate(): readonly EditorDiagnostic[] {
    if (this.destroyed) return [];
    this.errors = this.validateCurrent();
    this.statusMessage =
      this.errors.length === 0
        ? "Project is valid."
        : `${this.errors.length} validation error${
            this.errors.length === 1 ? "" : "s"
          } found.`;
    this.focusRequest = this.errors[0]?.path;
    this.render();
    return this.errors.map((value) => ({ ...value }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanupExtensions();
    this.host.removeEventListener("click", this.handleClick);
    this.host.removeEventListener("input", this.handleInput);
    this.host.removeEventListener("change", this.handleChange);
    this.host.removeEventListener("submit", this.handleSubmit);
    this.host.removeEventListener("keydown", this.handleKeydown);
    this.host.removeEventListener(
      "compositionstart",
      this.handleCompositionStart,
    );
    this.host.removeEventListener("compositionend", this.handleCompositionEnd);
    this.host.remove();
  }

  private readonly handleClick = (event: Event): void => {
    if (this.destroyed) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = target.closest<HTMLElement>(
      "[data-command], [data-route], [data-search-result], [data-error-path]",
    );
    if (!element) return;

    if (element.dataset.route !== undefined) {
      this.navigate(element.dataset.route, element.dataset.groupId);
      return;
    }
    if (element.dataset.searchResult !== undefined) {
      this.navigateToSearchResult(element.dataset.searchResult);
      return;
    }
    if (element.dataset.errorPath !== undefined) {
      this.navigateToPath(element.dataset.errorPath);
      return;
    }

    const command = element.dataset.command;
    if (!command) return;
    this.dispatchCommand(command, element);
  };

  private readonly handleInput = (event: Event): void => {
    if (this.destroyed || this.saving) return;
    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }
    if (target.dataset.urlSource !== undefined) {
      const ruleId = target.dataset.ruleId;
      if (ruleId) this.urlInputs.set(ruleId, target.value);
      return;
    }
    if (target.dataset.search !== undefined) {
      this.searchQuery = target.value;
      this.render();
      return;
    }
    if (target.dataset.testUrls !== undefined) {
      this.testUrls = target.value;
      return;
    }
    if (target.dataset.testMaxCases !== undefined) {
      this.testMaxCases = target.value;
      return;
    }
    const path = target.dataset.path;
    if (!path || target.type === "checkbox" || this.extensionControls.has(path))
      return;
    if (this.updateCommonField(path, target.value)) {
      if (!this.composing) this.render();
    }
  };

  private readonly handleChange = (event: Event): void => {
    if (this.destroyed || this.saving) return;
    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement
      )
    ) {
      return;
    }
    if (
      target.dataset.mobileRoute !== undefined &&
      target instanceof HTMLSelectElement
    ) {
      const selectedOption = target.options[target.selectedIndex];
      const groupId = selectedOption?.dataset.groupId;
      this.navigate(target.value, groupId);
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      target.dataset.resourcePath !== undefined
    ) {
      this.updateResourceTypes(
        target.dataset.resourcePath,
        target.dataset.resourceType ?? "",
        target.checked,
      );
      return;
    }
    if (
      target instanceof HTMLSelectElement &&
      target.dataset.ruleTypeSelect !== undefined
    ) {
      const ruleTypePath = target.dataset.ruleTypePath ?? "";
      if (ruleTypePath) this.setRuleType(ruleTypePath, target.value);
      return;
    }
    if (
      target instanceof HTMLSelectElement &&
      target.dataset.testMethod !== undefined
    ) {
      this.testMethod = (target.value || "") as HttpMethod | "";
      return;
    }
    if (
      target instanceof HTMLSelectElement &&
      target.dataset.testResourceType !== undefined
    ) {
      this.testResourceType = (target.value || "") as ResourceType | "";
      return;
    }
    const path = target.dataset.path;
    if (!path || this.extensionControls.has(path)) return;
    if (this.updateCommonField(path, target.value)) this.render();
  };

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    this.dispatchCommand("save", this.form);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.confirmation) {
      event.preventDefault();
      this.confirmation = undefined;
      this.statusMessage = "No changes were discarded.";
      this.render();
    }
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly handleCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const path = target.dataset.path;
      if (path && this.updateCommonField(path, target.value)) this.render();
    }
  };

  private dispatchCommand(command: string, element: HTMLElement): void {
    if (command === "validate") {
      this.validate();
      return;
    }
    if (command === "save") {
      void this.saveDraft();
      return;
    }
    if (command === "cancel") {
      this.requestCancel();
      return;
    }
    if (command === "confirm-cancel") {
      this.discardChanges();
      return;
    }
    if (command === "cancel-confirmation") {
      this.confirmation = undefined;
      this.statusMessage = "No changes were discarded.";
      this.render();
      return;
    }
    if (command === "confirm-remove") {
      this.confirmRemoval();
      return;
    }
    if (command === "remove-confirmation") {
      this.confirmation = undefined;
      this.statusMessage = "Removal cancelled.";
      this.render();
      return;
    }
    if (command === "add-group") {
      this.addGroup();
      return;
    }
    if (command === "add-rule") {
      const groupId = element.dataset.groupId ?? this.currentGroupId();
      if (groupId) this.addRule(groupId);
      return;
    }
    if (command === "move-group-up" || command === "move-group-down") {
      const groupId = element.dataset.groupId;
      if (groupId) this.moveGroup(groupId, command.endsWith("up") ? -1 : 1);
      return;
    }
    if (command === "move-rule-up" || command === "move-rule-down") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) {
        this.moveRule(groupId, ruleId, command.endsWith("up") ? -1 : 1);
      }
      return;
    }
    if (command === "remove-group") {
      const groupId = element.dataset.groupId;
      if (groupId) this.requestRemoveGroup(groupId);
      return;
    }
    if (command === "remove-rule") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) this.requestRemoveRule(groupId, ruleId);
      return;
    }
    if (command === "add-group-origin") {
      const groupId = element.dataset.groupId;
      if (groupId) this.addGroupOrigin(groupId);
      return;
    }
    if (command === "remove-group-origin") {
      const groupId = element.dataset.groupId;
      const index = Number(element.dataset.index);
      if (groupId && Number.isSafeInteger(index))
        this.removeGroupOrigin(groupId, index);
      return;
    }
    if (command === "add-rule-origin") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) this.addRuleOrigin(groupId, ruleId);
      return;
    }
    if (command === "remove-rule-origin") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      const index = Number(element.dataset.index);
      if (groupId && ruleId && Number.isSafeInteger(index)) {
        this.removeRuleOrigin(groupId, ruleId, index);
      }
      return;
    }
    if (command === "convert-url") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) this.convertUrl(groupId, ruleId);
    }
    if (command === "test:run") {
      void this.runTest();
      return;
    }
  }

  private collectDiagnostics(value: unknown): EditorDiagnostic[] {
    let hostDiagnostics: unknown;
    try {
      const input = cloneSnapshot(value);
      hostDiagnostics = this.options.validate(input);
    } catch {
      return [
        diagnostic(
          "editor.validation-failed",
          "",
          "Project validation could not be completed.",
        ),
      ];
    }
    const diagnostics = normalizeDiagnostics(hostDiagnostics);
    const project = asDraftProject(value);
    if (!project) return diagnostics;

    this.extensionErrors.clear();
    for (
      let groupIndex = 0;
      groupIndex < project.groups.length;
      groupIndex += 1
    ) {
      const group = project.groups[groupIndex];
      for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
        const rule = group.rules[ruleIndex];
        const rulePath = pointer("groups", groupIndex, "rules", ruleIndex);
        const match = this.findExtension(rule, rulePath);
        if (match.error) {
          diagnostics.push(match.error);
          continue;
        }
        if (!match.extension) continue;
        try {
          const ruleSnapshot = freezeSnapshot(
            cloneSnapshot(rule) as Readonly<Record<string, unknown>>,
          );
          const extensionDiagnostics = normalizeDiagnostics(
            match.extension.validate(ruleSnapshot, rulePath),
          );
          for (const extensionDiagnostic of extensionDiagnostics) {
            diagnostics.push({
              ...extensionDiagnostic,
              path: this.extensionDiagnosticPath(
                extensionDiagnostic.path,
                rulePath,
              ),
            });
          }
        } catch {
          diagnostics.push(
            diagnostic(
              "editor.extension-failed",
              rulePath,
              "An additional rule field could not be validated.",
            ),
          );
        }
      }
    }
    return stableDiagnostics(diagnostics);
  }

  private validateCurrent(): EditorDiagnostic[] {
    const diagnostics = this.collectDiagnostics(this.draft);
    diagnostics.push(...this.conversionDiagnostics.values());
    return stableDiagnostics(diagnostics);
  }

  private findExtension(
    rule: DraftRule,
    rulePath: string,
  ): { extension?: RuleTypeFieldExtension; error?: EditorDiagnostic } {
    const matches: RuleTypeFieldExtension[] = [];
    let snapshot: Readonly<Record<string, unknown>>;
    try {
      snapshot = freezeSnapshot(
        cloneSnapshot(rule) as Readonly<Record<string, unknown>>,
      );
    } catch {
      return {
        error: diagnostic(
          "editor.extension-failed",
          rulePath,
          "An additional rule field could not be read safely.",
        ),
      };
    }
    for (const extension of this.extensions) {
      try {
        if (extension.matches(snapshot)) matches.push(extension);
      } catch {
        return {
          error: diagnostic(
            "editor.extension-failed",
            rulePath,
            "An additional rule field could not be identified.",
          ),
        };
      }
    }
    if (matches.length > 1) {
      return {
        error: diagnostic(
          "editor.extension-ambiguous",
          rulePath,
          "More than one additional rule field set matches this rule.",
        ),
      };
    }
    return { extension: matches[0] };
  }

  private extensionDiagnosticPath(path: string, rulePath: string): string {
    if (path === "") return rulePath;
    return path.startsWith(rulePath)
      ? path
      : `${rulePath}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private updateCommonField(path: string, rawValue: string): boolean {
    if (this.saving) return false;
    let value: unknown = rawValue;
    const segments = decodePointer(path);
    const finalSegment = segments?.at(-1);
    if (finalSegment === "priority") {
      value = rawValue === "" ? "" : Number(rawValue);
    } else if (finalSegment === "method") {
      if (rawValue === "") {
        const changed = deleteValueAtPath(this.draft, path);
        if (changed) this.markChanged();
        return changed;
      }
      value = rawValue;
    } else if (finalSegment === "description" && rawValue === "") {
      const changed = deleteValueAtPath(this.draft, path);
      if (changed) this.markChanged();
      return changed;
    } else if (finalSegment === "type") {
      const ruleContainerPath = pointer(...(segments?.slice(0, -1) ?? []));
      if (rawValue === "") {
        const changedType = deleteValueAtPath(this.draft, path);
        const ruleContainer = valueAtPath(this.draft, ruleContainerPath);
        const cleared = clearActionFields(ruleContainer);
        if (changedType || cleared) this.markChanged();
        return changedType || cleared;
      }
      const changed = setValueAtPath(this.draft, path, rawValue);
      if (changed) {
        const ruleContainer = valueAtPath(this.draft, ruleContainerPath);
        clearActionFields(
          ruleContainer,
          rawValue === "redirect" || rawValue === "mock" ? rawValue : undefined,
        );
        this.markChanged();
      }
      return changed;
    }
    const changed = setValueAtPath(this.draft, path, value);
    if (changed) this.markChanged();
    return changed;
  }

  private updateResourceTypes(
    path: string,
    resourceType: string,
    checked: boolean,
  ): void {
    const values = valueAtPath(this.draft, path);
    if (
      !Array.isArray(values) ||
      !RESOURCE_TYPES.includes(resourceType as never)
    ) {
      return;
    }
    const index = values.indexOf(resourceType);
    if (checked && index === -1) values.push(resourceType);
    if (!checked && index !== -1) values.splice(index, 1);
    if ((checked && index === -1) || (!checked && index !== -1)) {
      this.markChanged();
      this.render();
    }
  }

  private setRuleType(rulePath: string, typeId: string): void {
    if (this.saving) return;
    const ruleContainer = valueAtPath(this.draft, rulePath);
    if (typeId === "") {
      const changedType = deleteValueAtPath(this.draft, `${rulePath}/type`);
      const cleared = clearActionFields(ruleContainer);
      if (changedType || cleared) {
        this.markChanged();
        this.render();
      }
      return;
    }
    const extension = this.extensions.find((entry) => entry.id === typeId);
    if (!extension?.defaultAction) return;
    const actionField = extension.actionField ?? "action";
    const changedType = setValueAtPath(this.draft, `${rulePath}/type`, typeId);
    const changedAction = setValueAtPath(
      this.draft,
      `${rulePath}/${actionField}`,
      extension.defaultAction(),
    );
    const cleared = clearActionFields(ruleContainer, actionField);
    if (changedType || changedAction || cleared) {
      this.markChanged();
      this.render();
    }
  }

  private markChanged(): void {
    this.revision += 1;
    this.errors = [];
    this.conversionDiagnostics.clear();
    this.extensionErrors.clear();
    this.statusMessage = "";
  }

  private allIds(): Set<string> {
    const ids = new Set<string>();
    for (const group of this.draft.groups) {
      if (typeof group.id === "string") ids.add(group.id);
      for (const rule of group.rules) {
        if (typeof rule.id === "string") ids.add(rule.id);
      }
    }
    return ids;
  }

  private nextId(prefix: string): string {
    const ids = this.allIds();
    let candidate = prefix;
    let suffix = 2;
    while (ids.has(candidate)) candidate = `${prefix}-${suffix++}`;
    return candidate;
  }

  private addGroup(): void {
    if (this.saving) return;
    const groupId = this.nextId("group-new");
    this.draft.groups.push({
      id: groupId,
      name: "New group",
      origins: [],
      rules: [],
    });
    this.markChanged();
    this.route = { kind: "group", groupId };
    this.focusRequest = pointer("groups", this.draft.groups.length - 1, "name");
    this.statusMessage = "Group added.";
    this.render();
  }

  private addRule(groupId: string): void {
    if (this.saving) return;
    const group = this.groupById(groupId);
    if (!group) return;
    const ruleId = this.nextId("rule-new");
    group.rules.push({
      id: ruleId,
      name: "New rule",
      urlRegex: "",
      origins: [],
      resourceTypes: ["main_frame"],
      priority: 100,
    });
    this.markChanged();
    this.route = { kind: "group", groupId };
    const groupIndex = this.groupIndex(groupId);
    this.focusRequest = pointer(
      "groups",
      groupIndex,
      "rules",
      group.rules.length - 1,
      "name",
    );
    this.statusMessage = "Rule added.";
    this.render();
  }

  private moveGroup(groupId: string, delta: number): void {
    if (this.saving) return;
    const index = this.groupIndex(groupId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= this.draft.groups.length) return;
    const [group] = this.draft.groups.splice(index, 1);
    this.draft.groups.splice(next, 0, group);
    this.markChanged();
    this.focusRequest = pointer("groups", next, "name");
    this.statusMessage = `Group moved to position ${next + 1} of ${this.draft.groups.length}.`;
    this.render();
  }

  private moveRule(groupId: string, ruleId: string, delta: number): void {
    if (this.saving) return;
    const group = this.groupById(groupId);
    if (!group) return;
    const index = this.ruleIndex(group, ruleId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= group.rules.length) return;
    const [rule] = group.rules.splice(index, 1);
    group.rules.splice(next, 0, rule);
    this.markChanged();
    const groupIndex = this.groupIndex(groupId);
    this.focusRequest = pointer("groups", groupIndex, "rules", next, "name");
    this.statusMessage = `Rule moved to position ${next + 1} of ${group.rules.length}.`;
    this.render();
  }

  private requestRemoveGroup(groupId: string): void {
    if (this.saving) return;
    const group = this.groupById(groupId);
    if (!group) return;
    this.confirmation = {
      kind: "remove-group",
      groupId,
      name: displayName(group.name, "Unnamed group"),
    };
    this.focusRequest = "confirm-cancel";
    this.render();
  }

  private requestRemoveRule(groupId: string, ruleId: string): void {
    if (this.saving) return;
    const rule = this.ruleById(groupId, ruleId);
    if (!rule) return;
    this.confirmation = {
      kind: "remove-rule",
      groupId,
      ruleId,
      name: displayName(rule.name, "Unnamed rule"),
    };
    this.focusRequest = "confirm-cancel";
    this.render();
  }

  private confirmRemoval(): void {
    if (!this.confirmation || this.confirmation.kind === "cancel") return;
    const confirmation = this.confirmation;
    this.confirmation = undefined;
    if (confirmation.kind === "remove-group") {
      const index = this.groupIndex(confirmation.groupId);
      if (index < 0) return;
      this.draft.groups.splice(index, 1);
      this.markChanged();
      if (
        this.route.kind === "group" &&
        this.route.groupId === confirmation.groupId
      ) {
        this.route = { kind: "project" };
      }
      this.statusMessage = `Group ${confirmation.name} removed.`;
    } else {
      const group = this.groupById(confirmation.groupId);
      if (!group) return;
      const index = this.ruleIndex(group, confirmation.ruleId);
      if (index < 0) return;
      group.rules.splice(index, 1);
      this.markChanged();
      this.statusMessage = `Rule ${confirmation.name} removed.`;
    }
    this.render();
  }

  private requestCancel(): void {
    if (this.saving) return;
    if (!this.isDirty()) {
      this.statusMessage = "No changes to discard.";
      try {
        this.options.onCancel?.();
      } catch {
        this.statusMessage = "The host could not complete cancel.";
      }
      this.render();
      return;
    }
    this.confirmation = { kind: "cancel" };
    this.focusRequest = "confirm-cancel";
    this.render();
  }

  private discardChanges(): void {
    if (
      this.saving ||
      !this.confirmation ||
      this.confirmation.kind !== "cancel"
    ) {
      return;
    }
    this.draft = cloneSnapshot(this.committed) as DraftProject;
    this.revision += 1;
    this.errors = [];
    this.conversionDiagnostics.clear();
    this.confirmation = undefined;
    this.statusMessage = "Changes discarded.";
    try {
      this.options.onCancel?.();
    } catch {
      this.statusMessage = "The host could not complete cancel.";
    }
    this.render();
  }

  private async saveDraft(): Promise<void> {
    if (this.destroyed || this.saving || !this.isDirty()) return;
    const validation = this.validateCurrent();
    if (validation.length > 0) {
      this.errors = validation;
      this.statusMessage = `${validation.length} validation error${
        validation.length === 1 ? "" : "s"
      } found.`;
      this.focusRequest = validation[0]?.path;
      this.render();
      return;
    }

    const revision = this.revision;
    const snapshot = cloneSnapshot(this.draft) as EditorProjectSnapshot;
    this.saving = true;
    this.statusMessage = "Saving...";
    this.render();

    let result: unknown;
    try {
      result = await this.options.save(
        cloneSnapshot(snapshot) as EditorProjectSnapshot,
      );
    } catch {
      result = {
        ok: false,
        code: "editor.save-failed",
        message: "The host could not save the project.",
      };
    }
    if (this.destroyed) return;

    this.saving = false;
    if (revision !== this.revision) {
      this.statusMessage =
        "The save result was stale; current edits were kept.";
      this.render();
      return;
    }
    if (isSaveSuccess(result)) {
      this.committed = cloneSnapshot(snapshot) as DraftProject;
      this.errors = [];
      this.statusMessage = "Saved";
      this.render();
      return;
    }

    const failure = saveFailureDiagnostic(result);
    this.errors = [failure];
    this.statusMessage = failure.message;
    this.focusRequest = failure.path;
    this.render();
  }

  private addGroupOrigin(groupId: string): void {
    const group = this.groupById(groupId);
    if (!group || this.saving) return;
    group.origins.push("");
    this.markChanged();
    this.focusRequest = pointer(
      "groups",
      this.groupIndex(groupId),
      "origins",
      group.origins.length - 1,
    );
    this.render();
  }

  private removeGroupOrigin(groupId: string, index: number): void {
    const group = this.groupById(groupId);
    if (!group || this.saving || index < 0 || index >= group.origins.length)
      return;
    group.origins.splice(index, 1);
    this.markChanged();
    this.render();
  }

  private addRuleOrigin(groupId: string, ruleId: string): void {
    const rule = this.ruleById(groupId, ruleId);
    if (!rule || this.saving) return;
    rule.origins.push("");
    this.markChanged();
    this.focusRequest = pointer(
      "groups",
      this.groupIndex(groupId),
      "rules",
      this.ruleIndex(this.groupById(groupId) as DraftGroup, ruleId),
      "origins",
      rule.origins.length - 1,
    );
    this.render();
  }

  private removeRuleOrigin(
    groupId: string,
    ruleId: string,
    index: number,
  ): void {
    const rule = this.ruleById(groupId, ruleId);
    if (!rule || this.saving || index < 0 || index >= rule.origins.length)
      return;
    rule.origins.splice(index, 1);
    this.markChanged();
    this.render();
  }

  private convertUrl(groupId: string, ruleId: string): void {
    const rule = this.ruleById(groupId, ruleId);
    if (!rule || this.saving) return;
    const input = this.host.querySelector<HTMLInputElement>(
      `[data-url-source][data-rule-id="${CSS.escape(ruleId)}"]`,
    );
    const value = input?.value ?? this.urlInputs.get(ruleId) ?? "";
    this.urlInputs.set(ruleId, value);
    const result = urlToExactRegex(value);
    const rulePath = pointer(
      "groups",
      this.groupIndex(groupId),
      "rules",
      this.ruleIndex(this.groupById(groupId) as DraftGroup, ruleId),
    );
    const path = `${rulePath}/urlRegex`;
    if (!result.ok) {
      this.conversionDiagnostics.set(
        ruleId,
        diagnostic(
          result.code,
          path,
          result.code === "editor.url-too-long"
            ? "The exact URL regular expression is too long."
            : "Enter a valid request URL without credentials or fragments.",
        ),
      );
      this.errors = [...this.conversionDiagnostics.values()];
      this.statusMessage = "The URL could not be converted.";
      this.focusRequest = path;
      this.render();
      return;
    }
    if (setValueAtPath(this.draft, path, result.source)) this.markChanged();
    this.statusMessage = "Exact URL regular expression created.";
    this.focusRequest = path;
    this.render();
  }

  private async runTest(): Promise<void> {
    if (!this.options.dryRun) {
      this.statusMessage =
        "Dry-run is not configured for this editor instance.";
      this.render();
      return;
    }
    const urlsText = this.testUrls.trim();
    if (!urlsText) {
      this.statusMessage = "Please enter at least one URL to test.";
      this.render();
      return;
    }

    const lines = urlsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const cases: DryRunTestCase[] = lines.map((url) => ({
      url,
      method: this.testMethod === "" ? undefined : this.testMethod,
      resourceType:
        this.testResourceType === "" ? undefined : this.testResourceType,
    }));
    const maxCasesRaw = Number.parseInt(this.testMaxCases, 10);
    const maxCases =
      Number.isSafeInteger(maxCasesRaw) && maxCasesRaw > 0
        ? maxCasesRaw
        : undefined;

    const requestId = ++this.testRequestId;
    this.testRunning = true;
    this.statusMessage = "Running dry-run...";
    this.render();

    try {
      const result = await this.options.dryRun(
        this.getDraft(),
        cases,
        maxCases === undefined ? undefined : { maxCases },
      );
      if (requestId !== this.testRequestId) return;
      this.testResult = result;
      this.testRunning = false;
      const matched = result.summary.matchedUrlCount;
      const total = result.summary.urlCount;
      this.statusMessage = `Test complete: ${matched}/${total} URLs matched at least one rule.`;
    } catch (e) {
      if (requestId !== this.testRequestId) return;
      this.testRunning = false;
      const message = e instanceof Error ? e.message : "Test failed";
      this.statusMessage = `Test error: ${message}`;
    }
    this.render();
  }

  private renderTestResults(result: DryRunResult): void {
    const resultsSection = this.host.querySelector<HTMLElement>(
      "[data-test-results]",
    );
    if (!resultsSection) return;
    resultsSection.replaceChildren();

    const heading = this.document.createElement("h3");
    heading.textContent = "Results";
    resultsSection.append(heading);

    if (result.errors.length > 0) {
      const errorsList = this.document.createElement("ul");
      errorsList.dataset.testErrors = "true";
      for (const err of result.errors) {
        const item = this.document.createElement("li");
        item.textContent = `${err.code}: ${err.message}${
          err.index !== undefined ? ` (case ${err.index})` : ""
        }`;
        errorsList.append(item);
      }
      resultsSection.append(errorsList);
    }

    if (result.results.length === 0 && result.errors.length === 0) {
      const empty = this.document.createElement("p");
      empty.dataset.testEmpty = "true";
      empty.textContent = "No valid URLs to test.";
      resultsSection.append(empty);
      return;
    }

    for (const urlResult of result.results) {
      const card = this.document.createElement("article");
      card.dataset.testResultCard = "true";
      const matched = urlResult.matchedRuleCount > 0;
      card.dataset.matched = matched ? "true" : "false";

      const urlHeader = this.document.createElement("div");
      urlHeader.dataset.testResultHeader = "true";
      const urlText = this.document.createElement("strong");
      urlText.textContent = urlResult.url;
      const urlBadge = this.document.createElement("span");
      urlBadge.dataset.testBadge = "true";
      urlBadge.dataset.variant = matched ? "matched" : "unmatched";
      urlBadge.textContent = matched ? "MATCHED" : "NO MATCH";
      urlHeader.append(urlText, urlBadge);
      card.append(urlHeader);

      for (const rule of urlResult.rules) {
        const ruleDiv = this.document.createElement("div");
        ruleDiv.dataset.testRule = "true";
        const ruleHeader = this.document.createElement("div");
        ruleHeader.dataset.testRuleHeader = "true";
        const ruleName = this.document.createElement("strong");
        ruleName.textContent = `${rule.groupId}/${rule.ruleId}`;
        const ruleBadge = this.document.createElement("span");
        ruleBadge.dataset.testBadge = "true";
        ruleBadge.dataset.variant = rule.matched ? "matched" : "unmatched";
        ruleBadge.textContent = rule.matched ? "✓ MATCHED" : "✗ NOT MATCHED";
        ruleHeader.append(ruleName, ruleBadge);
        ruleDiv.append(ruleHeader);

        const dims: Array<{ label: string; dim: typeof rule.urlRegex }> = [
          { label: "urlRegex", dim: rule.urlRegex },
          { label: "effectiveOrigin", dim: rule.effectiveOrigin },
          { label: "method", dim: rule.method },
          { label: "resourceType", dim: rule.resourceType },
        ];
        for (const { label, dim } of dims) {
          const dimDiv = this.document.createElement("div");
          dimDiv.dataset.testDimension = "true";
          const badge = this.document.createElement("span");
          badge.dataset.testBadge = "true";
          badge.dataset.variant =
            dim.state === "matched"
              ? "matched"
              : dim.state === "unmatched"
                ? "unmatched"
                : "na";
          badge.textContent = dim.state.toUpperCase();
          dimDiv.append(
            badge,
            this.document.createTextNode(`${label}: ${dim.detail}`),
          );
          ruleDiv.append(dimDiv);
        }

        if (rule.actionPreview) {
          const apDiv = this.document.createElement("div");
          apDiv.dataset.testActionPreview = "true";
          apDiv.textContent = `Action preview: ${rule.actionPreview.kind} - ${rule.actionPreview.summary}`;
          ruleDiv.append(apDiv);
        }

        card.append(ruleDiv);
      }

      resultsSection.append(card);
    }
  }

  private navigate(route: string, groupId: string | undefined): void {
    if (route === "project") {
      this.route = { kind: "project" };
    } else if (route === "test") {
      this.route = { kind: "test" };
    } else if (route === "group" && groupId && this.groupById(groupId)) {
      this.route = { kind: "group", groupId };
    } else {
      return;
    }
    this.testRequestId += 1;
    this.statusMessage = "";
    this.render();
  }

  navigateToGroup(groupId: string | null | undefined): void {
    const groupIds = new Set(
      this.draft.groups
        .map((group) => (typeof group.id === "string" ? group.id : ""))
        .filter((id) => id.length > 0),
    );
    const resolved = resolveGroupRoute(groupId, groupIds);
    if (resolved.kind === "group") {
      this.route = { kind: "group", groupId: resolved.groupId };
    } else {
      this.route = { kind: "project" };
    }
    this.testRequestId += 1;
    this.statusMessage = "";
    this.render();
  }

  private navigateToSearchResult(path: string): void {
    const segments = decodePointer(path);
    if (segments?.[0] !== "groups") {
      this.route = { kind: "project" };
      this.focusRequest = path;
      this.render();
      return;
    }
    const groupIndex = arrayIndex(segments[1] ?? "");
    const group =
      groupIndex === undefined ? undefined : this.draft.groups[groupIndex];
    if (!group || typeof group.id !== "string") return;
    this.route = { kind: "group", groupId: group.id };
    this.focusRequest = path;
    this.statusMessage = "Search result opened.";
    this.render();
  }

  private navigateToPath(path: string): void {
    const segments = decodePointer(path);
    if (segments?.[0] !== "groups") {
      this.route = { kind: "project" };
      this.focusRequest = path;
      this.render();
      return;
    }
    const groupIndex = arrayIndex(segments[1] ?? "");
    const group =
      groupIndex === undefined ? undefined : this.draft.groups[groupIndex];
    if (!group || typeof group.id !== "string") return;
    this.route = { kind: "group", groupId: group.id };
    this.focusRequest = path;
    this.render();
  }

  private currentGroupId(): string | undefined {
    return this.route.kind === "group" ? this.route.groupId : undefined;
  }

  private groupIndex(groupId: string): number {
    for (let index = 0; index < this.draft.groups.length; index += 1) {
      if (this.draft.groups[index].id === groupId) return index;
    }
    return -1;
  }

  private groupById(groupId: string): DraftGroup | undefined {
    const index = this.groupIndex(groupId);
    return index === -1 ? undefined : this.draft.groups[index];
  }

  private ruleIndex(group: DraftGroup, ruleId: string): number {
    for (let index = 0; index < group.rules.length; index += 1) {
      if (group.rules[index].id === ruleId) return index;
    }
    return -1;
  }

  private ruleById(groupId: string, ruleId: string): DraftRule | undefined {
    const group = this.groupById(groupId);
    if (!group) return undefined;
    const index = this.ruleIndex(group, ruleId);
    return index === -1 ? undefined : group.rules[index];
  }

  private render(): void {
    if (this.destroyed) return;
    this.previousFocus = this.captureFocus();
    this.cleanupExtensions();
    this.controlNumber = 0;
    this.controls.clear();
    this.extensionControls.clear();
    if (this.route.kind === "group" && !this.groupById(this.route.groupId)) {
      this.route = { kind: "project" };
    }
    this.renderHeader();
    this.renderRail();
    this.renderCommandBar();
    this.form.replaceChildren();
    if (this.route.kind === "project") {
      this.renderProject();
    } else if (this.route.kind === "test") {
      this.renderTest();
    } else {
      this.renderGroup(this.route.groupId);
    }
    this.decorateExtensionControls();
    this.renderSummary();
    this.renderSearchResults();
    this.renderConfirmation();
    this.restoreFocus();
    this.focusRequest = undefined;
  }

  private renderHeader(): void {
    this.header.replaceChildren();
    const titleBlock = this.document.createElement("div");
    const title = this.document.createElement("h1");
    title.textContent = displayName(this.draft.name, "Project");
    const dirty = this.document.createElement("p");
    dirty.dataset.dirtyState = "true";
    dirty.textContent = this.isDirty()
      ? "Unsaved changes"
      : "All changes saved";
    titleBlock.append(title, dirty);

    const searchLabel = this.document.createElement("label");
    searchLabel.textContent = "Search project";
    const search = this.document.createElement("input");
    search.type = "search";
    search.value = this.searchQuery;
    search.dataset.search = "true";
    search.dataset.editorKey = "search";
    searchLabel.append(search);

    const mobileNav = this.document.createElement("label");
    mobileNav.dataset.mobileRouteNav = "true";
    mobileNav.textContent = "Project section";
    const select = this.document.createElement("select");
    select.dataset.mobileRoute = "true";
    select.dataset.editorKey = "mobile-route";
    const projectOption = this.document.createElement("option");
    projectOption.value = "project";
    projectOption.textContent = "Project";
    select.append(projectOption);
    for (const group of this.draft.groups) {
      const option = this.document.createElement("option");
      option.value = "group";
      option.dataset.groupId = safeText(group.id);
      option.textContent = displayName(group.name, "Unnamed group");
      select.append(option);
    }
    const testOption = this.document.createElement("option");
    testOption.value = "test";
    testOption.textContent = "Test rules";
    select.append(testOption);
    if (this.route.kind === "project") {
      select.value = "project";
    } else if (this.route.kind === "test") {
      select.value = "test";
    } else {
      const groupId = this.route.groupId;
      const options = Array.from(select.options);
      const option = options.find((value) => value.dataset.groupId === groupId);
      if (option) select.value = "group";
    }
    mobileNav.append(select);
    this.header.append(titleBlock, searchLabel, mobileNav);
    this.status.textContent = this.statusMessage;
    this.status.setAttribute("aria-busy", this.saving ? "true" : "false");
  }

  private renderRail(): void {
    this.rail.replaceChildren();
    const heading = this.document.createElement("h2");
    heading.dataset.editorVisuallyHidden = "true";
    heading.textContent = "Project sections";
    this.rail.append(heading);
    const project = this.createButton("Project", "route:project");
    project.dataset.route = "project";
    project.dataset.editorKey = "route:project";
    if (this.route.kind === "project")
      project.setAttribute("aria-current", "page");
    this.rail.append(project);
    for (const group of this.draft.groups) {
      const groupId = safeText(group.id);
      const name = displayName(group.name, "Unnamed group");
      const button = this.createButton(name, `route:group:${groupId}`);
      button.dataset.route = "group";
      button.dataset.groupId = groupId;
      button.dataset.editorKey = `route:group:${groupId}`;
      if (this.route.kind === "group" && this.route.groupId === groupId) {
        button.setAttribute("aria-current", "page");
      }
      this.rail.append(button);
    }
    const testBtn = this.createButton("Test rules", "route:test");
    testBtn.dataset.route = "test";
    testBtn.dataset.editorKey = "route:test";
    if (this.route.kind === "test")
      testBtn.setAttribute("aria-current", "page");
    this.rail.append(testBtn);
  }

  private renderCommandBar(): void {
    this.commandBar.replaceChildren();
    this.commandBar.setAttribute("aria-busy", this.saving ? "true" : "false");
    this.commandBar.append(
      this.createCommandButton("Validate", "validate", this.saving),
      this.createCommandButton("Save", "save", this.saving || !this.isDirty()),
      this.createCommandButton("Cancel", "cancel", this.saving),
    );
    if (this.route.kind === "project") {
      this.commandBar.append(
        this.createCommandButton("Add group", "add-group", this.saving),
      );
      return;
    }
    if (this.route.kind === "test") {
      this.commandBar.append(
        this.createCommandButton("Run test", "test:run", this.saving),
      );
      return;
    }
    const group = this.groupById(this.route.groupId);
    if (!group) return;
    const index = this.groupIndex(this.route.groupId);
    const name = displayName(group.name, "Unnamed group");
    this.commandBar.append(
      this.createCommandButton("Add rule", "add-rule", this.saving, {
        groupId: this.route.groupId,
      }),
      this.createCommandButton(
        `Move group ${name} up`,
        "move-group-up",
        this.saving || index <= 0,
        { groupId: this.route.groupId },
      ),
      this.createCommandButton(
        `Move group ${name} down`,
        "move-group-down",
        this.saving || index >= this.draft.groups.length - 1,
        { groupId: this.route.groupId },
      ),
      this.createCommandButton(
        `Remove group ${name}`,
        "remove-group",
        this.saving,
        {
          groupId: this.route.groupId,
        },
      ),
    );
  }

  private renderProject(): void {
    const heading = this.document.createElement("h2");
    heading.textContent = "Project";
    this.form.append(heading);
    const fields = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = "Project details";
    fields.append(legend);
    const fieldGrid = this.document.createElement("div");
    fieldGrid.dataset.editorFields = "true";
    const name = this.document.createElement("input");
    name.type = "text";
    name.maxLength = 100;
    name.value = safeText(this.draft.name);
    this.renderField(fieldGrid, "Project name", "/name", name);
    const description = this.document.createElement("textarea");
    description.maxLength = 1000;
    description.value = safeText(this.draft.description);
    this.renderField(
      fieldGrid,
      "Project description",
      "/description",
      description,
    );
    fields.append(fieldGrid);
    this.form.append(fields);

    const groups = this.document.createElement("section");
    const groupsHeading = this.document.createElement("h2");
    groupsHeading.textContent = "Groups";
    groups.append(groupsHeading);
    if (this.draft.groups.length === 0) {
      const empty = this.document.createElement("p");
      empty.textContent = "No groups yet.";
      groups.append(empty);
    } else {
      const list = this.document.createElement("ul");
      for (const group of this.draft.groups) {
        const item = this.document.createElement("li");
        const button = this.createButton(
          `Edit group ${displayName(group.name, "Unnamed group")}`,
          `route:group:${safeText(group.id)}`,
        );
        button.dataset.route = "group";
        button.dataset.groupId = safeText(group.id);
        item.append(button);
        list.append(item);
      }
      groups.append(list);
    }
    this.form.append(groups);
  }

  private renderGroup(groupId: string): void {
    const group = this.groupById(groupId);
    if (!group) return;
    const groupIndex = this.groupIndex(groupId);
    const heading = this.document.createElement("h2");
    heading.textContent = displayName(group.name, "Unnamed group");
    this.form.append(heading);

    const settings = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = "Group details";
    settings.append(legend);
    const fields = this.document.createElement("div");
    fields.dataset.editorFields = "true";
    const id = this.document.createElement("input");
    id.type = "text";
    id.maxLength = 64;
    id.value = safeText(group.id);
    this.renderField(
      fields,
      "Group ID",
      pointer("groups", groupIndex, "id"),
      id,
    );
    const name = this.document.createElement("input");
    name.type = "text";
    name.maxLength = 100;
    name.value = safeText(group.name);
    this.renderField(
      fields,
      "Group name",
      pointer("groups", groupIndex, "name"),
      name,
    );
    settings.append(fields);
    this.form.append(settings);
    this.renderOrigins(
      this.form,
      "Group origins",
      group.origins,
      "group",
      groupId,
      undefined,
      groupIndex,
    );

    const rulesSection = this.document.createElement("section");
    const rulesHeading = this.document.createElement("h2");
    rulesHeading.textContent = "Rules";
    rulesSection.append(rulesHeading);
    const list = this.document.createElement("div");
    list.dataset.ruleList = groupId;
    for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
      list.append(
        this.renderRule(group, group.rules[ruleIndex], groupIndex, ruleIndex),
      );
    }
    if (group.rules.length === 0) {
      const empty = this.document.createElement("p");
      empty.textContent = "No rules yet.";
      list.append(empty);
    }
    rulesSection.append(list);
    this.form.append(rulesSection);
  }

  private renderTest(): void {
    const heading = this.document.createElement("h2");
    heading.textContent = "Test rules (dry-run)";
    this.form.append(heading);

    const description = this.document.createElement("p");
    description.dataset.testDescription = "true";
    description.textContent =
      "Run offline dry-run tests against the current project. Enter test cases (one URL per line) and optional method/resource type defaults. No network requests are made.";
    this.form.append(description);

    const panel = this.document.createElement("div");
    panel.dataset.testPanel = "true";

    const urlsFieldset = this.document.createElement("fieldset");
    const urlsLegend = this.document.createElement("legend");
    urlsLegend.textContent = "Test URLs";
    urlsFieldset.append(urlsLegend);

    const urlsField = this.document.createElement("div");
    urlsField.dataset.editorField = "true";
    const urlsLabel = this.document.createElement("label");
    urlsLabel.textContent = "One test URL per line";
    const urlsTextarea = this.document.createElement("textarea");
    urlsTextarea.rows = 8;
    urlsTextarea.placeholder =
      "https://example.com/page\nhttps://example.com/script.js\nhttps://other.com/";
    urlsTextarea.value = this.testUrls;
    urlsTextarea.dataset.testUrls = "true";
    urlsLabel.append(urlsTextarea);
    urlsField.append(urlsLabel);
    urlsFieldset.append(urlsField);
    panel.append(urlsFieldset);

    const defaultsFieldset = this.document.createElement("fieldset");
    const defaultsLegend = this.document.createElement("legend");
    defaultsLegend.textContent =
      "Defaults (applied to all URLs without explicit values)";
    defaultsFieldset.append(defaultsLegend);

    const defaultsGrid = this.document.createElement("div");
    defaultsGrid.dataset.testDefaults = "true";

    const methodField = this.document.createElement("div");
    methodField.dataset.editorField = "true";
    const methodLabel = this.document.createElement("label");
    methodLabel.textContent = "Default HTTP method";
    const methodSelect = this.document.createElement("select");
    methodSelect.dataset.testMethod = "true";
    methodSelect.value = this.testMethod;
    const methodEmpty = this.document.createElement("option");
    methodEmpty.value = "";
    methodEmpty.textContent = "(none — not-applicable)";
    methodSelect.append(methodEmpty);
    for (const m of HTTP_METHODS) {
      const opt = this.document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      methodSelect.append(opt);
    }
    methodLabel.append(methodSelect);
    methodField.append(methodLabel);

    const rtField = this.document.createElement("div");
    rtField.dataset.editorField = "true";
    const rtLabel = this.document.createElement("label");
    rtLabel.textContent = "Default resource type";
    const rtSelect = this.document.createElement("select");
    rtSelect.dataset.testResourceType = "true";
    rtSelect.value = this.testResourceType;
    const rtEmpty = this.document.createElement("option");
    rtEmpty.value = "";
    rtEmpty.textContent = "(none — not-applicable)";
    rtSelect.append(rtEmpty);
    for (const rt of RESOURCE_TYPES) {
      const opt = this.document.createElement("option");
      opt.value = rt;
      opt.textContent = rt;
      rtSelect.append(opt);
    }
    rtLabel.append(rtSelect);
    rtField.append(rtLabel);

    defaultsGrid.append(methodField, rtField);
    defaultsFieldset.append(defaultsGrid);
    panel.append(defaultsFieldset);

    const maxCasesField = this.document.createElement("div");
    maxCasesField.dataset.editorField = "true";
    const maxCasesLabel = this.document.createElement("label");
    maxCasesLabel.textContent = "Max test cases";
    const maxCasesInput = this.document.createElement("input");
    maxCasesInput.type = "number";
    maxCasesInput.min = "1";
    maxCasesInput.max = "10000";
    maxCasesInput.value = this.testMaxCases;
    maxCasesInput.style.width = "8rem";
    maxCasesInput.dataset.testMaxCases = "true";
    maxCasesLabel.append(maxCasesInput);
    maxCasesField.append(maxCasesLabel);
    panel.append(maxCasesField);

    const runBtn = this.createButton("Run test", "test:run");
    runBtn.type = "button";
    runBtn.dataset.testRun = "true";
    runBtn.disabled = this.saving || this.testRunning;
    panel.append(runBtn);

    this.form.append(panel);

    const resultsSection = this.document.createElement("section");
    resultsSection.dataset.testResults = "true";
    this.form.append(resultsSection);
    if (this.testResult) {
      this.renderTestResults(this.testResult);
    } else if (this.testRunning) {
      const pending = this.document.createElement("p");
      pending.dataset.testPending = "true";
      pending.textContent = "Running dry-run...";
      resultsSection.append(pending);
    }
  }

  private renderRule(
    group: DraftGroup,
    rule: DraftRule,
    groupIndex: number,
    ruleIndex: number,
  ): HTMLElement {
    const groupId = safeText(group.id);
    const ruleId = safeText(rule.id);
    const ruleName = displayName(rule.name, "Unnamed rule");
    const rulePath = pointer("groups", groupIndex, "rules", ruleIndex);
    const card = this.document.createElement("article");
    card.dataset.ruleCard = "true";
    card.dataset.ruleId = ruleId;
    const heading = this.document.createElement("h3");
    heading.textContent = ruleName;
    card.append(heading);

    const fields = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = "Common rule matcher";
    fields.append(legend);
    const grid = this.document.createElement("div");
    grid.dataset.editorFields = "true";
    const id = this.document.createElement("input");
    id.type = "text";
    id.maxLength = 64;
    id.value = safeText(rule.id);
    this.renderField(grid, `Rule ID for ${ruleName}`, `${rulePath}/id`, id);
    const name = this.document.createElement("input");
    name.type = "text";
    name.maxLength = 100;
    name.value = safeText(rule.name);
    this.renderField(
      grid,
      `Rule name for ${ruleName}`,
      `${rulePath}/name`,
      name,
    );
    const regex = this.document.createElement("textarea");
    regex.maxLength = F2_MAX_URL_REGEX_LENGTH;
    regex.value = safeText(rule.urlRegex);
    this.renderField(
      grid,
      `URL regular expression for ${ruleName}`,
      `${rulePath}/urlRegex`,
      regex,
    );
    const urlRow = this.document.createElement("div");
    urlRow.dataset.editorUrlRow = "true";
    const urlLabel = this.document.createElement("label");
    urlLabel.textContent = `URL to match exactly for ${ruleName}`;
    const urlInput = this.document.createElement("input");
    urlInput.type = "url";
    urlInput.dataset.urlSource = "true";
    urlInput.dataset.ruleId = ruleId;
    urlInput.dataset.editorKey = `url-source:${ruleId}`;
    urlInput.value = this.urlInputs.get(ruleId) ?? "";
    urlInput.disabled = this.saving;
    urlLabel.append(urlInput);
    const convert = this.createCommandButton(
      `Convert URL to exact regex for ${ruleName}`,
      "convert-url",
      this.saving,
      { groupId, ruleId },
    );
    urlRow.append(urlLabel, convert);
    grid.append(urlRow);
    fields.append(grid);
    card.append(fields);

    this.renderOrigins(
      card,
      "Rule origins",
      rule.origins,
      "rule",
      groupId,
      ruleId,
      groupIndex,
      ruleIndex,
    );
    this.renderResourceTypes(card, rule, rulePath, ruleName);
    const matcherFields = this.document.createElement("fieldset");
    const matcherLegend = this.document.createElement("legend");
    matcherLegend.textContent = "Request constraints";
    matcherFields.append(matcherLegend);
    const matcherGrid = this.document.createElement("div");
    matcherGrid.dataset.editorFields = "true";
    const priority = this.document.createElement("input");
    priority.type = "number";
    priority.min = "1";
    priority.max = "1000";
    priority.step = "1";
    priority.value =
      typeof rule.priority === "number" && Number.isFinite(rule.priority)
        ? String(rule.priority)
        : safeText(rule.priority);
    this.renderField(
      matcherGrid,
      `Priority for ${ruleName}`,
      `${rulePath}/priority`,
      priority,
    );
    const method = this.document.createElement("select");
    const anyMethod = this.document.createElement("option");
    anyMethod.value = "";
    anyMethod.textContent = "Any method";
    method.append(anyMethod);
    for (const value of HTTP_METHODS) {
      const option = this.document.createElement("option");
      option.value = value;
      option.textContent = value;
      method.append(option);
    }
    method.value = safeText(rule.method);
    this.renderField(
      matcherGrid,
      `Method for ${ruleName}`,
      `${rulePath}/method`,
      method,
    );
    matcherFields.append(matcherGrid);
    card.append(matcherFields);

    if (this.extensions.length > 0) {
      const currentType =
        this.extensions.find((e) =>
          e.matches(rule as Readonly<Record<string, unknown>>),
        )?.id ?? safeText(rule.type);
      const typeFieldset = this.document.createElement("fieldset");
      const typeLegend = this.document.createElement("legend");
      typeLegend.textContent = `Rule type for ${ruleName}`;
      const typeField = this.document.createElement("div");
      typeField.dataset.editorField = "true";
      const typeLabel = this.document.createElement("label");
      typeLabel.textContent = "Rule type";
      const typeSelect = this.document.createElement("select");
      typeSelect.dataset.ruleTypeSelect = "true";
      typeSelect.dataset.ruleTypePath = rulePath;
      typeSelect.disabled = this.saving;
      const noOption = this.document.createElement("option");
      noOption.value = "";
      noOption.textContent = "No action (choose a rule type)";
      typeSelect.append(noOption);
      for (const extension of this.extensions) {
        const option = this.document.createElement("option");
        option.value = extension.id;
        option.textContent = extension.label;
        typeSelect.append(option);
      }
      typeSelect.value = currentType ?? "";
      typeLabel.append(typeSelect);
      typeField.append(typeLabel);
      typeFieldset.append(typeLegend, typeField);
      card.append(typeFieldset);
    }

    const match = this.findExtension(rule, rulePath);
    if (match.extension)
      this.mountExtension(card, match.extension, groupId, ruleId, rulePath);
    if (match.error) {
      const extensionError = this.document.createElement("p");
      extensionError.dataset.extensionError = "true";
      extensionError.textContent = match.error.message;
      card.append(extensionError);
    }

    const actions = this.document.createElement("div");
    actions.dataset.ruleActions = "true";
    actions.append(
      this.createCommandButton(
        `Move rule ${ruleName} up`,
        "move-rule-up",
        this.saving || ruleIndex <= 0,
        { groupId, ruleId },
      ),
      this.createCommandButton(
        `Move rule ${ruleName} down`,
        "move-rule-down",
        this.saving || ruleIndex >= group.rules.length - 1,
        { groupId, ruleId },
      ),
      this.createCommandButton(
        `Remove rule ${ruleName}`,
        "remove-rule",
        this.saving,
        {
          groupId,
          ruleId,
        },
      ),
    );
    card.append(actions);
    return card;
  }

  private renderOrigins(
    parent: HTMLElement,
    label: string,
    values: unknown[],
    owner: "group" | "rule",
    groupId: string,
    ruleId: string | undefined,
    groupIndex: number,
    ruleIndex?: number,
  ): void {
    const fieldset = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = label;
    fieldset.append(legend);
    for (let index = 0; index < values.length; index += 1) {
      const row = this.document.createElement("div");
      row.dataset.editorOriginRow = "true";
      const path =
        owner === "group"
          ? pointer("groups", groupIndex, "origins", index)
          : pointer(
              "groups",
              groupIndex,
              "rules",
              ruleIndex ?? 0,
              "origins",
              index,
            );
      const input = this.document.createElement("input");
      input.type = "text";
      input.maxLength = 2048;
      input.value = safeText(values[index]);
      input.disabled = this.saving;
      this.renderField(row, `Origin ${index + 1}`, path, input);
      const remove = this.createCommandButton(
        `Remove ${owner} origin ${index + 1}`,
        owner === "group" ? "remove-group-origin" : "remove-rule-origin",
        this.saving,
        { groupId, ruleId, index: String(index) },
      );
      row.append(remove);
      fieldset.append(row);
    }
    fieldset.append(
      this.createCommandButton(
        "Add origin",
        owner === "group" ? "add-group-origin" : "add-rule-origin",
        this.saving,
        { groupId, ruleId },
      ),
    );
    parent.append(fieldset);
  }

  private renderResourceTypes(
    parent: HTMLElement,
    rule: DraftRule,
    rulePath: string,
    ruleName: string,
  ): void {
    const fieldset = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = `Resource types for ${ruleName}`;
    fieldset.append(legend);
    const checks = this.document.createElement("div");
    checks.dataset.editorChecks = "true";
    for (const resourceType of RESOURCE_TYPES) {
      const label = this.document.createElement("label");
      const input = this.document.createElement("input");
      input.type = "checkbox";
      input.dataset.resourcePath = `${rulePath}/resourceTypes`;
      input.dataset.resourceType = resourceType;
      input.checked = rule.resourceTypes.includes(resourceType);
      input.disabled = this.saving;
      label.append(input, this.document.createTextNode(resourceType));
      checks.append(label);
    }
    fieldset.append(checks);
    parent.append(fieldset);
  }

  private mountExtension(
    parent: HTMLElement,
    extension: RuleTypeFieldExtension,
    groupId: string,
    ruleId: string,
    rulePath: string,
  ): void {
    const fieldset = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = extension.label;
    fieldset.append(legend);
    const container = this.document.createElement("div");
    container.dataset.extensionFields = extension.id;
    fieldset.append(container);
    parent.append(fieldset);
    const context: RuleTypeFieldContext = {
      document: this.document,
      container,
      rulePath,
      getField: (name) => {
        if (!isValidExtensionName(name)) return undefined;
        const rule = this.ruleById(groupId, ruleId);
        if (!rule) return undefined;
        const resolved = extensionFieldParent(rule, name);
        if (!resolved) return undefined;
        const value = resolved.parent[resolved.key];
        return value === undefined ? undefined : cloneSnapshot(value);
      },
      setField: (name, value) => {
        if (!isValidExtensionName(name)) {
          this.extensionErrors.set(
            rulePath,
            diagnostic(
              "editor.extension-field",
              rulePath,
              "An additional rule field attempted to change a common field.",
            ),
          );
          return;
        }
        const snapshot = snapshotOwnData(value);
        if (!snapshot.valid) {
          this.extensionErrors.set(
            rulePath,
            diagnostic(
              "editor.extension-field",
              rulePath,
              "An additional rule field contained invalid data.",
            ),
          );
          return;
        }
        const rule = this.ruleById(groupId, ruleId);
        if (!rule || this.saving) return;
        const resolved = extensionFieldParent(rule, name);
        if (!resolved) {
          this.extensionErrors.set(
            rulePath,
            diagnostic(
              "editor.extension-field",
              rulePath,
              "An additional rule field could not be resolved.",
            ),
          );
          return;
        }
        if (!Object.is(resolved.parent[resolved.key], snapshot.value)) {
          Object.defineProperty(resolved.parent, resolved.key, {
            configurable: true,
            enumerable: true,
            value: snapshot.value,
            writable: true,
          });
          this.markChanged();
          this.render();
        }
      },
      deleteField: (name) => {
        if (!isValidExtensionName(name)) return;
        const rule = this.ruleById(groupId, ruleId);
        if (rule && Object.hasOwn(rule, name) && !this.saving) {
          delete rule[name];
          this.markChanged();
          this.render();
        }
      },
      registerControl: (fieldPath, control) => {
        const firstSegment = decodePointer(fieldPath)?.[0] ?? "";
        if (
          !fieldPath.startsWith("/") ||
          !isHTMLElement(control) ||
          control.ownerDocument !== this.document ||
          !isValidExtensionName(firstSegment)
        ) {
          this.extensionErrors.set(
            rulePath,
            diagnostic(
              "editor.extension-control",
              rulePath,
              "An additional rule field registered an invalid control.",
            ),
          );
          return;
        }
        const absolutePath = `${rulePath}${fieldPath}`;
        control.dataset.path = absolutePath;
        this.extensionControls.set(absolutePath, control);
      },
    };
    try {
      const mount = extension.mount(context);
      if (!mount || typeof mount.destroy !== "function") {
        throw new Error("invalid extension mount");
      }
      this.extensionCleanups.push(() => {
        try {
          mount.destroy();
        } catch {
          this.extensionErrors.set(
            rulePath,
            diagnostic(
              "editor.extension-failed",
              rulePath,
              "An additional rule field could not be cleaned up.",
            ),
          );
        }
      });
    } catch {
      this.extensionErrors.set(
        rulePath,
        diagnostic(
          "editor.extension-failed",
          rulePath,
          "An additional rule field could not be rendered.",
        ),
      );
      const message = this.document.createElement("p");
      message.textContent = "Additional rule fields are unavailable.";
      fieldset.append(message);
    }
  }

  private cleanupExtensions(): void {
    const cleanups = this.extensionCleanups;
    this.extensionCleanups = [];
    for (const cleanup of cleanups) cleanup();
  }

  private decorateExtensionControls(): void {
    for (const [path, control] of this.extensionControls) {
      const id = this.controlId(path);
      control.id = id;
      control.dataset.editorKey = path;
      const fieldErrors = this.errors.filter((value) => value.path === path);
      if (fieldErrors.length === 0) {
        control.removeAttribute("aria-invalid");
        continue;
      }
      control.setAttribute("aria-invalid", "true");
      const error = this.document.createElement("div");
      error.id = `${id}-error`;
      error.dataset.editorFieldError = "true";
      error.textContent = fieldErrors.map((value) => value.message).join(" ");
      control.setAttribute("aria-describedby", error.id);
      control.parentElement?.append(error);
    }
  }

  private renderField(
    parent: HTMLElement,
    labelText: string,
    path: string,
    control: FormControl,
  ): void {
    const field = this.document.createElement("div");
    field.dataset.editorField = "true";
    const label = this.document.createElement("label");
    const id = this.controlId(path);
    label.htmlFor = id;
    label.textContent = labelText;
    control.id = id;
    control.dataset.path = path;
    control.dataset.editorKey = path;
    control.disabled = this.saving;
    const errors = this.errors.filter((value) => value.path === path);
    if (errors.length > 0) {
      control.setAttribute("aria-invalid", "true");
      const error = this.document.createElement("div");
      error.id = `${id}-error`;
      error.dataset.editorFieldError = "true";
      error.textContent = errors.map((value) => value.message).join(" ");
      control.setAttribute("aria-describedby", error.id);
      field.append(label, control, error);
    } else {
      control.removeAttribute("aria-invalid");
      field.append(label, control);
    }
    this.controls.set(path, control);
    parent.append(field);
  }

  private renderSummary(): void {
    this.summary.replaceChildren();
    this.summary.hidden = this.errors.length === 0;
    if (this.errors.length === 0) return;
    const heading = this.document.createElement("h2");
    heading.textContent = "Fix these errors before saving";
    const list = this.document.createElement("ul");
    for (const error of this.errors) {
      const item = this.document.createElement("li");
      const button = this.document.createElement("button");
      button.type = "button";
      button.dataset.errorPath = error.path;
      button.textContent = `${error.message} (${error.path || "project"})`;
      item.append(button);
      list.append(item);
    }
    this.summary.append(heading, list);
  }

  private renderSearchResults(): void {
    this.searchResults.replaceChildren();
    this.searchResults.hidden = this.searchQuery.length === 0;
    if (this.searchQuery.length === 0) return;
    const heading = this.document.createElement("h2");
    heading.textContent = "Search results";
    const results = this.searchResultsFor(this.searchQuery);
    const count = this.document.createElement("p");
    count.textContent = `${results.length} result${results.length === 1 ? "" : "s"}.`;
    const list = this.document.createElement("ul");
    for (const result of results) {
      const item = this.document.createElement("li");
      const button = this.document.createElement("button");
      button.type = "button";
      button.dataset.searchResult = result.path;
      button.textContent = result.label;
      item.append(button);
      list.append(item);
    }
    this.searchResults.append(heading, count, list);
    if (results.length === 0) {
      const empty = this.document.createElement("p");
      empty.textContent = "No matching project, group, or rule fields.";
      this.searchResults.append(empty);
    }
  }

  private searchResultsFor(
    query: string,
  ): Array<{ path: string; label: string }> {
    const needle = toSearchText(query);
    if (!needle) return [];
    const results: Array<{ path: string; label: string }> = [];
    const matches = (values: readonly unknown[]): number => {
      for (let index = 0; index < values.length; index += 1) {
        if (toSearchText(values[index]).includes(needle)) return index;
      }
      return -1;
    };
    const projectMatch = matches([this.draft.name, this.draft.description]);
    if (projectMatch !== -1) {
      results.push({
        path: projectMatch === 0 ? "/name" : "/description",
        label: "Project details",
      });
    }
    for (
      let groupIndex = 0;
      groupIndex < this.draft.groups.length;
      groupIndex += 1
    ) {
      const group = this.draft.groups[groupIndex];
      const groupMatch = matches([group.id, group.name, ...group.origins]);
      if (groupMatch !== -1) {
        results.push({
          path: pointer(
            "groups",
            groupIndex,
            groupMatch === 0 ? "id" : groupMatch === 1 ? "name" : "origins",
            ...(groupMatch > 1 ? [groupMatch - 2] : []),
          ),
          label: `Group: ${displayName(group.name, "Unnamed group")}`,
        });
      }
      for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
        const rule = group.rules[ruleIndex];
        const ruleMatch = matches([
          rule.id,
          rule.name,
          rule.urlRegex,
          ...rule.origins,
          ...rule.resourceTypes,
          rule.priority,
          rule.method,
        ]);
        if (ruleMatch === -1) continue;
        const field =
          ruleMatch === 0
            ? "id"
            : ruleMatch === 1
              ? "name"
              : ruleMatch === 2
                ? "urlRegex"
                : ruleMatch < 3 + rule.origins.length
                  ? "origins"
                  : ruleMatch <
                      3 + rule.origins.length + rule.resourceTypes.length
                    ? "resourceTypes"
                    : ruleMatch ===
                        3 + rule.origins.length + rule.resourceTypes.length
                      ? "priority"
                      : "method";
        results.push({
          path: pointer("groups", groupIndex, "rules", ruleIndex, field),
          label: `Rule: ${displayName(rule.name, "Unnamed rule")}`,
        });
      }
    }
    return results;
  }

  private renderConfirmation(): void {
    const existing = this.host.querySelector("[data-editor-confirmation]");
    existing?.remove();
    if (!this.confirmation) return;
    const overlay = this.document.createElement("div");
    overlay.dataset.editorConfirmation = "true";
    overlay.setAttribute("role", "presentation");
    const dialog = this.document.createElement("section");
    dialog.dataset.editorDialog = "true";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    const title = this.document.createElement("h2");
    title.id = `${this.instanceId}-confirmation-title`;
    const message = this.document.createElement("p");
    const actions = this.document.createElement("div");
    actions.dataset.editorDialogActions = "true";
    const cancel = this.document.createElement("button");
    cancel.type = "button";
    cancel.dataset.command =
      this.confirmation.kind === "cancel"
        ? "cancel-confirmation"
        : "remove-confirmation";
    cancel.dataset.editorKey = "confirm-cancel";
    cancel.textContent =
      this.confirmation.kind === "cancel" ? "Keep editing" : "Cancel removal";
    const confirm = this.document.createElement("button");
    confirm.type = "button";
    confirm.dataset.command =
      this.confirmation.kind === "cancel" ? "confirm-cancel" : "confirm-remove";
    confirm.dataset.editorKey = "confirm-action";
    if (this.confirmation.kind === "cancel") {
      title.textContent = "Discard unsaved changes?";
      message.textContent =
        "Your current edits will be replaced by the last saved project.";
      confirm.textContent = "Discard changes";
    } else if (this.confirmation.kind === "remove-group") {
      title.textContent = "Remove group?";
      message.textContent = `Remove group ${this.confirmation.name} and its rules?`;
      confirm.textContent = "Remove group";
    } else {
      title.textContent = "Remove rule?";
      message.textContent = `Remove rule ${this.confirmation.name}?`;
      confirm.textContent = "Remove rule";
    }
    dialog.setAttribute("aria-labelledby", title.id);
    actions.append(cancel, confirm);
    dialog.append(title, message, actions);
    overlay.append(dialog);
    this.host.append(overlay);
  }

  private createButton(label: string, key: string): HTMLButtonElement {
    const button = this.document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.editorKey = `button:${key}`;
    return button;
  }

  private createCommandButton(
    label: string,
    command: string,
    disabled: boolean,
    data: Record<string, string | undefined> = {},
  ): HTMLButtonElement {
    const button = this.createButton(
      label,
      `command:${command}:${Object.values(data).join(":")}`,
    );
    button.dataset.command = command;
    button.disabled = disabled;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) button.dataset[key] = value;
    }
    return button;
  }

  private controlId(path: string): string {
    const existing = Array.from(this.controls.entries()).find(
      ([key]) => key === path,
    )?.[1].id;
    if (existing) return existing;
    return `${this.instanceId}-control-${++this.controlNumber}`;
  }

  private captureFocus(): FocusSnapshot | undefined {
    const active = this.document.activeElement;
    if (!(active instanceof HTMLElement) || !this.host.contains(active))
      return undefined;
    const key = active.dataset.editorKey;
    if (!key) return undefined;
    const selectionStart =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
        ? active.selectionStart
        : undefined;
    const selectionEnd =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
        ? active.selectionEnd
        : undefined;
    return { key, selectionStart, selectionEnd };
  }

  private restoreFocus(): void {
    const requested = this.focusRequest;
    let key = requested;
    if (requested && this.controls.has(requested)) key = requested;
    if (!key && this.previousFocus) key = this.previousFocus.key;
    if (!key) return;
    let control: HTMLElement | undefined = this.controls.get(key);
    if (!control) {
      const candidates =
        this.host.querySelectorAll<HTMLElement>("[data-editor-key]");
      for (const candidate of candidates) {
        if (candidate.dataset.editorKey === key) {
          control = candidate;
          break;
        }
      }
    }
    if (
      !control ||
      control.hidden ||
      control.getAttribute("aria-hidden") === "true"
    )
      return;
    control.focus();
    const focus = this.previousFocus;
    if (
      focus &&
      (control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement)
    ) {
      if (focus.selectionStart !== undefined && focus.selectionStart !== null) {
        try {
          control.setSelectionRange(
            focus.selectionStart,
            focus.selectionEnd ?? focus.selectionStart,
          );
        } catch {
          // Some input types do not expose a selectable range.
        }
      }
    }
  }
}

function isSaveSuccess(value: unknown): value is { ok: true } {
  return isRecord(value) && value.ok === true;
}

function saveFailureDiagnostic(value: unknown): EditorDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      "editor.save-failed",
      "",
      "The host could not save the project.",
    );
  }
  const code =
    typeof value.code === "string" ? value.code : "editor.save-failed";
  const path = typeof value.path === "string" ? value.path : "";
  const message =
    typeof value.message === "string" && value.message.length > 0
      ? value.message
      : "The host could not save the project.";
  return diagnostic(code, path, message);
}

export type ResolvedRoute =
  | { readonly kind: "project" }
  | { readonly kind: "group"; readonly groupId: string };

/** Resolve a deep-link group id to a concrete editor route, falling back to Overview. */
export function resolveGroupRoute(
  groupId: string | null | undefined,
  groupIds: ReadonlySet<string>,
): ResolvedRoute {
  if (
    typeof groupId === "string" &&
    groupId.length > 0 &&
    groupIds.has(groupId)
  ) {
    return { kind: "group", groupId };
  }
  return { kind: "project" };
}

export function createEditor(options: EditorOptions): EditorController {
  if (!options || !isHTMLElement(options.root)) {
    throw new EditorInitializationError([
      diagnostic("editor.invalid-root", "", "The editor root is invalid."),
    ]);
  }
  if (
    typeof options.validate !== "function" ||
    typeof options.save !== "function"
  ) {
    throw new EditorInitializationError([
      diagnostic(
        "editor.invalid-host",
        "",
        "The editor requires validation and save host functions.",
      ),
    ]);
  }
  const snapshot = snapshotOwnData(options.initialProject);
  const project = snapshot.valid ? asDraftProject(snapshot.value) : undefined;
  if (!snapshot.valid || !project) {
    throw new EditorInitializationError([
      diagnostic(
        "editor.invalid-initial-project",
        "",
        "The initial project is invalid or unsafe.",
      ),
    ]);
  }
  const extensions = normalizeExtensions(options.ruleTypes);
  return new EditorControllerImpl(options, project, extensions);
}
