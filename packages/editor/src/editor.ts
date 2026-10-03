import type { HttpMethod, ResourceType } from "@rogatio/schema";
import {
  deriveEntityId,
  hasControl,
  LIMITS,
  normalizeNameKey,
  uniqueName,
} from "@rogatio/schema";
import { createAIAssistPanel } from "./ai-assist-panel.js";
import { builtInRuleTypes } from "./rule-types/index.js";
import {
  type AIAssistChunk,
  type AIAssistRequest,
  type AIAssistResponse,
  type AIProposal,
  type DryRunResult,
  type DryRunRuleMatchResult,
  type DryRunTestCase,
  type EditorController,
  type EditorDiagnostic,
  EditorInitializationError,
  type EditorOptions,
  type EditorProjectSnapshot,
  type RuleProposal,
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

const RESOURCE_TYPE_GLOSS: Readonly<Record<ResourceType, string>> = {
  main_frame: "Top-level page navigation",
  sub_frame: "iframe / embedded frame",
  stylesheet: "CSS stylesheet",
  script: "JavaScript file",
  image: "Image",
  font: "Web font",
  object: "Plugin / <object> / <embed>",
  media: "Audio / video",
  xmlhttprequest: "XHR and fetch",
  ping: "Hyperlink ping / beacon",
  csp_report: "CSP violation report",
  websocket: "WebSocket",
  webtransport: "WebTransport",
  webbundle: "Web Bundle",
  other: "Anything else",
};

const RESOURCE_TYPE_GROUPS = [
  { label: "Page", types: ["main_frame", "sub_frame"] },
  {
    label: "Assets",
    types: ["stylesheet", "script", "image", "font", "media", "object"],
  },
  {
    label: "Network",
    types: [
      "xmlhttprequest",
      "websocket",
      "webtransport",
      "ping",
      "csp_report",
      "webbundle",
    ],
  },
  { label: "Other", types: ["other"] },
] as const satisfies ReadonlyArray<{
  readonly label: string;
  readonly types: readonly ResourceType[];
}>;

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

/** Plain names for the test console. Schema values stay on the option. */
const RESOURCE_TYPE_LABELS: Readonly<Record<ResourceType, string>> = {
  main_frame: "Page",
  sub_frame: "Frame",
  stylesheet: "Stylesheet",
  script: "Script",
  image: "Image",
  font: "Font",
  object: "Plugin",
  media: "Media",
  xmlhttprequest: "Fetch",
  ping: "Ping",
  csp_report: "CSP report",
  websocket: "WebSocket",
  webtransport: "WebTransport",
  webbundle: "Web Bundle",
  other: "Other",
};

/** Matches the dry-run engine default. Mentioned only when the list is longer. */
const TEST_CASE_LIMIT = 256;

const RULE_TYPE_LABELS: Readonly<Record<string, string>> = {
  redirect: "Redirect",
  query: "Query parameters",
  header: "Header",
  "response-body": "Response body",
  "request-body": "Request body",
};

const COMMON_RULE_FIELDS = new Set([
  "id",
  "name",
  "source",
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

type JsonRecord = Record<string, unknown>;
type DraftSource = JsonRecord & {
  key: unknown;
  operator: unknown;
  value: unknown;
};
type DraftRule = JsonRecord & {
  id: unknown;
  name: unknown;
  source: DraftSource;
  resourceTypes: unknown[];
  priority: unknown;
  method?: unknown;
};
type DraftGroup = JsonRecord & {
  id: unknown;
  name: unknown;
  rules: DraftRule[];
};
type DraftProject = JsonRecord & {
  version: unknown;
  name: unknown;
  groups: DraftGroup[];
};
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
/**
 * The entity whose name is being edited in place. Identity is by id, not by
 * index, because ids are frozen at creation and a move or copy reorders the
 * draft without changing them. The name path is index-based, matching every
 * other control key in the editor.
 */
type RenameTarget = {
  readonly kind: "group" | "rule";
  readonly groupId: string;
  readonly ruleId?: string;
  namePath: string;
  value: string;
};
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

const MATCHER_CREATABLE_FIELDS = ["description", "method", "type"] as const;

const ACTION_PAYLOAD_FIELDS = [
  "redirect",
  "action",
  "requestBody",
  "responseBody",
  "headerDirection",
  "headerOperation",
  "headerName",
  "headerValue",
] as const;

const CREATABLE_RULE_FIELDS = new Set<string>([
  ...MATCHER_CREATABLE_FIELDS,
  ...ACTION_PAYLOAD_FIELDS,
  "redactSensitiveInLogs",
]);

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
    !CREATABLE_RULE_FIELDS.has(finalSegment)
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

function clearActionFields(
  rule: unknown,
  keep?: string,
  keepFields?: ReadonlySet<string>,
): boolean {
  if (!isRecord(rule)) return false;
  let changed = false;
  for (const field of ACTION_PAYLOAD_FIELDS) {
    if (field === keep || keepFields?.has(field)) continue;
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

function checkingCopy(
  method: HttpMethod | "",
  resourceType: ResourceType | "",
): string {
  if (method === "GET" && resourceType === "main_frame") {
    return "Checking these as page loads (GET).";
  }
  if (method === "" && resourceType === "") {
    return "The method and the resource type are not tested.";
  }
  const resourceLabel =
    resourceType === "" ? "" : RESOURCE_TYPE_LABELS[resourceType];
  if (method === "") {
    const subject =
      resourceType === "main_frame"
        ? "page loads"
        : `${resourceLabel} requests`;
    return `Checking these as ${subject}. The method is not tested.`;
  }
  if (resourceType === "") {
    return `Checking these as ${method} requests. The resource type is not tested.`;
  }
  if (resourceType === "main_frame") {
    return `Checking these as page loads (${method}).`;
  }
  return `Checking these as ${resourceLabel} requests (${method}).`;
}

/**
 * An exact URL pattern is the `^` + escaped href + `$` produced by
 * `urlToExactRegex`. Anything else (a capture, an unanchored regex) is not
 * offered as a sample URL.
 */
function exactUrlFromSource(source: DraftSource | undefined): string | null {
  if (source?.key !== "url" || source.operator !== "regex") {
    return null;
  }
  if (typeof source.value !== "string") return null;
  const value = source.value;
  if (!value.startsWith("^") || !value.endsWith("$") || value.length < 2) {
    return null;
  }
  let decoded = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === "\\") {
      index += 1;
      const escaped = value[index];
      if (escaped === undefined || index >= value.length - 1) return null;
      decoded += escaped;
      continue;
    }
    if ("^$\\.*+?()[]{}|".includes(char)) return null;
    decoded += char;
  }
  const converted = urlToExactRegex(decoded);
  if (!converted.ok || converted.source !== value) return null;
  return decoded;
}

function isDryRunResult(value: unknown): value is DryRunResult {
  if (!isRecord(value)) return false;
  const summary = value.summary;
  return (
    Array.isArray(value.results) &&
    Array.isArray(value.errors) &&
    isRecord(summary) &&
    typeof summary.matchedUrlCount === "number" &&
    typeof summary.urlCount === "number"
  );
}

function previewSentence(
  preview: { readonly kind: string; readonly summary: string } | null,
): string | null {
  if (!preview || preview.summary.length === 0) return null;
  switch (preview.kind) {
    case "redirect":
      return `The browser would go to ${preview.summary}.`;
    case "query":
      return `The query would be ${preview.summary}.`;
    case "header":
      return `The header would be ${preview.summary}.`;
    case "request-body":
      return `The request body would be ${preview.summary}.`;
    case "response-body":
      return `The response body would be ${preview.summary}.`;
    default:
      return null;
  }
}

function missReason(rule: DryRunRuleMatchResult): string {
  if (rule.source.state === "unmatched") return "URL pattern";
  if (rule.method.state === "unmatched") return "method";
  if (rule.resourceType.state === "unmatched") return "resource type";
  return "URL pattern";
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as HTMLElement).nodeType === 1 &&
    typeof (value as HTMLElement).appendChild === "function"
  );
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
  );
}

function aiAssistErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "AI Assist failed.";
}

function ownString(
  record: JsonRecord,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    if (FORBIDDEN_EXTENSION_FIELDS.has(key)) continue;
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

interface RuleRepairTarget {
  readonly groupId: string;
  readonly ruleId: string;
}

const RULE_PATH_PATTERN =
  /^\/groups\/(0|[1-9][0-9]*)\/rules\/(0|[1-9][0-9]*)(?:\/|$)/;

function applyRuleProposalAction(
  rule: DraftRule,
  ruleProposal: RuleProposal,
): void {
  const action = ruleProposal.action;
  switch (ruleProposal.kind) {
    case "redirect": {
      rule.type = "redirect";
      const snap = snapshotOwnData(action);
      if (snap.valid) rule.redirect = snap.value;
      return;
    }
    case "query": {
      rule.type = "query";
      const snap = snapshotOwnData(action);
      if (snap.valid) rule.action = snap.value;
      return;
    }
    case "header": {
      rule.type = "header";
      if (!isRecord(action)) return;
      const direction = ownString(action, "headerDirection", "direction");
      const operation = ownString(action, "headerOperation", "operation");
      const name = ownString(action, "headerName", "name");
      const value = ownString(action, "headerValue", "value");
      if (direction !== undefined) rule.headerDirection = direction;
      if (operation !== undefined) rule.headerOperation = operation;
      if (name !== undefined) rule.headerName = name;
      if (value !== undefined) rule.headerValue = value;
      return;
    }
    case "response-body": {
      rule.type = "response-body";
      const snap = snapshotOwnData(action);
      if (snap.valid) rule.responseBody = snap.value;
      return;
    }
    case "request-body": {
      rule.type = "request-body";
      const snap = snapshotOwnData(action);
      if (snap.valid) rule.requestBody = snap.value;
      return;
    }
    default: {
      const _exhaustive: never = ruleProposal.kind;
      void _exhaustive;
    }
  }
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
  private readonly controls = new Map<string, HTMLElement>();
  /** Live draft group object to the id last saved for that group. */
  private readonly savedGroupIds = new WeakMap<DraftGroup, string>();
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
  private testMethod: HttpMethod | "" = "GET";
  private testResourceType: ResourceType | "" = "main_frame";
  private testResult: DryRunResult | undefined = undefined;
  private testRunning = false;
  private testRequestId = 0;
  private aiAssistPanel: ReturnType<typeof createAIAssistPanel> | null = null;
  private aiAssistInFlight = false;
  private aiRepairTargets: readonly RuleRepairTarget[] = [];
  private migrationNoticesDismissed = false;
  /**
   * The entity whose name is being edited in place, if any. The buffer lives
   * here rather than in the DOM because every render rebuilds the heading, and
   * the draft is deliberately untouched until an explicit commit.
   */
  private renameTarget: RenameTarget | undefined;
  /** Re-entrancy guard: committing a rename renders, which asks again. */
  private renamingInProgress = false;

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
    this.bindSavedGroupIds();

    // Structurally valid drafts may still fail host validation (e.g. CLI bootstrap
    // with an empty name). Mount and surface those diagnostics instead of failing closed.
    this.errors = this.collectDiagnostics(this.draft);
    if (this.errors.length > 0) {
      this.statusMessage = `${this.errors.length} validation error${
        this.errors.length === 1 ? "" : "s"
      } found.`;
      this.focusRequest = this.errors[0]?.path;
    }

    // Initialize AI Assist Panel if handler provided
    if (options.aiAssist) {
      this.aiAssistPanel = createAIAssistPanel(
        this.root,
        {
          getDraft: () => this.getDraft(),
          navigateToGroup: (groupId) => this.navigateToGroup(groupId),
        },
        (proposal: AIProposal) => this.applyAIProposal(proposal),
        () => {},
        (prompt) => this.runAIAssist(prompt),
      );
    }

    this.host = this.document.createElement("div");
    this.host.className = "rogatio-editor";
    this.host.dataset.rogatioEditor = "true";

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
    this.commandBar.setAttribute("aria-label", "Project actions");
    this.form = this.document.createElement("form");
    this.form.dataset.editorForm = "true";
    this.form.noValidate = true;
    this.searchResults = this.document.createElement("section");
    this.searchResults.id = "rogatio-search-results";
    this.searchResults.dataset.searchResults = "true";

    this.host.addEventListener("click", (event) => {
      if (!this.searchQuery) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-search-wrap]"))
        return;
      this.searchQuery = "";
      this.render();
    });

    this.main.append(
      this.header,
      this.status,
      this.summary,
      this.commandBar,
      this.form,
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
    if (this.aiAssistPanel) {
      this.aiAssistPanel.destroy();
      this.aiAssistPanel = null;
    }
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
    if (target.dataset.renameInput !== undefined) {
      // The inline name editor holds an uncommitted buffer. Writing it into the
      // draft on every keystroke would make the explicit save meaningless, would
      // clear the rejection message through `markChanged`, and would leave
      // Escape nothing to revert to.
      if (this.renameTarget) this.renameTarget.value = target.value;
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
      this.render();
      return;
    }
    if (
      target instanceof HTMLSelectElement &&
      target.dataset.testResourceType !== undefined
    ) {
      this.testResourceType = (target.value || "") as ResourceType | "";
      this.render();
      return;
    }
    const path = target.dataset.path;
    if (
      path &&
      target instanceof HTMLInputElement &&
      target.type === "checkbox" &&
      !this.extensionControls.has(path)
    ) {
      const changed = setValueAtPath(this.draft, path, target.checked);
      if (changed) {
        this.markChanged();
        this.render();
      }
      return;
    }
    if (!path || this.extensionControls.has(path)) return;
    if (this.updateCommonField(path, target.value)) this.render();
  };

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    // Every button in the editor is `type="button"`, so the form has no submit
    // button and implicit submission applies when the inline name editor is the
    // only field — a group page with no rules. Guard here as well as on keydown;
    // the keydown alone does not prevent it. Keyed on focus rather than on the
    // event target, because implicit submission fires the event at the form: what
    // distinguishes the two cases is which field the user pressed Enter in.
    if (this.renameTarget && this.renameInputFocused()) {
      this.commitRename();
      return;
    }
    this.dispatchCommand("save", this.form);
  };

  private renameInputFocused(): boolean {
    const active = this.document.activeElement;
    return (
      active instanceof HTMLElement && active.dataset.renameInput !== undefined
    );
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    // Escape dismissing the remove/discard dialog keeps working during an IME
    // composition elsewhere in the editor, so the composition guard is scoped to
    // the rename editor's own keys.
    if (event.key === "Escape" && this.confirmation) {
      event.preventDefault();
      this.confirmation = undefined;
      this.statusMessage = "No changes were discarded.";
      this.render();
      return;
    }
    const target = event.target;
    const inRenameInput =
      target instanceof HTMLElement && target.dataset.renameInput !== undefined;
    if (!inRenameInput) return;
    // Enter pressed to accept an IME candidate also arrives as a keydown, with
    // `isComposing` set. Neither Enter nor Escape may act on a half-composed
    // string.
    if (this.composing || event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.cancelRename();
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
    if (command === "ai-assist") {
      if (this.aiAssistPanel) {
        this.aiAssistPanel.show();
      }
      return;
    }
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
    if (command === "copy-group") {
      const groupId = element.dataset.groupId;
      if (groupId) this.copyGroup(groupId);
      return;
    }
    if (command === "remove-rule") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) this.requestRemoveRule(groupId, ruleId);
      return;
    }
    if (command === "copy-rule") {
      const groupId = element.dataset.groupId;
      const ruleId = element.dataset.ruleId;
      if (groupId && ruleId) this.copyRule(groupId, ruleId);
      return;
    }
    if (command === "rename-entity") {
      const groupId = element.dataset.groupId;
      if (!groupId) return;
      const ruleId = element.dataset.ruleId;
      this.openRename(
        element.dataset.renameKind === "rule" ? "rule" : "group",
        groupId,
        ruleId,
      );
      return;
    }
    if (command === "commit-rename") {
      this.commitRename();
      return;
    }
    if (command === "cancel-rename") {
      this.cancelRename();
      return;
    }
    if (command === "repair-id") {
      const path = element.dataset.repairPath;
      if (!path) return;
      this.repairEntityId(path);
      return;
    }
    if (command === "dismiss-migration-notices") {
      void this.dismissMigrationNotices();
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
    if (command === "test:open-rule") {
      this.navigateToRule(element.dataset.groupId, element.dataset.ruleId);
      return;
    }
    if (command === "test:try-url") {
      const url = element.dataset.url;
      if (!url) return;
      this.testUrls = url;
      this.statusMessage = "";
      this.render();
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
          rawValue === "redirect" ? rawValue : undefined,
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
    if (!extension?.defaultAction && !extension?.defaultFields) return;
    const changedType = setValueAtPath(this.draft, `${rulePath}/type`, typeId);
    let changedPayload = false;
    let keep: string | undefined;
    let keepFields: ReadonlySet<string> | undefined;
    if (extension.defaultFields) {
      const fields = extension.defaultFields();
      keepFields = new Set(Object.keys(fields));
      for (const [key, value] of Object.entries(fields)) {
        if (setValueAtPath(this.draft, `${rulePath}/${key}`, value)) {
          changedPayload = true;
        }
      }
    } else {
      const defaultAction = extension.defaultAction;
      if (defaultAction) {
        keep = extension.actionField ?? "action";
        if (
          setValueAtPath(this.draft, `${rulePath}/${keep}`, defaultAction())
        ) {
          changedPayload = true;
        }
      }
    }
    const cleared = clearActionFields(ruleContainer, keep, keepFields);
    if (changedType || changedPayload || cleared) {
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

  /**
   * Every name currently in the project, keyed for uniqueness comparison. Names
   * are unique per project across groups and rules together, so a new entity
   * must claim a free one or the project it produces is invalid.
   */
  private allNameKeys(): Set<string> {
    const reserved = new Set<string>();
    for (const group of this.draft.groups) {
      if (typeof group.name === "string") {
        reserved.add(normalizeNameKey(group.name));
      }
      for (const rule of group.rules) {
        if (typeof rule.name === "string") {
          reserved.add(normalizeNameKey(rule.name));
        }
      }
    }
    return reserved;
  }

  private copyLabel(name: unknown): string {
    const base = typeof name === "string" ? name : "";
    const suffix = " (copy)";
    if (base.length + suffix.length <= LIMITS.maxLabelLength) {
      return `${base}${suffix}`;
    }
    return base;
  }

  private addGroup(): void {
    if (this.saving) return;
    const name = uniqueName("New group", this.allNameKeys());
    const groupId = deriveEntityId(name, "group", this.allIds());
    this.draft.groups.push({
      id: groupId,
      name,
      rules: [],
    });
    this.markChanged();
    this.route = { kind: "group", groupId };
    this.statusMessage = "Group added.";
    this.openRename("group", groupId);
  }

  private addRule(groupId: string): void {
    if (this.saving) return;
    const group = this.groupById(groupId);
    if (!group) return;
    const name = uniqueName("New rule", this.allNameKeys());
    const ruleId = deriveEntityId(name, "rule", this.allIds());
    group.rules.push({
      id: ruleId,
      name,
      source: { key: "url", operator: "regex", value: "" },
      resourceTypes: ["main_frame"],
      priority: 100,
    });
    this.markChanged();
    this.route = { kind: "group", groupId };
    this.statusMessage = "Rule added.";
    this.openRename("rule", groupId, ruleId);
  }

  private copyRule(groupId: string, ruleId: string): void {
    if (this.saving) return;
    const group = this.groupById(groupId);
    if (!group) return;
    const sourceIndex = this.ruleIndex(group, ruleId);
    if (sourceIndex < 0) return;
    const snapshot = snapshotOwnData(group.rules[sourceIndex]);
    if (
      !snapshot.valid ||
      typeof snapshot.value !== "object" ||
      snapshot.value === null
    ) {
      this.statusMessage = "Could not copy rule.";
      this.render();
      return;
    }
    const copied = snapshot.value as DraftRule;
    // The copy's name is claimed first, so the id is derived from the name the
    // user will actually see, and a copy is never a duplicate of its source.
    copied.name = uniqueName(
      this.copyLabel(group.rules[sourceIndex].name),
      this.allNameKeys(),
    );
    copied.id = deriveEntityId(copied.name, "rule", this.allIds());
    group.rules.splice(sourceIndex + 1, 0, copied);
    this.markChanged();
    this.route = { kind: "group", groupId };
    this.statusMessage = "Rule copied.";
    this.openRename("rule", groupId, String(copied.id));
  }

  private copyGroup(groupId: string): void {
    if (this.saving) return;
    const sourceIndex = this.groupIndex(groupId);
    if (sourceIndex < 0) return;
    const source = this.draft.groups[sourceIndex];
    const snapshot = snapshotOwnData(source);
    if (
      !snapshot.valid ||
      typeof snapshot.value !== "object" ||
      snapshot.value === null
    ) {
      this.statusMessage = "Could not copy group.";
      this.render();
      return;
    }
    const copied = snapshot.value as DraftGroup;
    if (!Array.isArray(copied.rules)) {
      this.statusMessage = "Could not copy group.";
      this.render();
      return;
    }
    const names = this.allNameKeys();
    const ids = this.allIds();
    copied.name = uniqueName(this.copyLabel(source.name), names);
    copied.id = deriveEntityId(copied.name, "group", ids);
    for (const rule of copied.rules) {
      // The id is reassigned unconditionally: skipping it for a rule whose name
      // is not a string would leave the copy sharing the source rule's id.
      // `deriveEntityId` is total, so a hostile name still yields a valid id.
      if (typeof rule.name === "string") {
        rule.name = uniqueName(rule.name, names);
      }
      rule.id = deriveEntityId(rule.name, "rule", ids);
    }
    this.draft.groups.splice(sourceIndex + 1, 0, copied);
    this.markChanged();
    this.statusMessage = "Group copied.";
    this.openRename("group", String(copied.id));
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
    // An uncommitted rename belongs to the entity it was started on, so
    // removing that entity must not leave its buffer armed against whatever
    // takes its place.
    this.closeRenameFor(
      confirmation.kind === "remove-group"
        ? { groupId: confirmation.groupId, ruleId: undefined }
        : { groupId: confirmation.groupId, ruleId: confirmation.ruleId },
    );
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
    this.bindSavedGroupIds();
    this.revision += 1;
    this.errors = [];
    this.conversionDiagnostics.clear();
    this.confirmation = undefined;
    // The discarded draft is gone, so an uncommitted rename against it is too.
    this.renameTarget = undefined;
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
      this.bindSavedGroupIds();
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

  private applyAIProposal(proposal: AIProposal): void {
    const repairs = [...this.aiRepairTargets];
    this.aiRepairTargets = [];
    let lastApplied: { groupId: string; ruleId: string } | undefined;
    for (const ruleProposal of proposal.rules) {
      // Find or create the group
      let group = this.groupById(ruleProposal.groupId);
      if (!group) {
        // Create the group if it doesn't exist
        const groupId = ruleProposal.groupId;
        this.draft.groups.push({
          id: groupId,
          name: uniqueName("AI Group", this.allNameKeys()),
          rules: [],
        });
        group = this.groupById(groupId);
      }
      if (!group) return;
      const rules = group.rules;

      // A fix proposal repairs the offending rule in place (keeping its id);
      // proposal rules without a repair target are added as new rules.
      const repair = repairs.find(
        (target) =>
          target.groupId === ruleProposal.groupId &&
          rules.some((existing) => String(existing.id) === target.ruleId),
      );
      let repairIndex = -1;
      // A repair keeps its own name when the proposal restates it, so the name
      // being repaired must not be counted as taken — otherwise every fix would
      // append " 2" to the name it was asked to keep.
      const proposedName = uniqueName(
        ruleProposal.name,
        repair === undefined
          ? this.allNameKeys()
          : this.reservedNameKeys(repair),
      );
      let ruleId =
        repair === undefined
          ? deriveEntityId(proposedName, "rule", this.allIds())
          : repair.ruleId;
      if (repair) {
        repairs.splice(repairs.indexOf(repair), 1);
        ruleId = repair.ruleId;
        repairIndex = rules.findIndex(
          (existing) => String(existing.id) === repair.ruleId,
        );
      }

      // Build the rule object
      const rule: DraftRule = {
        id: ruleId,
        name: proposedName,
        source: {
          key: ruleProposal.source.key,
          operator: "regex",
          value: ruleProposal.source.value,
        },
        resourceTypes: ruleProposal.resourceTypes
          ? [...ruleProposal.resourceTypes]
          : ["main_frame"],
        priority: ruleProposal.priority ?? 100,
      };

      if (ruleProposal.method) {
        rule.method = ruleProposal.method;
      }

      applyRuleProposalAction(rule, ruleProposal);

      // Repair the offending rule in place, or add the rule to the group
      if (repairIndex >= 0) {
        rules[repairIndex] = rule;
      } else {
        rules.push(rule);
      }

      // Mark as changed and update focus
      this.markChanged();
      lastApplied = { groupId: String(group.id), ruleId: String(rule.id) };
    }

    this.statusMessage = `Applied ${proposal.rules.length} rule${proposal.rules.length === 1 ? "" : "s"} from AI.`;
    if (lastApplied) {
      this.openRename("rule", lastApplied.groupId, lastApplied.ruleId);
      return;
    }
    this.render();
  }

  /**
   * Rules carrying validation errors, in stable path order. A fix proposal
   * repairs these rules in place (keeping their ids) instead of adding new ones.
   */
  private repairTargetsFrom(
    diagnostics: readonly EditorDiagnostic[],
  ): RuleRepairTarget[] {
    const seen = new Set<string>();
    const positions: Array<{ groupIndex: number; ruleIndex: number }> = [];
    for (const diagnostic of diagnostics) {
      const match = RULE_PATH_PATTERN.exec(diagnostic.path);
      if (!match) continue;
      const groupIndex = Number(match[1]);
      const ruleIndex = Number(match[2]);
      if (
        !Number.isSafeInteger(groupIndex) ||
        !Number.isSafeInteger(ruleIndex)
      ) {
        continue;
      }
      const key = `${groupIndex}/${ruleIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      positions.push({ groupIndex, ruleIndex });
    }
    positions.sort(
      (left, right) =>
        left.groupIndex - right.groupIndex || left.ruleIndex - right.ruleIndex,
    );
    const targets: RuleRepairTarget[] = [];
    for (const position of positions) {
      const group = this.draft.groups[position.groupIndex];
      const rule = group?.rules[position.ruleIndex];
      if (!group || !rule) continue;
      targets.push({ groupId: String(group.id), ruleId: String(rule.id) });
    }
    return targets;
  }

  private async runAIAssist(prompt: string): Promise<void> {
    const handler = this.options.aiAssist;
    const panel = this.aiAssistPanel;
    if (!handler || !panel || this.aiAssistInFlight || this.destroyed) return;

    this.aiAssistInFlight = true;
    const diagnostics = this.validateCurrent();
    const hasErrors = diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    );
    const request: AIAssistRequest = {
      kind: hasErrors ? "fix" : "generate",
      prompt,
      context: {
        project: this.getDraft(),
        activeGroupId: this.currentGroupId(),
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      },
    };
    this.aiRepairTargets =
      request.kind === "fix" && diagnostics.length > 0
        ? this.repairTargetsFrom(diagnostics)
        : [];

    panel.startStreaming("assistant");
    try {
      const result = handler(request);
      if (isAsyncIterable(result)) {
        let proposal: AIProposal | undefined;
        for await (const chunk of result) {
          if (this.destroyed) return;
          const handled = this.consumeAIAssistChunk(panel, chunk);
          if (handled === "error") return;
          if (handled.proposal) proposal = handled.proposal;
        }
        panel.finishStreaming(proposal);
        return;
      }

      const response = (await result) as AIAssistResponse;
      if (this.destroyed) return;
      panel.finishStreaming(response.proposal);
    } catch (error) {
      if (this.destroyed) return;
      panel.finishStreaming();
      panel.addMessage({
        role: "system",
        content: aiAssistErrorMessage(error),
      });
    } finally {
      this.aiAssistInFlight = false;
    }
  }

  private consumeAIAssistChunk(
    panel: NonNullable<EditorControllerImpl["aiAssistPanel"]>,
    chunk: AIAssistChunk,
  ): "error" | { proposal?: AIProposal } {
    if (chunk.type === "token") {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        panel.updateStreamingContent(chunk.content);
      }
      return {};
    }
    if (chunk.type === "error") {
      panel.finishStreaming();
      panel.addMessage({
        role: "system",
        content: chunk.error?.message ?? "AI Assist failed.",
      });
      return "error";
    }
    return { proposal: chunk.proposal };
  }

  private async dismissMigrationNotices(): Promise<void> {
    if (this.saving || this.migrationNoticesDismissed) return;
    try {
      await this.options.onDismissMigrationNotices?.();
    } catch {
      this.statusMessage = "Could not dismiss migration notices.";
      this.render();
      return;
    }
    this.migrationNoticesDismissed = true;
    this.statusMessage = "Migration notices dismissed.";
    this.render();
  }

  private convertUrl(groupId: string, ruleId: string): void {
    const rule = this.ruleById(groupId, ruleId);
    if (!rule || this.saving) return;
    const value =
      this.host.ownerDocument.defaultView?.prompt(
        "Enter a URL to convert to regex:",
      ) ?? null;
    if (value === null) return;
    const result = urlToExactRegex(value);
    const rulePath = pointer(
      "groups",
      this.groupIndex(groupId),
      "rules",
      this.ruleIndex(this.groupById(groupId) as DraftGroup, ruleId),
    );
    const path = `${rulePath}/source/value`;
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
    if (setValueAtPath(this.draft, `${rulePath}/source/key`, "url")) {
      this.markChanged();
    }
    if (setValueAtPath(this.draft, `${rulePath}/source/operator`, "regex")) {
      this.markChanged();
    }
    if (setValueAtPath(this.draft, path, result.source)) this.markChanged();
    this.statusMessage = "Exact URL regular expression created.";
    this.focusRequest = path;
    this.render();
  }

  private ruleCount(): number {
    let count = 0;
    for (const group of this.draft.groups) count += group.rules.length;
    return count;
  }

  private testLines(): { readonly url: string; readonly line: number }[] {
    const entries: { url: string; line: number }[] = [];
    const rawLines = this.testUrls.split(/\r?\n/);
    for (let index = 0; index < rawLines.length; index += 1) {
      const url = rawLines[index]?.trim() ?? "";
      if (url.length > 0) entries.push({ url, line: index + 1 });
    }
    return entries;
  }

  private showDryRunDiagnostics(
    diagnostics: readonly EditorDiagnostic[],
  ): void {
    this.testResult = undefined;
    this.testRunning = false;
    this.errors = diagnostics;
    const count = diagnostics.length;
    this.statusMessage =
      count === 0
        ? "The project could not be tested."
        : `${count} validation error${count === 1 ? "" : "s"} found.`;
    const first = diagnostics[0];
    if (first) {
      this.navigateToPath(first.path);
      return;
    }
    this.render();
  }

  private async runTest(): Promise<void> {
    if (!this.options.dryRun) {
      this.statusMessage =
        "Dry-run is not configured for this editor instance.";
      this.render();
      return;
    }
    if (this.ruleCount() === 0) {
      this.testResult = undefined;
      this.testRunning = false;
      this.statusMessage = "This project has no rules to test.";
      this.render();
      return;
    }
    const lines = this.testLines();
    if (lines.length === 0) {
      this.statusMessage = "Please enter at least one URL to test.";
      this.render();
      return;
    }
    if (lines.length > TEST_CASE_LIMIT) {
      this.testResult = undefined;
      this.testRunning = false;
      this.statusMessage = "Only 256 URLs can be checked at once.";
      this.render();
      return;
    }

    const cases: DryRunTestCase[] = lines.map((entry) => {
      const testCase: {
        url: string;
        method?: HttpMethod;
        resourceType?: ResourceType;
      } = { url: entry.url };
      if (this.testMethod !== "") testCase.method = this.testMethod;
      if (this.testResourceType !== "") {
        testCase.resourceType = this.testResourceType;
      }
      return testCase;
    });

    const requestId = ++this.testRequestId;
    this.testRunning = true;
    this.statusMessage = "Checking URLs...";
    this.render();

    try {
      const outcome = await this.options.dryRun(this.getDraft(), cases);
      if (requestId !== this.testRequestId) return;
      this.testRunning = false;
      if (isDryRunResult(outcome)) {
        this.testResult = outcome;
        const checked = outcome.summary.urlCount;
        this.statusMessage =
          outcome.errors.length > 0
            ? `Checked ${checked} URL${checked === 1 ? "" : "s"}. Some lines are not http(s) URLs.`
            : `Checked ${checked} URL${checked === 1 ? "" : "s"}.`;
        this.render();
        return;
      }
      const diagnostics = normalizeDiagnostics(
        isRecord(outcome) ? outcome.diagnostics : undefined,
      );
      this.showDryRunDiagnostics(diagnostics);
    } catch (e) {
      if (requestId !== this.testRequestId) return;
      this.testResult = undefined;
      this.testRunning = false;
      const message = e instanceof Error ? e.message : "Test failed";
      this.statusMessage = `Test error: ${message}`;
      this.render();
    }
  }

  private renderTestResults(result: DryRunResult): void {
    const resultsSection = this.host.querySelector<HTMLElement>(
      "[data-test-results]",
    );
    if (!resultsSection || !isDryRunResult(result)) return;
    resultsSection.replaceChildren();

    const heading = this.document.createElement("h3");
    heading.textContent = "Results";
    resultsSection.append(heading);

    const lines = this.testLines();
    if (result.errors.length > 0) {
      const errorsList = this.document.createElement("ul");
      errorsList.dataset.testErrors = "true";
      for (const err of result.errors) {
        const item = this.document.createElement("li");
        item.textContent = this.testErrorText(err, lines);
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
      const matches = urlResult.rules.filter((rule) => rule.matched);
      const misses = urlResult.rules.filter((rule) => !rule.matched);
      card.dataset.matched = matches.length > 0 ? "true" : "false";

      for (const rule of matches) {
        card.append(this.renderTestOutcome(urlResult.url, rule));
      }
      if (misses.length > 0) {
        card.append(this.renderTestMisses(misses));
      }
      resultsSection.append(card);
    }
  }

  private testErrorText(
    err: DryRunResult["errors"][number],
    lines: readonly { readonly url: string; readonly line: number }[],
  ): string {
    if (err.code === "dryrun.batch-limit") {
      return "Only 256 URLs can be checked at once.";
    }
    const entry = err.index === undefined ? undefined : lines[err.index];
    if (err.code === "dryrun.invalid-url" && entry) {
      return `Line ${entry.line} is not an http(s) URL: ${entry.url}`;
    }
    if (entry) {
      return `Line ${entry.line} could not be checked: ${entry.url}`;
    }
    return err.message;
  }

  private renderTestOutcome(
    url: string,
    rule: DryRunRuleMatchResult,
  ): HTMLElement {
    const names = this.testRuleNames(rule.groupId, rule.ruleId);
    const typeLabel = this.testRuleTypeLabel(rule.groupId, rule.ruleId);
    const outcome = this.document.createElement("p");
    outcome.dataset.testOutcome = "true";
    const lead = this.document.createElement("span");
    lead.textContent = names.groupKnown
      ? `${url} matches ${typeLabel} in ${names.groupName} / `
      : `${url} matches ${typeLabel} in `;
    const ruleButton = this.createCommandButton(
      names.ruleLabel,
      "test:open-rule",
      false,
      { groupId: rule.groupId, ruleId: rule.ruleId },
    );
    ruleButton.dataset.testRuleLink = "true";
    ruleButton.removeAttribute("data-btn");
    const tailParts = ["."];
    const preview = previewSentence(rule.actionPreview);
    if (preview) tailParts.push(` ${preview}`);
    if (rule.method.state === "not-applicable") {
      tailParts.push(" The method was not tested.");
    }
    if (rule.resourceType.state === "not-applicable") {
      tailParts.push(" The resource type was not tested.");
    }
    if (this.groupIsOffInBrowser(rule.groupId)) {
      tailParts.push(
        " This group is off in Chrome, so the browser will not apply this rule.",
      );
    }
    const tail = this.document.createElement("span");
    tail.textContent = tailParts.join("");
    outcome.append(lead, ruleButton, tail);
    return outcome;
  }

  private renderTestMisses(
    misses: readonly DryRunRuleMatchResult[],
  ): HTMLElement {
    const details = this.document.createElement("details");
    details.dataset.testMisses = "true";
    const summary = this.document.createElement("summary");
    summary.textContent =
      misses.length === 1
        ? "1 rule did not match"
        : `${misses.length} rules did not match`;
    const list = this.document.createElement("ul");
    for (const rule of misses) {
      const names = this.testRuleNames(rule.groupId, rule.ruleId);
      const item = this.document.createElement("li");
      const ruleButton = this.createCommandButton(
        names.ruleLabel,
        "test:open-rule",
        false,
        { groupId: rule.groupId, ruleId: rule.ruleId },
      );
      ruleButton.dataset.testRuleLink = "true";
      ruleButton.removeAttribute("data-btn");
      const reason = this.document.createElement("span");
      reason.dataset.testMissReason = "true";
      reason.textContent = missReason(rule);
      item.append(ruleButton, this.document.createTextNode(" — "), reason);
      list.append(item);
    }
    details.append(summary, list);
    return details;
  }

  /**
   * A test-result row is identified by the names the user actually sees. The dry
   * result carries ids only, and the draft the editor handed over is the source
   * of truth for both. A rule that is no longer in the draft falls back to its id.
   */
  private testRuleNames(
    groupId: string,
    ruleId: string,
  ): {
    readonly groupKnown: boolean;
    readonly ruleKnown: boolean;
    readonly groupName: string;
    readonly ruleLabel: string;
  } {
    const group = this.groupById(groupId);
    if (!group) {
      return {
        groupKnown: false,
        ruleKnown: false,
        groupName: groupId,
        ruleLabel: `${groupId}/${ruleId}`,
      };
    }
    const groupName = displayName(group.name, "Unnamed group");
    const rule = this.ruleById(groupId, ruleId);
    if (!rule) {
      return {
        groupKnown: true,
        ruleKnown: false,
        groupName,
        ruleLabel: ruleId,
      };
    }
    return {
      groupKnown: true,
      ruleKnown: true,
      groupName,
      ruleLabel: displayName(rule.name, "Unnamed rule"),
    };
  }

  private testRuleTypeLabel(groupId: string, ruleId: string): string {
    const rule = this.ruleById(groupId, ruleId);
    const type = rule && typeof rule.type === "string" ? rule.type : "";
    return RULE_TYPE_LABELS[type] ?? "the rule";
  }

  private groupIsOffInBrowser(groupId: string): boolean {
    const enablement = this.options.groupEnablement;
    if (!enablement) return false;
    const group = this.groupById(groupId);
    const saved = group ? this.savedGroupId(group) : undefined;
    const id = saved && saved.length > 0 ? saved : groupId;
    return enablement.isEnabled(id) !== true;
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
    this.closeRenameOnLeave();
    this.testRequestId += 1;
    this.statusMessage = "";
    this.render();
  }

  /**
   * An uncommitted rename belongs to the entity it was started on. Leaving that
   * entity, removing it, or discarding the draft closes the editor, so no buffer
   * survives against a heading that is no longer on screen.
   */
  private closeRenameOnLeave(): void {
    const target = this.renameTarget;
    if (!target) return;
    const onGroup =
      this.route.kind === "group" && this.route.groupId === target.groupId;
    if (!onGroup) this.renameTarget = undefined;
  }

  /** Close an open rename when the entity it belongs to goes away. */
  private closeRenameFor(entity: { groupId: string; ruleId?: string }): void {
    const target = this.renameTarget;
    if (!target) return;
    if (target.groupId === entity.groupId && target.ruleId === entity.ruleId) {
      this.renameTarget = undefined;
    }
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

  syncGroupEnablement(enabledGroupIds: readonly string[]): void {
    if (this.destroyed) return;
    const enabled = new Set<string>();
    for (const id of enabledGroupIds) {
      if (typeof id === "string") enabled.add(id);
    }
    const buttons = this.host.querySelectorAll<HTMLButtonElement>(
      "button[data-group-enable]",
    );
    for (const button of buttons) {
      const groupId = button.dataset.groupId ?? "";
      // The control carries the *committed* id, but the name must come from the
      // draft. Resolving through `groupById` would find nothing once an
      // id-repair has moved the draft's id, and the label would degrade to
      // "Unnamed group".
      const draftGroup = this.draftGroupForSavedId(groupId);
      const groupName = displayName(
        draftGroup?.name,
        this.host
          .querySelector("[data-group-heading] h2")
          ?.textContent?.trim() ?? "",
      );
      this.applyGroupEnablementLabel(button, enabled.has(groupId), groupName);
    }
  }

  /** The draft group bound to a committed id, through the index-based binding. */
  private draftGroupForSavedId(savedId: string): DraftGroup | undefined {
    if (savedId.length === 0) return undefined;
    for (const group of this.draft.groups) {
      if (this.savedGroupId(group) === savedId) return group;
    }
    return undefined;
  }

  /**
   * Scroll a rendered rule card into view and focus it. Explicit `behavior`
   * overrides the stylesheet's `scroll-behavior`, so the reduced-motion
   * preference has to be read here too.
   */
  private revealRuleCard(groupId: string, ruleId: string): void {
    const card = this.document.getElementById(ruleAnchorId(groupId, ruleId));
    if (!card) return;
    const view = this.document.defaultView;
    const reduceMotion =
      typeof view?.matchMedia === "function" &&
      view.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      block: "start",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    card.focus({ preventScroll: true });
  }

  /**
   * Deep-link to a rule: route to the group that owns it, render, then reveal
   * the rule card. Resolves against the draft, because the editor renders the
   * draft and a rule id from committed storage may have been renamed there. An
   * unknown rule still lands on its group; an unknown group falls back to
   * Overview. Never throws, so a stale link lands somewhere real rather than
   * failing.
   */
  navigateToRule(
    groupId: string | null | undefined,
    ruleId: string | null | undefined,
  ): void {
    this.navigateToGroup(groupId);
    const resolvedGroup = safeText(this.currentGroupId());
    const resolvedRule = safeText(ruleId);
    if (resolvedGroup.length === 0 || resolvedRule.length === 0) return;
    this.revealRuleCard(resolvedGroup, resolvedRule);
  }

  private navigateToSearchResult(path: string): void {
    const segments = decodePointer(path);
    if (segments?.[0] !== "groups") {
      this.route = { kind: "project" };
      this.searchQuery = "";
      this.render();
      return;
    }
    const groupIndex = arrayIndex(segments[1] ?? "");
    const group =
      groupIndex === undefined ? undefined : this.draft.groups[groupIndex];
    if (!group || typeof group.id !== "string") return;
    const ruleIndex = arrayIndex(segments[3] ?? "");
    const rule = ruleIndex === undefined ? undefined : group.rules[ruleIndex];
    this.route = { kind: "group", groupId: group.id };
    this.searchQuery = "";
    this.statusMessage = "Jumped to rule.";
    this.render();
    if (rule && typeof rule.id === "string") {
      this.revealRuleCard(group.id, rule.id);
    }
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
    if (groupIndex === undefined) return;
    const group = this.draft.groups[groupIndex];
    if (!group || typeof group.id !== "string") return;
    this.route = { kind: "group", groupId: group.id };
    // A diagnostic naming an entity rather than its `name` property still means
    // "this name needs fixing": the schema reports a missing required property at
    // the property's own path, but a host adapter is not obliged to.
    const last = segments[segments.length - 1];
    const ruleIndex = arrayIndex(segments[3] ?? "");
    const entityPath =
      last === "name"
        ? path
        : segments.length === 2
          ? pointer("groups", groupIndex, "name")
          : segments.length === 4 && ruleIndex !== undefined
            ? pointer("groups", groupIndex, "rules", ruleIndex, "name")
            : path;
    this.focusRequest = entityPath;
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
    // A render during composition removes the composing element, so
    // `compositionend` never fires and the flag would otherwise latch, silently
    // disabling re-render-on-keystroke for every field in the editor.
    this.composing = false;
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
    this.renderActionDock();
    this.decorateExtensionControls();
    this.renderSummary();
    this.renderMigrationNotices();
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
    testOption.textContent = "Test console";
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
    this.header.append(titleBlock, mobileNav);
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
    const testBtn = this.createButton("Test console", "route:test");
    testBtn.dataset.route = "test";
    testBtn.dataset.editorKey = "route:test";
    if (this.route.kind === "test")
      testBtn.setAttribute("aria-current", "page");
    this.rail.append(testBtn);

    const searchWrap = this.document.createElement("div");
    searchWrap.dataset.searchWrap = "true";
    const searchLabel = this.document.createElement("label");
    searchLabel.dataset.searchLabel = "true";
    searchLabel.textContent = "Search project";
    const search = this.document.createElement("input");
    search.type = "search";
    search.value = this.searchQuery;
    search.dataset.search = "true";
    search.dataset.editorKey = "search";
    search.setAttribute("aria-label", "Search rules by name");
    search.setAttribute(
      "aria-expanded",
      this.searchQuery.trim().length > 0 ? "true" : "false",
    );
    search.setAttribute("aria-controls", "rogatio-search-results");
    searchLabel.append(search);
    searchWrap.append(searchLabel, this.searchResults);
    this.rail.append(searchWrap);
  }

  private renderCommandBar(): void {
    this.commandBar.replaceChildren();
    this.commandBar.setAttribute("aria-busy", this.saving ? "true" : "false");
    this.commandBar.setAttribute("aria-label", "Project actions");
    const tools = this.document.createElement("div");
    tools.dataset.actionCluster = "tools";
    if (this.aiAssistPanel) {
      tools.append(
        this.createCommandButton("AI Assist", "ai-assist", this.saving),
      );
    }
    tools.append(this.createCommandButton("Validate", "validate", this.saving));
    const commit = this.document.createElement("div");
    commit.dataset.actionCluster = "commit";
    commit.append(
      this.createCommandButton("Cancel", "cancel", this.saving),
      this.createCommandButton(
        "Save",
        "save",
        this.saving || !this.isDirty(),
        {},
        "primary",
      ),
    );
    this.commandBar.append(tools, commit);
  }

  private createGroupEnableButton(
    savedGroupId: string,
    groupName: string,
  ): HTMLButtonElement {
    const enablement = this.options.groupEnablement;
    const enableButton = this.document.createElement("button");
    enableButton.type = "button";
    enableButton.dataset.groupEnable = "true";
    enableButton.dataset.groupId = savedGroupId;
    enableButton.dataset.btn = "primary";
    this.applyGroupEnablementLabel(
      enableButton,
      enablement?.isEnabled(savedGroupId) === true,
      groupName,
    );
    enableButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (enableButton.disabled || !enablement) return;
      const next = enablement.isEnabled(savedGroupId) !== true;
      const peers = Array.from(
        this.host.querySelectorAll<HTMLButtonElement>(
          "button[data-group-enable]",
        ),
      ).filter((peer) => peer.dataset.groupId === savedGroupId);
      for (const peer of peers) peer.disabled = true;
      void Promise.resolve(enablement.setEnabled(savedGroupId, next)).finally(
        () => {
          for (const peer of peers) {
            if (peer.isConnected) peer.disabled = false;
          }
        },
      );
    });
    return enableButton;
  }

  /** Enable/Disable, Copy, and Remove as one toolbar. Remove stays visually last. */
  private createGroupActionClusters(
    groupId: string,
    groupName: string,
  ): HTMLElement {
    const actions = this.document.createElement("div");
    actions.dataset.groupActions = "true";
    actions.setAttribute("role", "toolbar");
    actions.setAttribute("aria-label", `Actions for group ${groupName}`);
    const safe = this.document.createElement("div");
    safe.dataset.actionCluster = "safe";
    const group = this.groupById(groupId);
    const savedGroupId = group ? this.savedGroupId(group) : undefined;
    if (this.options.groupEnablement && savedGroupId) {
      safe.append(this.createGroupEnableButton(savedGroupId, groupName));
    }
    safe.append(
      this.createCommandButton("Copy group", "copy-group", this.saving, {
        groupId,
      }),
    );
    const danger = this.document.createElement("div");
    danger.dataset.actionCluster = "danger";
    danger.append(
      this.createCommandButton(
        "Remove group",
        "remove-group",
        this.saving,
        { groupId },
        "danger",
      ),
    );
    actions.append(safe, danger);
    return actions;
  }

  private createProjectActionRow(): HTMLElement {
    const actions = this.document.createElement("div");
    const tools = this.document.createElement("div");
    tools.dataset.actionCluster = "tools";
    if (this.aiAssistPanel) {
      tools.append(
        this.createCommandButton("AI Assist", "ai-assist", this.saving),
      );
    }
    tools.append(this.createCommandButton("Validate", "validate", this.saving));
    const commit = this.document.createElement("div");
    commit.dataset.actionCluster = "commit";
    commit.append(
      this.createCommandButton("Cancel", "cancel", this.saving),
      this.createCommandButton(
        "Save",
        "save",
        this.saving || !this.isDirty(),
        {},
        "primary",
      ),
    );
    actions.append(tools, commit);
    return actions;
  }

  private appendDockRow(
    dock: HTMLElement,
    label: string,
    actions: HTMLElement,
  ): void {
    const row = this.document.createElement("div");
    row.dataset.dockRow = "true";
    const labelEl = this.document.createElement("span");
    labelEl.dataset.dockLabel = "true";
    labelEl.textContent = label;
    actions.dataset.dockActions = "true";
    row.append(labelEl, actions);
    dock.append(row);
  }

  /**
   * Repeats the actions a long page would otherwise hide: under the last rule
   * on a group page, or under the test results. The project page stays short,
   * so Add group lives on the Groups heading and that route has no ledger.
   */
  private renderActionDock(): void {
    if (this.route.kind === "project") return;
    const dock = this.document.createElement("section");
    dock.dataset.actionDock = "end";
    dock.setAttribute("aria-label", "Repeated actions");
    if (this.route.kind === "group") {
      const groupId = this.route.groupId;
      const group = this.groupById(groupId);
      if (group) {
        const groupName = displayName(group.name, "Unnamed group");
        const addRule = this.document.createElement("div");
        addRule.dataset.actionCluster = "safe";
        addRule.append(
          this.createCommandButton(
            "Add rule",
            "add-rule",
            this.saving,
            { groupId },
            "primary",
          ),
        );
        this.appendDockRow(dock, "Rules", addRule);
        this.appendDockRow(
          dock,
          "Group",
          this.createGroupActionClusters(groupId, groupName),
        );
      }
    }
    this.appendDockRow(dock, "Project", this.createProjectActionRow());
    this.form.append(dock);
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
    groups.dataset.groupListSection = "true";
    const groupsHeadingRow = this.document.createElement("div");
    groupsHeadingRow.dataset.sectionHeading = "true";
    const groupsHeading = this.document.createElement("h2");
    groupsHeading.textContent = "Groups";
    groupsHeadingRow.append(
      groupsHeading,
      this.createCommandButton(
        "Add group",
        "add-group",
        this.saving,
        {},
        "primary",
      ),
    );
    groups.append(groupsHeadingRow);
    if (this.draft.groups.length === 0) {
      const empty = this.document.createElement("p");
      empty.textContent = "No groups yet.";
      groups.append(empty);
    } else {
      const list = this.document.createElement("ul");
      list.dataset.groupList = "true";
      for (const group of this.draft.groups) {
        const groupId = safeText(group.id);
        const groupName = displayName(group.name, "Unnamed group");
        const item = this.document.createElement("li");
        item.dataset.groupRow = "true";
        const open = this.createButton(groupName, `route:group:${groupId}`);
        open.dataset.route = "group";
        open.dataset.groupId = groupId;
        open.dataset.btn = "secondary";
        open.setAttribute("aria-label", `Open group ${groupName}`);
        const actions = this.document.createElement("div");
        actions.dataset.groupRowActions = "true";
        const copy = this.createCommandButton(
          "Copy group",
          "copy-group",
          this.saving,
          { groupId },
        );
        copy.setAttribute("aria-label", `Copy group ${groupName}`);
        const remove = this.createCommandButton(
          "Remove group",
          "remove-group",
          this.saving,
          { groupId },
          "danger",
        );
        remove.setAttribute("aria-label", `Remove group ${groupName}`);
        actions.append(copy, remove);
        item.append(open, actions);
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
    const groupName = displayName(group.name, "Unnamed group");
    const headingRow = this.document.createElement("div");
    headingRow.dataset.groupHeading = "true";
    const identity = this.document.createElement("div");
    identity.dataset.groupIdentity = "true";
    const heading = this.document.createElement("h2");
    this.renderNameHeading({
      row: identity,
      heading,
      headingId: `${this.instanceId}-group-title-${groupIndex}`,
      kind: "group",
      groupId,
      namePath: pointer("groups", groupIndex, "name"),
      name: group.name,
      fallback: "Unnamed group",
      commands: [],
    });
    headingRow.append(
      identity,
      this.createGroupActionClusters(groupId, groupName),
    );
    this.form.append(headingRow);

    const rulesSection = this.document.createElement("section");
    rulesSection.dataset.rulesSection = "true";
    const rulesHeadingRow = this.document.createElement("div");
    rulesHeadingRow.dataset.sectionHeading = "true";
    const rulesHeading = this.document.createElement("h2");
    rulesHeading.textContent = "Rules";
    const addRule = this.createCommandButton(
      "Add rule",
      "add-rule",
      this.saving,
      { groupId },
      "primary",
    );
    rulesHeadingRow.append(rulesHeading, addRule);
    rulesSection.append(rulesHeadingRow);
    const list = this.document.createElement("div");
    list.dataset.ruleList = groupId;
    for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
      list.append(
        this.renderRule(group, group.rules[ruleIndex], groupIndex, ruleIndex),
      );
    }
    if (group.rules.length === 0) {
      const empty = this.document.createElement("p");
      empty.dataset.emptyRules = "true";
      empty.textContent =
        "No rules yet. Add a rule to start matching requests.";
      list.append(empty);
    }
    rulesSection.append(list);
    this.form.append(rulesSection);
  }

  private renderTest(): void {
    const heading = this.document.createElement("h2");
    heading.textContent = "Test console";
    this.form.append(heading);

    const description = this.document.createElement("p");
    description.dataset.testDescription = "true";
    description.textContent =
      "Check whether these URLs match your rules. Nothing is contacted, and nothing is saved.";
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
    urlsTextarea.dataset.editorKey = "test-urls";
    urlsLabel.append(urlsTextarea);
    urlsField.append(urlsLabel);
    urlsFieldset.append(urlsField);
    const samples = this.renderSampleUrlButtons();
    if (samples) urlsFieldset.append(samples);
    panel.append(urlsFieldset);

    const checking = this.document.createElement("p");
    checking.dataset.testChecking = "true";
    checking.textContent = checkingCopy(this.testMethod, this.testResourceType);
    panel.append(checking);

    const defaultsGrid = this.document.createElement("div");
    defaultsGrid.dataset.testDefaults = "true";

    const methodField = this.document.createElement("div");
    methodField.dataset.editorField = "true";
    const methodLabel = this.document.createElement("label");
    methodLabel.textContent = "Method";
    const methodSelect = this.document.createElement("select");
    methodSelect.dataset.testMethod = "true";
    methodSelect.dataset.editorKey = "test-method";
    for (const method of HTTP_METHODS) {
      const option = this.document.createElement("option");
      option.value = method;
      option.textContent = method;
      methodSelect.append(option);
    }
    const methodAny = this.document.createElement("option");
    methodAny.value = "";
    methodAny.textContent = "Any method";
    methodSelect.append(methodAny);
    methodSelect.value = this.testMethod;
    methodLabel.append(methodSelect);
    methodField.append(methodLabel);

    const rtField = this.document.createElement("div");
    rtField.dataset.editorField = "true";
    const rtLabel = this.document.createElement("label");
    rtLabel.textContent = "Resource type";
    const rtSelect = this.document.createElement("select");
    rtSelect.dataset.testResourceType = "true";
    rtSelect.dataset.editorKey = "test-resource-type";
    for (const resourceType of RESOURCE_TYPES) {
      const option = this.document.createElement("option");
      option.value = resourceType;
      option.textContent = RESOURCE_TYPE_LABELS[resourceType];
      rtSelect.append(option);
    }
    const rtAny = this.document.createElement("option");
    rtAny.value = "";
    rtAny.textContent = "Any resource type";
    rtSelect.append(rtAny);
    rtSelect.value = this.testResourceType;
    rtLabel.append(rtSelect);
    rtField.append(rtLabel);

    defaultsGrid.append(methodField, rtField);
    panel.append(defaultsGrid);

    const runBtn = this.createCommandButton(
      "Run test",
      "test:run",
      this.saving || this.testRunning,
      {},
      "primary",
    );
    runBtn.dataset.testRun = "true";
    panel.append(runBtn);

    this.form.append(panel);

    const resultsSection = this.document.createElement("section");
    resultsSection.dataset.testResults = "true";
    this.form.append(resultsSection);
    if (this.ruleCount() === 0) {
      const empty = this.document.createElement("p");
      empty.dataset.testEmpty = "true";
      empty.textContent = "This project has no rules to test.";
      resultsSection.append(empty);
    } else if (this.testResult) {
      this.renderTestResults(this.testResult);
    } else if (this.testRunning) {
      const pending = this.document.createElement("p");
      pending.dataset.testPending = "true";
      pending.textContent = "Checking URLs...";
      resultsSection.append(pending);
    } else if (this.statusMessage === "Only 256 URLs can be checked at once.") {
      const limit = this.document.createElement("p");
      limit.dataset.testLimit = "true";
      limit.textContent = this.statusMessage;
      resultsSection.append(limit);
    }
  }

  private renderSampleUrlButtons(): HTMLElement | undefined {
    const samples: {
      groupId: string;
      ruleId: string;
      url: string;
      name: string;
    }[] = [];
    for (const group of this.draft.groups) {
      const groupId = safeText(group.id);
      for (const rule of group.rules) {
        const url = exactUrlFromSource(rule.source);
        if (!url) continue;
        samples.push({
          groupId,
          ruleId: safeText(rule.id),
          url,
          name: displayName(rule.name, "Unnamed rule"),
        });
      }
    }
    if (samples.length === 0) return undefined;
    const row = this.document.createElement("div");
    row.dataset.testSamples = "true";
    for (const sample of samples) {
      const button = this.createCommandButton(
        "Try a URL from this rule",
        "test:try-url",
        false,
        { groupId: sample.groupId, ruleId: sample.ruleId, url: sample.url },
      );
      if (samples.length > 1) {
        button.setAttribute(
          "aria-label",
          `Try a URL from this rule, ${sample.name}`,
        );
      }
      row.append(button);
    }
    return row;
  }

  private renderRule(
    group: DraftGroup,
    rule: DraftRule,
    groupIndex: number,
    ruleIndex: number,
  ): HTMLElement {
    const groupId = safeText(group.id);
    const ruleId = safeText(rule.id);
    const rulePath = pointer("groups", groupIndex, "rules", ruleIndex);
    const card = this.document.createElement("article");
    card.dataset.ruleCard = "true";
    card.dataset.ruleId = ruleId;
    card.id = ruleAnchorId(groupId, ruleId);
    card.tabIndex = -1;
    const headingRow = this.document.createElement("div");
    headingRow.dataset.ruleHeading = "true";
    const identity = this.document.createElement("div");
    identity.dataset.ruleIdentity = "true";
    const heading = this.document.createElement("h3");
    const headingId = `${this.instanceId}-rule-title-${groupIndex}-${ruleIndex}`;
    card.setAttribute("aria-labelledby", headingId);
    const actions = this.document.createElement("div");
    actions.dataset.ruleActions = "true";
    actions.append(
      this.createCommandButton(
        "Move rule up",
        "move-rule-up",
        this.saving || ruleIndex <= 0,
        { groupId, ruleId },
      ),
      this.createCommandButton(
        "Move rule down",
        "move-rule-down",
        this.saving || ruleIndex >= group.rules.length - 1,
        { groupId, ruleId },
      ),
      this.createCommandButton("Copy rule", "copy-rule", this.saving, {
        groupId,
        ruleId,
      }),
      this.createCommandButton(
        "Remove rule",
        "remove-rule",
        this.saving,
        { groupId, ruleId },
        "danger",
      ),
    );
    this.renderNameHeading({
      row: identity,
      heading,
      headingId,
      kind: "rule",
      groupId,
      ruleId,
      namePath: `${rulePath}/name`,
      name: rule.name,
      fallback: "Unnamed rule",
      commands: [],
    });
    headingRow.append(identity, actions);
    card.append(headingRow);

    this.renderSource(card, rule, rulePath, groupId, ruleId);
    this.renderResourceTypes(card, rule, rulePath);
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
    this.renderField(matcherGrid, "Priority", `${rulePath}/priority`, priority);
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
    this.renderField(matcherGrid, "Method", `${rulePath}/method`, method);
    matcherFields.append(matcherGrid);
    card.append(matcherFields);

    const redactFieldset = this.document.createElement("fieldset");
    const redactLegend = this.document.createElement("legend");
    redactLegend.textContent = "Match logging";
    redactFieldset.append(redactLegend);
    const redactGrid = this.document.createElement("div");
    redactGrid.dataset.editorFields = "true";
    const redactCheckbox = this.document.createElement("input");
    redactCheckbox.type = "checkbox";
    redactCheckbox.checked = rule.redactSensitiveInLogs === true;
    this.renderField(
      redactGrid,
      "Redact sensitive fields in logs",
      `${rulePath}/redactSensitiveInLogs`,
      redactCheckbox,
    );
    redactFieldset.append(redactGrid);
    card.append(redactFieldset);

    if (this.extensions.length > 0) {
      const currentType =
        this.extensions.find((e) =>
          e.matches(rule as Readonly<Record<string, unknown>>),
        )?.id ?? safeText(rule.type);
      const typeFieldset = this.document.createElement("fieldset");
      const typeLegend = this.document.createElement("legend");
      typeLegend.textContent = "Rule type";
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

    return card;
  }

  private renderSource(
    parent: HTMLElement,
    rule: DraftRule,
    rulePath: string,
    groupId: string,
    ruleId: string,
  ): void {
    const sourceFieldset = this.document.createElement("fieldset");
    const sourceLegend = this.document.createElement("legend");
    sourceLegend.textContent = "Source condition";
    sourceFieldset.append(sourceLegend);
    const sourceGrid = this.document.createElement("div");
    sourceGrid.dataset.editorFields = "true";

    const sourceKey = rule.source?.key === "host" ? "host" : "url";
    const keySelect = this.document.createElement("select");
    for (const value of ["url", "host"] as const) {
      const option = this.document.createElement("option");
      option.value = value;
      option.textContent =
        value === "url" ? "URL (full request URL)" : "Host (hostname only)";
      keySelect.append(option);
    }
    keySelect.value = sourceKey;
    this.renderField(
      sourceGrid,
      "Match key",
      `${rulePath}/source/key`,
      keySelect,
    );

    const operator = this.document.createElement("input");
    operator.type = "text";
    operator.value = "regex";
    operator.readOnly = true;
    operator.disabled = true;
    this.renderField(
      sourceGrid,
      "Operator",
      `${rulePath}/source/operator`,
      operator,
    );

    const regex = this.document.createElement("textarea");
    regex.maxLength = F2_MAX_URL_REGEX_LENGTH;
    regex.value = safeText(rule.source?.value);
    this.renderField(
      sourceGrid,
      "Regular expression",
      `${rulePath}/source/value`,
      regex,
    );

    sourceFieldset.append(sourceGrid);
    sourceFieldset.append(
      this.createCommandButton(
        "Convert URL to regex",
        "convert-url",
        this.saving,
        { groupId, ruleId },
        "secondary",
      ),
    );
    parent.append(sourceFieldset);
  }

  private renderMigrationNotices(): void {
    const existing = this.host.querySelector("[data-migration-notices]");
    existing?.remove();
    if (
      this.migrationNoticesDismissed ||
      !this.options.migrationNotices ||
      this.options.migrationNotices.length === 0
    ) {
      return;
    }
    const banner = this.document.createElement("section");
    banner.dataset.migrationNotices = "true";
    banner.setAttribute("role", "status");
    const heading = this.document.createElement("h2");
    heading.textContent = "Migration notices";
    const list = this.document.createElement("ul");
    for (const notice of this.options.migrationNotices) {
      const item = this.document.createElement("li");
      item.textContent = notice.message;
      list.append(item);
    }
    banner.append(
      heading,
      list,
      this.createCommandButton(
        "Dismiss notices",
        "dismiss-migration-notices",
        this.saving,
        {},
        "secondary",
      ),
    );
    this.main.prepend(banner);
  }

  private renderResourceTypes(
    parent: HTMLElement,
    rule: DraftRule,
    rulePath: string,
  ): void {
    const fieldset = this.document.createElement("fieldset");
    const legend = this.document.createElement("legend");
    legend.textContent = "Resource types";
    fieldset.append(legend);
    const hint = this.document.createElement("p");
    hint.dataset.editorHint = "true";
    hint.textContent = "Chrome request categories this rule can match.";
    fieldset.append(hint);
    const groups = this.document.createElement("div");
    groups.dataset.editorCheckGroups = "true";
    for (const group of RESOURCE_TYPE_GROUPS) {
      const groupEl = this.document.createElement("div");
      groupEl.dataset.editorCheckGroup = "true";
      groupEl.setAttribute("role", "group");
      const groupLabel = this.document.createElement("p");
      groupLabel.dataset.editorCheckGroupLabel = "true";
      groupLabel.id = `${this.instanceId}-resource-type-group-${group.label.toLowerCase()}-${safeText(rule.id)}`;
      groupLabel.textContent = group.label;
      groupEl.setAttribute("aria-labelledby", groupLabel.id);
      groupEl.append(groupLabel);
      const checks = this.document.createElement("div");
      checks.dataset.editorChecks = "true";
      for (const resourceType of group.types) {
        const gloss = RESOURCE_TYPE_GLOSS[resourceType];
        const label = this.document.createElement("label");
        label.title = gloss;
        const input = this.document.createElement("input");
        input.type = "checkbox";
        input.dataset.resourcePath = `${rulePath}/resourceTypes`;
        input.dataset.resourceType = resourceType;
        input.checked = rule.resourceTypes.includes(resourceType);
        input.disabled = this.saving;
        input.title = gloss;
        const text = this.document.createElement("span");
        text.dataset.editorCheckText = "true";
        const idSpan = this.document.createElement("span");
        idSpan.dataset.editorCheckId = "true";
        idSpan.textContent = resourceType;
        const glossEl = this.document.createElement("small");
        glossEl.textContent = gloss;
        text.append(idSpan, glossEl);
        label.append(input, text);
        checks.append(label);
      }
      groupEl.append(checks);
      groups.append(groupEl);
    }
    fieldset.append(groups);
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

  /**
   * Attach a control's diagnostics the same way `renderField` does, for a control
   * that is not wrapped in a labelled field — the inline name editor.
   */
  private decorateWithErrors(control: HTMLElement, path: string): void {
    const errors = this.errors.filter((value) => value.path === path);
    if (errors.length === 0) {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
      return;
    }
    control.setAttribute("aria-invalid", "true");
    const error = this.document.createElement("div");
    error.id = `${control.id}-error`;
    error.dataset.editorFieldError = "true";
    error.textContent = errors.map((value) => value.message).join(" ");
    control.setAttribute("aria-describedby", error.id);
    control.insertAdjacentElement("afterend", error);
  }

  /**
   * Render a group or rule heading together with its inline rename control.
   *
   * The heading element is always present, even while the inline editor is open,
   * because a rule card names itself through `aria-labelledby` and an `<input>`
   * has no text content to name it with. While editing, the heading is moved
   * into the visually-hidden state rather than removed, so the card keeps its
   * accessible name and the shared action buttons keep their per-entity context.
   */
  private renderNameHeading(options: {
    readonly row: HTMLElement;
    readonly heading: HTMLHeadingElement;
    readonly headingId: string;
    readonly kind: "group" | "rule";
    readonly groupId: string;
    readonly ruleId?: string;
    readonly namePath: string;
    readonly name: unknown;
    readonly fallback: string;
    readonly commands: ReadonlyArray<HTMLElement>;
  }): void {
    const { row, heading, headingId, kind, namePath } = options;
    const entityName = displayName(options.name, options.fallback);
    const target = this.renameTargetFor(options);
    const editing = target !== undefined;
    const label = kind === "group" ? "group" : "rule";
    const entityLabel = `${label} ${entityName}`;

    heading.id = headingId;
    heading.textContent = entityName;
    if (editing) {
      heading.dataset.editorVisuallyHidden = "true";
    }
    row.append(heading);

    if (editing && target) {
      const wrap = this.document.createElement("div");
      wrap.dataset.renameControls = "true";
      const input = this.document.createElement("input");
      input.type = "text";
      input.maxLength = LIMITS.maxLabelLength;
      input.value = target.value;
      input.id = this.controlId(namePath);
      // Deliberately no `data-path`: the draft is not written on keystroke, so
      // this input is not wired into the live-apply input handler.
      input.dataset.renameInput = "true";
      input.dataset.editorKey = namePath;
      input.disabled = this.saving;
      input.setAttribute(
        "aria-label",
        // Named for the action and the entity. The removed field labels must
        // not reappear as an accessible name.
        `Rename ${entityLabel}`,
      );
      const save = this.createCommandButton(
        "Save name",
        "commit-rename",
        this.saving,
        { renameKind: kind, groupId: options.groupId, ruleId: options.ruleId },
        "primary",
      );
      save.setAttribute("aria-label", `Save ${entityLabel} name`);
      save.textContent = "✓";
      save.dataset.icon = "true";
      const cancel = this.createCommandButton(
        "Cancel rename",
        "cancel-rename",
        this.saving,
        { renameKind: kind, groupId: options.groupId, ruleId: options.ruleId },
      );
      cancel.setAttribute("aria-label", `Cancel renaming ${entityLabel}`);
      cancel.textContent = "×";
      cancel.dataset.icon = "true";
      wrap.append(input, save, cancel);
      row.append(wrap);
      // After the input is in the document: the error element is inserted as its
      // sibling, which requires a parent.
      this.decorateWithErrors(input, namePath);
      // Registered under the entity's `/name` path so a pending focus request
      // for that path resolves here, and so a diagnostic at that path decorates
      // this control.
      this.controls.set(namePath, input);
    } else {
      const pencil = this.createCommandButton(
        `Rename ${label}`,
        "rename-entity",
        this.saving,
        { renameKind: kind, groupId: options.groupId, ruleId: options.ruleId },
      );
      pencil.setAttribute("aria-label", `Rename ${entityLabel}`);
      pencil.title = `Rename ${entityLabel}`;
      pencil.textContent = "✎";
      pencil.dataset.icon = "true";
      row.append(pencil);
    }

    for (const command of options.commands) row.append(command);
  }

  /**
   * The rename target for an entity, when it should be open.
   *
   * It is open when the entity is already being renamed, or when a focus request
   * names its `/name` path. The second case is what makes add, copy, move, AI
   * apply, and a name diagnostic all land in the inline editor with one
   * mechanism.
   */
  private renameTargetFor(options: {
    readonly kind: "group" | "rule";
    readonly groupId: string;
    readonly ruleId?: string;
    readonly namePath: string;
  }): RenameTarget | undefined {
    const open = this.renameTarget;
    if (
      open &&
      open.groupId === options.groupId &&
      open.ruleId === options.ruleId
    ) {
      open.namePath = options.namePath;
      return open;
    }
    // Only the heading the focus request actually names may open an editor, and
    // this runs for every heading on the page — so a heading that is not the
    // target must have no side effects at all.
    if (this.focusRequest !== options.namePath) return undefined;
    if (open && !this.renamingInProgress) {
      // The request names a *different* entity than the one being renamed, so it
      // must not silently drop an uncommitted buffer. The open rename is
      // committed instead; if that commit is refused, the new one does not open
      // and the user resolves it first. Guarded against re-entry because a
      // commit renders, and rendering asks this question again.
      this.renamingInProgress = true;
      try {
        this.commitRename();
      } finally {
        this.renamingInProgress = false;
      }
      if (this.renameTarget) return undefined;
    }
    const value = this.currentName(options.groupId, options.ruleId);
    if (value === undefined) return undefined;
    const target: RenameTarget = {
      kind: options.kind,
      groupId: options.groupId,
      ruleId: options.ruleId,
      namePath: options.namePath,
      value,
    };
    this.renameTarget = target;
    return target;
  }

  private currentName(groupId: string, ruleId?: string): string | undefined {
    const group = this.groupById(groupId);
    if (!group) return undefined;
    if (ruleId === undefined) return safeText(group.name);
    const rule = this.ruleById(groupId, ruleId);
    return rule ? safeText(rule.name) : undefined;
  }

  /**
   * Every group and rule name in the project, except the entity being renamed.
   * Compared through the shared normalized key, so a rename is refused for a name
   * that differs only by case or internal spacing.
   */
  private reservedNameKeys(exclude: {
    groupId: string;
    ruleId?: string;
  }): Set<string> {
    const reserved = new Set<string>();
    for (const group of this.draft.groups) {
      const isTargetGroup = group.id === exclude.groupId;
      // A group rename leaves the group's own name out, but the group's rules
      // still hold names the new name must not collide with.
      if (!isTargetGroup && typeof group.name === "string") {
        reserved.add(normalizeNameKey(group.name));
      }
      for (const rule of group.rules) {
        if (isTargetGroup && rule.id === exclude.ruleId) continue;
        if (typeof rule.name === "string") {
          reserved.add(normalizeNameKey(rule.name));
        }
      }
    }
    return reserved;
  }

  /**
   * A human description of whichever entity already holds a normalized name, so
   * a refused rename can name the conflict instead of only reporting that one
   * exists.
   */
  private nameHolderFor(
    key: string,
    exclude: { groupId: string; ruleId?: string },
  ): string | undefined {
    for (const group of this.draft.groups) {
      if (
        typeof group.name === "string" &&
        normalizeNameKey(group.name) === key
      ) {
        if (group.id === exclude.groupId && exclude.ruleId === undefined)
          continue;
        return `group “${displayName(group.name, "Unnamed group")}”`;
      }
      for (const rule of group.rules) {
        if (typeof rule.name !== "string") continue;
        if (normalizeNameKey(rule.name) !== key) continue;
        if (group.id === exclude.groupId && rule.id === exclude.ruleId)
          continue;
        return `rule “${displayName(rule.name, "Unnamed rule")}”`;
      }
    }
    return undefined;
  }

  private openRename(
    kind: "group" | "rule",
    groupId: string,
    ruleId?: string,
  ): void {
    if (this.saving) return;
    const groupIndex = this.groupIndex(groupId);
    if (groupIndex === -1) return;
    const group = this.draft.groups[groupIndex];
    if (!group) return;
    const namePath =
      ruleId === undefined
        ? pointer("groups", groupIndex, "name")
        : pointer(
            "groups",
            groupIndex,
            "rules",
            this.ruleIndex(group, ruleId),
            "name",
          );
    const value = this.currentName(groupId, ruleId);
    if (value === undefined) return;
    // Editing a name implies showing that entity, so a newly added or copied one
    // becomes the open group rather than staying off-screen.
    this.route = { kind: "group", groupId };
    this.renameTarget = { kind, groupId, ruleId, namePath, value };
    this.composing = false;
    this.focusRequest = namePath;
    this.render();
  }

  private cancelRename(): void {
    const target = this.renameTarget;
    if (!target) return;
    this.renameTarget = undefined;
    this.statusMessage = "Name change discarded.";
    this.render();
    this.focusRenameControl(target.groupId, target.ruleId);
  }

  private focusRenameControl(groupId: string, ruleId?: string): void {
    for (const button of this.host.querySelectorAll<HTMLElement>(
      '[data-command="rename-entity"]',
    )) {
      if (button.dataset.groupId !== groupId) continue;
      if ((button.dataset.ruleId ?? undefined) !== ruleId) continue;
      button.focus();
      return;
    }
  }

  /** Refuse a commit, keep the editor open, and say why. */
  private rejectRename(target: RenameTarget, message: string): void {
    this.statusMessage = message;
    // The draft is untouched, so the editor stays open with the typed text and
    // focus returns to the input.
    this.focusRequest = target.namePath;
    this.render();
  }

  /**
   * Write a name onto the entity the rename targets, resolved by identity.
   *
   * `setValueAtPath` refuses to create a property that is not already there,
   * because its allowlist exists to stop a field input inventing arbitrary keys.
   * A `name` is different: a hand-authored project can legitimately arrive with
   * the property *absent*, and the diagnostic that reports it is exactly the one
   * the inline editor exists to repair. So the name is written here, onto a
   * record resolved by id, which also means a stale index cannot land the value
   * on a different entity.
   */
  private writeEntityName(
    groupId: string,
    ruleId: string | undefined,
    value: string,
  ): boolean {
    const group = this.groupById(groupId);
    if (!group) return false;
    const rule =
      ruleId === undefined ? undefined : this.ruleById(groupId, ruleId);
    if (ruleId !== undefined && !rule) return false;
    const target = rule ?? group;
    if (target === undefined) return false;
    if (target.name === value) return false;
    Object.defineProperty(target, "name", {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    return true;
  }

  private commitRename(): void {
    const target = this.renameTarget;
    if (!target || this.saving) return;
    const trimmed = target.value.trim();
    if (trimmed.length === 0) {
      this.rejectRename(target, "A name cannot be empty.");
      return;
    }
    if (trimmed.length > LIMITS.maxLabelLength) {
      this.rejectRename(
        target,
        `A name cannot be longer than ${LIMITS.maxLabelLength} characters.`,
      );
      return;
    }
    const key = normalizeNameKey(trimmed);
    if (this.reservedNameKeys(target).has(key)) {
      const holder = this.nameHolderFor(key, target);
      this.rejectRename(
        target,
        holder
          ? `The ${holder} already uses that name. Pick a different name.`
          : "That name is already used in this project.",
      );
      return;
    }
    // Re-resolve by identity: the entity may have been removed or reordered
    // while the buffer was open, and a stale path would write to the wrong one.
    const changed = this.writeEntityName(
      target.groupId,
      target.ruleId,
      trimmed,
    );
    this.renameTarget = undefined;
    if (!changed) {
      this.statusMessage = "Name unchanged.";
      this.render();
      return;
    }
    // Order matters: `markChanged` clears the status message, so the result is
    // announced only after the draft has actually changed.
    this.markChanged();
    this.statusMessage = "Name updated.";
    this.render();
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
      // An id is never authored, so a diagnostic on one is repaired by the
      // program rather than by the user. Without this, a project with a duplicate
      // or malformed id would open, block Save, and offer no way forward.
      const repair = this.idRepairFor(error.path);
      if (repair) {
        const fix = this.createCommandButton(
          "Assign a new ID",
          "repair-id",
          this.saving,
          { repairPath: error.path },
          "secondary",
        );
        fix.setAttribute("aria-label", repair.label);
        item.append(fix);
      }
      list.append(item);
    }
    this.summary.append(heading, list);
  }

  /** A label for the entity an id diagnostic names, when it names one. */
  private idRepairFor(path: string): { label: string } | undefined {
    const segments = decodePointer(path);
    if (segments?.[0] !== "groups" || segments[segments.length - 1] !== "id") {
      return undefined;
    }
    const entity = this.entityAtIdPath(segments);
    if (!entity) return undefined;
    return { label: entity.label };
  }

  /**
   * Resolve the entity an id path names.
   *
   * By index, not by id: the whole point of this path is that the id is wrong,
   * and two entities can share it, so an id lookup would be ambiguous and could
   * repair the wrong one.
   */
  private entityAtIdPath(
    segments: readonly string[] | undefined,
  ): { group: DraftGroup; rule?: DraftRule; label: string } | undefined {
    if (!segments) return undefined;
    const groupIndex = arrayIndex(segments[1] ?? "");
    if (groupIndex === undefined) return undefined;
    const group = this.draft.groups[groupIndex];
    if (!group) return undefined;
    if (segments.length === 3) {
      return {
        group,
        label: `Assign a new ID to group ${displayName(group.name, "Unnamed group")}`,
      };
    }
    if (segments.length === 5) {
      const ruleIndex = arrayIndex(segments[3] ?? "");
      if (ruleIndex === undefined) return undefined;
      const rule = group.rules[ruleIndex];
      if (!rule) return undefined;
      return {
        group,
        rule,
        label: `Assign a new ID to rule ${displayName(rule.name, "Unnamed rule")}`,
      };
    }
    return undefined;
  }

  private repairEntityId(path: string): void {
    if (this.saving) return;
    const entity = this.entityAtIdPath(decodePointer(path));
    if (!entity) return;
    const { group, rule } = entity;
    // The route addresses a group by id. A repair changes a draft id, so the open
    // group is tracked by index across the change and re-pointed afterwards,
    // rather than left pointing at an id that no longer exists.
    const openIndex =
      this.route.kind === "group" ? this.groupIndex(this.route.groupId) : -1;
    const repairedIndex = this.draft.groups.indexOf(group);
    const name = rule === undefined ? group.name : rule.name;
    // The replacement is derived from the entity's own name, so a repaired id is
    // the one the program would have minted.
    const next = deriveEntityId(
      name,
      rule === undefined ? "group" : "rule",
      this.allIds(),
    );
    if (!setValueAtPath(this.draft, path, next)) {
      this.statusMessage = "ID unchanged.";
      this.render();
      return;
    }
    this.markChanged();
    this.statusMessage = `Assigned the ID ${next}.`;
    if (openIndex === repairedIndex) {
      this.route = { kind: "group", groupId: String(group.id) };
    }
    // Re-validate so the summary reflects the repair instead of being cleared
    // without a verdict.
    this.validate();
  }

  private renderSearchResults(): void {
    const root = this.searchResults;
    root.replaceChildren();
    root.hidden = this.searchQuery.trim().length === 0;
    if (this.searchQuery.trim().length === 0) return;
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", "Rule search results");
    const results = this.searchResultsFor(this.searchQuery);
    const count = this.document.createElement("p");
    count.dataset.searchCount = "true";
    count.textContent = `${results.length} rule${
      results.length === 1 ? "" : "s"
    } matching “${this.searchQuery.trim()}”.`;
    const list = this.document.createElement("ul");
    for (const result of results) {
      const item = this.document.createElement("li");
      item.setAttribute("role", "option");
      const button = this.document.createElement("button");
      button.type = "button";
      button.dataset.searchResult = result.path;
      button.textContent = result.label;
      item.append(button);
      list.append(item);
    }
    root.append(count, list);
    if (results.length === 0) {
      const empty = this.document.createElement("p");
      empty.textContent = "No rules match that name.";
      root.append(empty);
    }
  }

  private searchResultsFor(
    query: string,
  ): Array<{ path: string; label: string }> {
    const needle = toSearchText(query);
    if (!needle) return [];
    const results: Array<{ path: string; label: string }> = [];
    for (
      let groupIndex = 0;
      groupIndex < this.draft.groups.length;
      groupIndex += 1
    ) {
      const group = this.draft.groups[groupIndex];
      for (let ruleIndex = 0; ruleIndex < group.rules.length; ruleIndex += 1) {
        const rule = group.rules[ruleIndex];
        if (!toSearchText(rule.name).includes(needle)) continue;
        results.push({
          path: pointer("groups", groupIndex, "rules", ruleIndex),
          label: `Rule: ${displayName(rule.name, "Unnamed rule")} · ${displayName(group.name, "Unnamed group")}`,
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
    cancel.dataset.btn = "secondary";
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
      confirm.dataset.btn = "danger";
    } else if (this.confirmation.kind === "remove-group") {
      title.textContent = "Remove group?";
      message.textContent = `Remove group ${this.confirmation.name} and its rules?`;
      confirm.textContent = "Remove group";
      confirm.dataset.btn = "danger";
    } else {
      title.textContent = "Remove rule?";
      message.textContent = `Remove rule ${this.confirmation.name}?`;
      confirm.textContent = "Remove rule";
      confirm.dataset.btn = "danger";
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

  private applyGroupEnablementLabel(
    button: HTMLButtonElement,
    enabled: boolean,
    groupName: string,
  ): void {
    const action = enabled ? "Disable" : "Enable";
    button.textContent = action;
    button.setAttribute("aria-label", `${action} group ${groupName}`);
  }

  private bindSavedGroupIds(): void {
    for (let index = 0; index < this.draft.groups.length; index += 1) {
      const draftGroup = this.draft.groups[index];
      const savedGroup = this.committed.groups[index];
      const savedId = savedGroup?.id;
      if (!draftGroup || typeof savedId !== "string" || savedId.length === 0) {
        continue;
      }
      this.savedGroupIds.set(draftGroup, savedId);
    }
  }

  private savedGroupId(group: DraftGroup): string | undefined {
    const savedId = this.savedGroupIds.get(group);
    return typeof savedId === "string" && savedId.length > 0
      ? savedId
      : undefined;
  }

  private createCommandButton(
    label: string,
    command: string,
    disabled: boolean,
    data: Record<string, string | undefined> = {},
    tone: "primary" | "secondary" | "danger" = "secondary",
  ): HTMLButtonElement {
    const button = this.createButton(
      label,
      `command:${command}:${Object.values(data).join(":")}`,
    );
    button.dataset.command = command;
    button.dataset.btn = tone;
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

/**
 * Percent-encode one anchor segment. `encodeURIComponent` leaves `!'()*`
 * unescaped and those are CSS-significant, so they are escaped too: the anchor
 * id is a public contract that a host may feed to a selector, and ids coming
 * from committed storage are not guaranteed to be schema-legal.
 */
function encodeAnchorSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Element id for a rule card, owned by the editor because the editor owns the
 * element. Hosts that link to a rule must build the same string rather than
 * re-deriving the format.
 *
 * The join uses an encoded segment around a `:` separator. The schema id
 * pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$` cannot contain `:`, and the encoding
 * never emits a raw `:`, so the separator is unambiguous and the mapping is
 * injective. That matters because the group id and the rule id are joined into
 * a single DOM identity: a plain `-` join maps group `a-b` with rule `c` and
 * group `a` with rule `b-c` onto the same element, and `getElementById` would
 * resolve to whichever came first.
 */
export function ruleAnchorId(groupId: unknown, ruleId: unknown): string {
  return `rogatio-rule-${encodeAnchorSegment(safeText(groupId))}:${encodeAnchorSegment(
    safeText(ruleId),
  )}`;
}

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
