import {
  type AIAssistRequest,
  type AIProposal,
  createEditor,
  type DryRunResult,
  type EditorController,
} from "@rogatio/editor";
import { type AiPreviewSummary, summarizeAiPreview } from "./ai-preview.js";
import { attentionFromRuleStatuses } from "./attention.js";
import { PROJECT_VERSION, validateProjectDetailed } from "./browser-schema.js";
import {
  nativeHostOriginMismatchMessage,
  runtimeInstallCommand,
} from "./extension-id.js";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabledFromStorageResult,
} from "./match-logging-enabled.js";
import { createMatchLoggingToggle } from "./match-logging-toggle.js";
import {
  projectImportFailure,
  type SaveFilePickerOptions,
  type ShowSaveFilePicker,
  saveExportedProject,
} from "./project-file.js";
import { runtimeControlDisabled } from "./runtime-controls.js";
import { shouldRemountEditorAfterGroupEnablement } from "./workspace-enablement-refresh.js";

interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
  readonly revision: number;
  readonly enabledGroupIds: readonly string[];
}

interface Envelope {
  readonly projects: Readonly<Record<string, StoredProject>>;
  readonly activeProjectId: string | null;
  readonly ruleStatuses?: readonly Record<string, unknown>[];
  readonly badge?: { readonly text: string; readonly attention: boolean };
  readonly nativeRuntimeState?: { readonly phase: string };
  readonly nativeRuntimeError?: string | null;
}

interface ExtensionResponse {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly diagnostic?: { readonly code?: string };
  readonly diagnostics?: readonly {
    readonly code?: string;
    readonly path?: string;
    readonly message?: string;
  }[];
}

function isDryRunValue(value: unknown): value is DryRunResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const summary = record.summary;
  return (
    Array.isArray(record.results) &&
    Array.isArray(record.errors) &&
    typeof summary === "object" &&
    summary !== null &&
    typeof (summary as { matchedUrlCount?: unknown }).matchedUrlCount ===
      "number" &&
    typeof (summary as { urlCount?: unknown }).urlCount === "number"
  );
}

function dryRunDiagnostics(response: ExtensionResponse | undefined): {
  code: string;
  severity: "error";
  path: string;
  message: string;
}[] {
  const source = Array.isArray(response?.diagnostics)
    ? response.diagnostics
    : [];
  const diagnostics = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    if (
      typeof item.code !== "string" ||
      typeof item.path !== "string" ||
      typeof item.message !== "string"
    ) {
      continue;
    }
    diagnostics.push({
      code: item.code,
      severity: "error" as const,
      path: item.path,
      message: item.message,
    });
  }
  if (diagnostics.length > 0) return diagnostics;
  return [
    {
      code: response?.diagnostic?.code ?? "extension.project-invalid",
      severity: "error" as const,
      path: "",
      message: "The project could not be tested.",
    },
  ];
}

interface MessageClient {
  send(message: Record<string, unknown>): Promise<ExtensionResponse>;
}

const extensionRoot = document.querySelector<HTMLElement>(
  "#rogatio-extension-root",
);
if (!extensionRoot) throw new Error("extension.invalid-root");
const root = extensionRoot;

const client: MessageClient = {
  send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({
            ok: false,
            diagnostic: { code: "extension.message-failed" },
          });
        } else resolve(response as ExtensionResponse);
      });
    });
  },
};

let state: Envelope = { projects: {}, activeProjectId: null };
let pendingProjectId: string | null = null;
let activeTab: "dashboard" | "workspace" = "dashboard";
let editor: EditorController | undefined;
/** True once an editor has been mounted, to tell navigation from a rebuild. */
let editorHasMounted = false;
let statusMessage = "";
/** Ready-to-run native host install command shown with a copy button. */
let installCommand: string | null = null;
/** AI support status from native host */
let aiSupported = false;
let aiStatusChecked = false;
/** Whether the host reported provider metadata at the last check. */
let aiReported = false;
/** Host-reported provider metadata for display; never contains the API key. */
let aiProvider: { url: string; model: string } | null = null;
let aiPromptOpen = false;
let aiBusy = false;
let aiPreview: unknown | null = null;
let aiMessage = "";
/** Selected failed rule for the sidebar error card. */
let selectedErrorRule: { groupId: string; ruleId: string } | null = null;
/** Console match logging toggle; missing storage key defaults on. */
let matchLoggingEnabled = true;

/**
 * A `?group=&rule=` link is the source of truth for where the workspace opens.
 * The same URL shape backs the popup deep links and the sidebar rule links, so
 * one resolver handles initial load, browser Back, and in-page activation.
 */
function readRuleDeepLink(): { groupId: string; ruleId: string } | null {
  const params = new URLSearchParams(window.location.search);
  const groupId = params.get("group");
  if (groupId === null || groupId.length === 0) return null;
  const ruleId = params.get("rule");
  return { groupId, ruleId: ruleId === null ? "" : ruleId };
}

/** Diagnostics modal state */
let diagnosticsOpen = false;
let diagnosticsData: {
  phase: string;
  extensionId: string | null;
  hostName: string;
  chromeError: string | null;
  runtimeError: string | null;
  connectNativeAvailable: boolean;
  timestamp: number;
} | null = null;

function safeProjectData(): unknown {
  if (!state.activeProjectId)
    return { version: PROJECT_VERSION, name: "Rogatio project", groups: [] };
  return (
    state.projects[state.activeProjectId]?.data ?? {
      version: PROJECT_VERSION,
      name: "Rogatio project",
      groups: [],
    }
  );
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const RULE_ERROR_REASON_FALLBACK = "The rule failed to install.";

/**
 * Display fallbacks for a malformed status entry. Shared so the sidebar row, the
 * error lookup, and the error card all agree on one identity per entry; three
 * different fallbacks would render a row that nothing can select.
 */
const UNKNOWN_GROUP_ID = "unknown group";
const UNKNOWN_RULE_ID = "unknown rule";

interface ErrorRuleRef {
  readonly groupId: string;
  readonly ruleId: string;
}

interface ResolvedRuleError {
  readonly code: string;
  readonly reason: string;
}

/** Own-property read that never invokes inherited or throwing accessors. */
function readOwnValue(record: object, key: string): unknown {
  try {
    if (!Object.hasOwn(record, key)) return undefined;
    return (record as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readOwnString(record: object, key: string): string | null {
  const value = readOwnValue(record, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function resolveRuleErrorReason(record: Record<string, unknown>): string {
  const params = asRecord(readOwnValue(record, "params"));
  const reason = params === null ? null : readOwnString(params, "reason");
  if (reason !== null) return reason;
  return readOwnString(record, "message") ?? RULE_ERROR_REASON_FALLBACK;
}

function pickRuleErrorDiagnostic(
  diagnostics: unknown,
): ResolvedRuleError | null {
  if (!Array.isArray(diagnostics)) return null;
  let firstUsable: ResolvedRuleError | null = null;
  for (const entry of diagnostics) {
    const record = asRecord(entry);
    if (record === null) continue;
    const code = readOwnString(record, "code");
    if (code === null) continue;
    const resolved: ResolvedRuleError = {
      code,
      reason: resolveRuleErrorReason(record),
    };
    if (code === "extension.dnr-error") return resolved;
    if (firstUsable === null) firstUsable = resolved;
  }
  return firstUsable;
}

function collectErrorRuleRefs(): ErrorRuleRef[] {
  const refs: ErrorRuleRef[] = [];
  for (const ruleStatus of state.ruleStatuses ?? []) {
    if (text(ruleStatus.status, "error") !== "error") continue;
    refs.push({
      groupId: text(ruleStatus.groupId, UNKNOWN_GROUP_ID),
      ruleId: text(ruleStatus.ruleId, UNKNOWN_RULE_ID),
    });
  }
  return refs;
}

function reconcileSelectedErrorRule(): ErrorRuleRef | null {
  const errors = collectErrorRuleRefs();
  if (errors.length === 0) {
    selectedErrorRule = null;
    return null;
  }
  if (selectedErrorRule !== null) {
    const current = errors.find(
      (entry) =>
        entry.groupId === selectedErrorRule?.groupId &&
        entry.ruleId === selectedErrorRule?.ruleId,
    );
    if (current !== undefined) return current;
  }
  const first = errors[0];
  if (first === undefined) return null;
  selectedErrorRule = first;
  return first;
}

function ruleErrorReasonFor(groupId: string, ruleId: string): string {
  for (const ruleStatus of state.ruleStatuses ?? []) {
    if (text(ruleStatus.status, "error") !== "error") continue;
    if (
      text(ruleStatus.groupId, UNKNOWN_GROUP_ID) !== groupId ||
      text(ruleStatus.ruleId, UNKNOWN_RULE_ID) !== ruleId
    ) {
      continue;
    }
    return (
      pickRuleErrorDiagnostic(readOwnValue(ruleStatus, "diagnostics"))
        ?.reason ?? RULE_ERROR_REASON_FALLBACK
    );
  }
  return RULE_ERROR_REASON_FALLBACK;
}

function button(label: string, command: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  result.dataset.command = command;
  return result;
}

/** The browser-assigned extension ID, needed for the native host install. */
function extensionId(): string {
  const id = chrome.runtime.id;
  return typeof id === "string" && id.length > 0 ? id : "";
}

/** Tone class for the runtime status dot: running, failed, or neutral. */
function runtimeStatusTone(): string {
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  if (phase === "started") return "rogatio-runtime-running";
  if (phase === "failed" || phase === "error") return "rogatio-runtime-failed";
  if (phase === "starting") return "rogatio-runtime-starting";
  return "rogatio-runtime-idle";
}

type SidebarCardName = "runtime" | "ai" | "rules";

/**
 * A labelled status module for the sidebar. The heading carries the tone so an
 * operator reads state before controls: the dot in the header is the summary,
 * the body is the detail.
 */
function createSidebarCard(
  name: SidebarCardName,
  headingText: string,
  tone: string,
): { readonly card: HTMLElement; readonly body: HTMLElement } {
  const card = document.createElement("section");
  card.className = "rogatio-sidebar-card";
  card.dataset.card = name;
  const heading = document.createElement("h2");
  heading.className = "rogatio-sidebar-card-heading";
  heading.dataset.tone = tone;
  heading.textContent = headingText;
  const body = document.createElement("div");
  body.className = "rogatio-sidebar-card-body";
  card.append(heading, body);
  return { card, body };
}

/** Deep link for one rule, using the same `?group=&rule=` shape as `groupUrl`. */
function ruleDeepLink(groupId: string, ruleId: string): string {
  return `?group=${encodeURIComponent(groupId)}&rule=${encodeURIComponent(ruleId)}`;
}

/**
 * Install status for one rule, or undefined when it is not in the projection.
 * Compares with the same fallbacks the sidebar row uses, so a malformed status
 * entry that renders as "unknown group" is still found by its own link. Using
 * different fallbacks here would make a rendered row impossible to select.
 */
function statusForRule(groupId: string, ruleId: string): string | undefined {
  for (const ruleStatus of state.ruleStatuses ?? []) {
    if (
      text(ruleStatus.groupId, UNKNOWN_GROUP_ID) === groupId &&
      text(ruleStatus.ruleId, UNKNOWN_RULE_ID) === ruleId
    ) {
      return text(ruleStatus.status, "error");
    }
  }
  return undefined;
}

/**
 * The single place a `?group=&rule=` deep link becomes editor state. Initial
 * load, browser Back, and in-page link activation all funnel through here so
 * there is one navigation mechanism rather than three.
 *
 * On the workspace path it never calls `renderShell()`. The mounted editor is
 * the user's unsaved work, and rule navigation is a sidebar state change, so
 * the sidebar is replaced on its own. The dashboard path has no mounted editor
 * to preserve, so it remounts and lets the mount path apply the link.
 */
function navigateToRuleDeepLink(
  groupId: string,
  ruleId: string,
  options: { readonly push: boolean },
): void {
  if (options.push) {
    window.history.pushState(
      { rogatioRule: { groupId, ruleId } },
      "",
      ruleDeepLink(groupId, ruleId),
    );
  }
  if (activeTab !== "workspace") {
    // Coming from the dashboard means there is no mounted editor to preserve.
    // `renderShell` applies the deep link on mount, so do not navigate twice.
    activeTab = "workspace";
    renderShell();
    return;
  }
  // Refresh the sidebar so the error card reflects the newly selected rule,
  // then let the editor move and reveal it.
  patchWorkspaceEnablementChrome();
  editor?.navigateToRule(groupId, ruleId);
}

let ruleStatusSerial = 0;

/**
 * The names the user recognizes, resolved from the **committed** active project.
 *
 * The sidebar is rebuilt from the committed envelope, so it shows what is
 * actually installed. Reading the editor's draft instead would show an unsaved
 * rename here, which `docs/architecture.md:156` forbids: Workspace controls
 * always target the committed active project. A status whose rule is no longer
 * in the project falls back to its id, because a rule that is gone still needs a
 * row that names it.
 */
function committedRuleLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  const project = state.activeProjectId
    ? state.projects[state.activeProjectId]
    : undefined;
  const data = asRecord(project?.data);
  if (data === null) return labels;
  const groups = Array.isArray(data.groups) ? data.groups : [];
  for (const rawGroup of groups) {
    const group = asRecord(rawGroup);
    if (group === null) continue;
    // Own-string reads, not plain property access: the rest of this file never
    // invokes an inherited or throwing accessor on project data.
    const groupId = readOwnString(group, "id") ?? "";
    if (groupId.length === 0) continue;
    const groupName = readOwnString(group, "name") ?? "";
    const rules = Array.isArray(group.rules) ? group.rules : [];
    for (const rawRule of rules) {
      const rule = asRecord(rawRule);
      if (rule === null) continue;
      const ruleId = readOwnString(rule, "id") ?? "";
      if (ruleId.length === 0) continue;
      const ruleName = readOwnString(rule, "name") ?? "";
      labels.set(
        ruleIdentityKey(groupId, ruleId),
        `${groupName.length > 0 ? groupName : groupId} / ${ruleName.length > 0 ? ruleName : ruleId}`,
      );
    }
  }
  return labels;
}

/**
 * A separator that cannot occur inside an id, so two different
 * (group, rule) pairs can never collide on one key.
 */
function ruleIdentityKey(groupId: string, ruleId: string): string {
  return `${groupId}\u0000${ruleId}`;
}

/**
 * How a rule is named in the sidebar and the install-error card.
 *
 * Two rows in one list can otherwise render identical text: a status can
 * outlive the name it was filed under, and the product's own default names
 * repeat. The later entry therefore carries its id, which is the only value that
 * is guaranteed distinct.
 */
function ruleDisplayLabel(
  labels: ReadonlyMap<string, string>,
  groupId: string,
  ruleId: string,
  seen: ReadonlySet<string>,
): string {
  const base =
    labels.get(ruleIdentityKey(groupId, ruleId)) ?? `${groupId}/${ruleId}`;
  if (!seen.has(base)) return base;
  return `${base} (${ruleId})`;
}

/**
 * One rule row: a real link to the rule's section, with its status as a
 * separate right-aligned token.
 *
 * The link is always a real deep link even when the rule is no longer in the
 * draft, because an unsaved rename is not something the sidebar should refuse to
 * navigate. `navigateToRule` resolves against the draft and lands on the owning
 * group when the rule itself is gone, which is a real destination rather than a
 * dead click. A non-navigable element would also be the wrong shape: an errored
 * rule can be absent from the project while its install reason is still the most
 * useful thing on screen.
 */
function createRuleEntry(
  groupId: string,
  ruleId: string,
  statusValue: string,
  label: string,
): HTMLLIElement {
  ruleStatusSerial += 1;
  const item = document.createElement("li");
  item.className = "rogatio-rule-row";
  const link = document.createElement("a");
  link.className = "rogatio-rule-link";
  link.dataset.ruleLink = "true";
  link.dataset.groupId = groupId;
  link.dataset.ruleId = ruleId;
  link.href = ruleDeepLink(groupId, ruleId);
  link.textContent = label;
  const status = document.createElement("span");
  status.className = "rogatio-rule-status";
  status.dataset.ruleStatus = "true";
  status.dataset.tone = ruleStatusTone(statusValue);
  status.id = `rogatio-rule-status-${ruleStatusSerial}`;
  status.textContent = statusValue;
  // The status is a sibling of the link, so name it explicitly or a screen
  // reader announces the identity with no state attached.
  link.setAttribute("aria-describedby", status.id);
  item.append(link, status);
  return item;
}

/** Map an install status to a tone token for the status dot and column. */
function ruleStatusTone(statusValue: string): string {
  switch (statusValue) {
    case "active":
      return "ok";
    case "error":
      return "error";
    case "disabled":
      return "muted";
    default:
      return "warn";
  }
}

/** Human-readable runtime phase for the sidebar status line. */
function runtimeStatusText(): string {
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  switch (phase) {
    case "starting":
      return "starting";
    case "started":
      return "running";
    case "failed":
      return "failed to start";
    case "unsupported":
      return "unavailable on this platform";
    case "error":
      return "error";
    default:
      return "stopped";
  }
}

function runtimeRecoveryText(): string {
  const error = state.nativeRuntimeError?.toLowerCase() ?? "";
  if (error.includes("allowed_origins") || error.includes("origin-forbidden")) {
    return "This extension ID is not in the host manifest allowed_origins. Re-pin the host with the command below, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (error.includes("native-host-missing")) {
    return "Install the host using the command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (error.includes("host")) {
    return "Re-run the install command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (
    error.includes("trust") ||
    error.includes("certificate") ||
    error.includes("ca")
  ) {
    return "Run the install command below to register the host and trust the device-local CA, then restart Chrome and click Start runtime again.";
  }
  if ((state.nativeRuntimeState?.phase ?? "stopped") === "unsupported") {
    return "This device cannot provide the capabilities required by the selected runtime rules. You can still edit and verify the project.";
  }
  return "Open Show diagnostics for the concrete host error. After correcting it, click Start runtime again.";
}

/**
 * The blocking status behind the badge's attention flag, derived from the
 * actual rule statuses (REQ-GAV-004) with the shared f21 precedence
 * (error > needs runtime > unsupported > active). The badge and the
 * sidebar note must describe what is actually blocking — never a canned
 * "grant access" hint when permissions are already granted.
 */
function attentionFromStatuses() {
  return attentionFromRuleStatuses({
    attention: state.badge?.attention === true,
    statuses: state.ruleStatuses ?? [],
  });
}

function countGroups(value: unknown): number {
  return isProjectRecord(value) && Array.isArray(value.groups)
    ? value.groups.length
    : 0;
}

function countRules(value: unknown): number {
  if (!isProjectRecord(value) || !Array.isArray(value.groups)) return 0;
  let total = 0;
  for (const group of value.groups) {
    if (isProjectRecord(group) && Array.isArray(group.rules)) {
      total += group.rules.length;
    }
  }
  return total;
}

function createAiPreviewDetails(summary: AiPreviewSummary): HTMLElement {
  const container = document.createElement("div");
  container.className = "rogatio-ai-preview-details";
  container.dataset.aiPreviewDetails = "true";

  if (summary.description !== null) {
    const description = document.createElement("p");
    description.dataset.aiPreviewDescription = "true";
    description.className = "rogatio-ai-preview-description";
    description.textContent = summary.description;
    container.append(description);
  }

  if (summary.groups.length === 0) {
    const empty = document.createElement("p");
    empty.dataset.aiPreviewEmpty = "true";
    empty.textContent = "This preview contains no groups.";
    container.append(empty);
    return container;
  }

  const groupList = document.createElement("ul");
  groupList.dataset.aiPreviewGroups = "true";
  groupList.className = "rogatio-ai-preview-list";
  summary.groups.forEach((group, groupIndex) => {
    const groupItem = document.createElement("li");
    groupItem.dataset.aiPreviewGroup = "true";
    groupItem.className = "rogatio-ai-preview-group";
    const details = document.createElement("details");
    if (groupIndex === 0) details.open = true;
    const summaryEl = document.createElement("summary");
    const groupName = document.createElement("span");
    groupName.textContent = group.name;
    const groupCount = document.createElement("span");
    groupCount.className = "rogatio-ai-preview-count";
    groupCount.textContent =
      group.rules.length === 1 ? "1 rule" : `${group.rules.length} rules`;
    summaryEl.append(groupName, " — ", groupCount);
    details.append(summaryEl);

    if (group.rules.length === 0) {
      const empty = document.createElement("p");
      empty.dataset.aiPreviewGroupEmpty = "true";
      empty.textContent = "No rules in this group.";
      details.append(empty);
    } else {
      const ruleList = document.createElement("ul");
      ruleList.dataset.aiPreviewRules = "true";
      ruleList.className = "rogatio-ai-preview-rules";
      for (const rule of group.rules) {
        const ruleItem = document.createElement("li");
        ruleItem.dataset.aiPreviewRule = "true";
        ruleItem.className = "rogatio-ai-preview-rule";

        const title = document.createElement("p");
        title.className = "rogatio-ai-preview-rule-title";
        const ruleName = document.createElement("strong");
        ruleName.textContent = rule.name;
        const ruleType = document.createElement("span");
        ruleType.className = "rogatio-ai-preview-type";
        ruleType.textContent = rule.type;
        title.append(ruleName, " ", ruleType);
        ruleItem.append(title);

        const source = document.createElement("p");
        source.className = "rogatio-ai-preview-source";
        const sourceLabel = document.createElement("span");
        sourceLabel.textContent = "Source: ";
        const sourceCode = document.createElement("code");
        sourceCode.dataset.aiPreviewSource = "true";
        sourceCode.textContent = rule.source;
        source.append(sourceLabel, sourceCode);
        ruleItem.append(source);

        const metaParts = [rule.resourceTypes, rule.priority];
        if (rule.method !== null) metaParts.push(`method ${rule.method}`);
        const meta = document.createElement("p");
        meta.className = "rogatio-ai-preview-meta";
        meta.textContent = metaParts.join(" • ");
        ruleItem.append(meta);

        const action = document.createElement("p");
        action.className = "rogatio-ai-preview-action";
        action.dataset.aiPreviewAction = "true";
        action.textContent = rule.action;
        ruleItem.append(action);

        ruleList.append(ruleItem);
      }
      details.append(ruleList);
    }

    if (group.omittedRules > 0) {
      const omitted = document.createElement("p");
      omitted.className = "rogatio-ai-preview-omitted";
      omitted.textContent = `+${group.omittedRules} more rules not shown.`;
      details.append(omitted);
    }

    groupItem.append(details);
    groupList.append(groupItem);
  });
  container.append(groupList);

  if (summary.omittedGroups > 0) {
    const omitted = document.createElement("p");
    omitted.className = "rogatio-ai-preview-omitted";
    omitted.textContent = `+${summary.omittedGroups} more groups not shown.`;
    container.append(omitted);
  }
  return container;
}

function badgeLabelText(): string {
  const attention = attentionFromStatuses();
  const attentionText = state.badge?.attention ? " (attention needed)" : "";
  const attentionReason =
    attention !== null && state.ruleStatuses ? ` — ${attention.blocking}` : "";
  return state.badge
    ? `Active rules: ${state.badge.text}${attentionText}${attentionReason}`
    : `Active rules: 0${attentionText}${attentionReason}`;
}

function renderChrome(shell: HTMLElement): void {
  const chrome = document.createElement("div");
  chrome.className = "rogatio-chrome";
  renderTopbar(chrome);
  shell.append(chrome);
}

function renderTopbar(shell: HTMLElement): void {
  const topbar = document.createElement("header");
  topbar.className = "rogatio-topbar";
  const heading = document.createElement("h1");
  heading.id = "rogatio-title";
  heading.textContent = "Rogatio";
  topbar.append(heading);

  const tabs = document.createElement("div");
  tabs.className = "rogatio-tabs";
  for (const tab of ["dashboard", "workspace"] as const) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.textContent = tab === "dashboard" ? "Dashboard" : "Workspace";
    tabButton.dataset.tab = tab;
    if (activeTab === tab) tabButton.setAttribute("aria-current", "true");
    tabs.append(tabButton);
  }
  topbar.append(tabs);
  shell.append(topbar);
}

function createSidebar(): HTMLElement {
  const sidebar = document.createElement("aside");
  sidebar.className = "rogatio-sidebar";

  const activeProject = state.activeProjectId
    ? state.projects[state.activeProjectId]
    : undefined;
  if (activeProject && isProjectRecord(activeProject.data)) {
    const projectCard = document.createElement("div");
    // Not `.rogatio-project-card`: that class is the interactive dashboard card
    // and carries `cursor: pointer` plus a hover border. Naming the active
    // project is not an action, so the sidebar gets an inert card instead of a
    // dead affordance.
    projectCard.className = "rogatio-sidebar-project-card";
    projectCard.dataset.activeProjectCard = "true";
    const title = document.createElement("p");
    title.className = "rogatio-sidebar-project-card-title";
    title.textContent = text(activeProject.data.name, activeProject.id);
    const status = document.createElement("p");
    status.className = "rogatio-project-status";
    status.textContent = "Active project";
    projectCard.append(title, status);
    sidebar.append(projectCard);
  }

  const runtimePhase = state.nativeRuntimeState?.phase ?? "stopped";
  const runtimeTone =
    runtimePhase === "started"
      ? "ok"
      : runtimePhase === "failed" || runtimePhase === "error"
        ? "error"
        : runtimePhase === "starting"
          ? "warn"
          : "muted";

  // Runtime card: the session controls, the phase they change, and the
  // extension ID that `rogatio runtime install` needs.
  const runtime = createSidebarCard("runtime", "Runtime", runtimeTone);
  const actions = document.createElement("div");
  actions.className = "rogatio-sidebar-actions";
  const controlsDisabled = runtimeControlDisabled(runtimePhase);
  const startRuntime = button("Start runtime", "start-native-runtime");
  startRuntime.disabled = controlsDisabled.start;
  const stopRuntime = button("Stop runtime", "stop-native-runtime");
  stopRuntime.disabled = controlsDisabled.stop;
  actions.append(startRuntime, stopRuntime);
  runtime.body.append(actions);

  // Runtime status sits directly under the Start/Stop controls so the current
  // phase is always visible next to the actions that change it.
  const nativeRuntime = document.createElement("p");
  nativeRuntime.dataset.nativeRuntimeState = "true";
  nativeRuntime.className = `rogatio-runtime-status ${runtimeStatusTone()}`;
  nativeRuntime.textContent = `Runtime status: ${runtimeStatusText()}`;
  runtime.body.append(nativeRuntime);

  // The browser-assigned extension ID is what `rogatio runtime install` pins
  // in the native-messaging manifest; always show it so the install step
  // never requires hunting through chrome://extensions.
  const extensionIdRow = document.createElement("div");
  extensionIdRow.className = "rogatio-extension-id-row";
  const extensionIdLine = document.createElement("p");
  extensionIdLine.dataset.extensionId = "true";
  extensionIdLine.className = "rogatio-extension-id";
  extensionIdLine.textContent = `Extension ID: ${extensionId() || "unknown"}`;
  const copyId = button("⧉", "copy-extension-id");
  copyId.className = "rogatio-copy-icon";
  copyId.setAttribute("aria-label", "Copy extension ID");
  copyId.title = "Copy extension ID";
  extensionIdRow.append(extensionIdLine, copyId);
  runtime.body.append(extensionIdRow);

  // Show diagnostics when the runtime failed or is unsupported, and keep the
  // concrete error next to it.
  if (runtimePhase === "failed" || runtimePhase === "unsupported") {
    runtime.body.append(button("Show diagnostics", "show-diagnostics"));
    const runtimeError = state.nativeRuntimeError;
    if (runtimeError) {
      const runtimeErrorLine = document.createElement("p");
      runtimeErrorLine.dataset.runtimeError = "true";
      runtimeErrorLine.className = "rogatio-runtime-error";
      runtimeErrorLine.textContent = `Runtime error: ${runtimeError}`;
      runtime.body.append(runtimeErrorLine);
      if (runtimeError.includes("allowed_origins")) {
        const mismatchCommand = document.createElement("p");
        mismatchCommand.dataset.runtimeOriginMismatch = "true";
        mismatchCommand.className = "rogatio-runtime-error";
        mismatchCommand.textContent = `Re-pin the host: ${runtimeInstallCommand(extensionId())}`;
        runtime.body.append(mismatchCommand);
      }
    }
  }
  sidebar.append(runtime.card);

  // AI card: status plus host-reported provider metadata (issue #241). The
  // host never sends the API key, so the card never renders it (spec REQ-010).
  const aiTone = aiSupported
    ? "ok"
    : aiStatusChecked && aiReported
      ? "warn"
      : "muted";
  const ai = createSidebarCard("ai", "AI", aiTone);
  const aiStatus = document.createElement("p");
  aiStatus.dataset.aiStatus = "true";
  aiStatus.className = "rogatio-ai-status";
  const aiProviderInfo = aiSupported ? aiProvider : null;
  if (state.nativeRuntimeState?.phase !== "started") {
    aiStatus.textContent = "AI: needs runtime";
    aiStatus.className += " rogatio-ai-needs-runtime";
  } else if (aiProviderInfo !== null) {
    aiStatus.textContent = "AI: Configured";
    aiStatus.className += " rogatio-ai-ready";
  } else if (aiStatusChecked && !aiReported) {
    aiStatus.textContent = "AI: not reported";
    aiStatus.className += " rogatio-ai-not-reported";
  } else {
    aiStatus.textContent = "AI: Not configured";
    aiStatus.className += " rogatio-ai-not-configured";
  }
  ai.body.append(aiStatus);
  if (aiProviderInfo !== null) {
    const aiProviderLine = document.createElement("p");
    aiProviderLine.dataset.aiProvider = "true";
    aiProviderLine.className = "rogatio-ai-provider";
    aiProviderLine.textContent = `Provider: ${aiProviderInfo.url}`;
    const aiModelLine = document.createElement("p");
    aiModelLine.dataset.aiModel = "true";
    aiModelLine.className = "rogatio-ai-model";
    aiModelLine.textContent = `Model: ${aiProviderInfo.model}`;
    ai.body.append(aiProviderLine, aiModelLine);
  }
  sidebar.append(ai.card);

  // Project switching and import are dashboard actions. Workspace controls
  // operate only on the committed active project.

  const attention = attentionFromStatuses();
  if (attention !== null) {
    const attentionNote = document.createElement("p");
    attentionNote.className = "rogatio-attention-note";
    const noteParts = [attention.explanation, attention.fix].filter(
      (part) => part.length > 0,
    );
    attentionNote.textContent = `Attention needed: ${noteParts.join(" ")}`;
    sidebar.append(attentionNote);
  }

  // Rules card: one link per rule, then the observation switch. Match logging
  // belongs with the rules because it reports on rule matching, not on the
  // session.
  const statuses = state.ruleStatuses ?? [];
  // The card dot summarises the rules, so it has to reflect the worst status.
  // "There are rows" is not the same claim as "the rules are fine", and a green
  // dot above ten disabled rules is a false summary.
  const allActive =
    statuses.length > 0 &&
    statuses.every((ruleStatus) => text(ruleStatus.status, "") === "active");
  const rules = createSidebarCard(
    "rules",
    "Rules",
    attention !== null
      ? "warn"
      : allActive
        ? "ok"
        : statuses.length > 0
          ? "warn"
          : "muted",
  );
  // One pass over the committed project per sidebar render, shared by the rule
  // rows and the install-error card.
  const labels = committedRuleLabels();
  const badge = document.createElement("p");
  badge.dataset.badgeState = "true";
  badge.className = "rogatio-badge-pill";
  badge.textContent = badgeLabelText();
  const ruleStatuses = document.createElement("ul");
  ruleStatuses.className = "rogatio-rule-list";
  ruleStatuses.dataset.ruleStatuses = "true";
  const seenLabels = new Set<string>();
  for (const ruleStatus of statuses) {
    const groupId = text(ruleStatus.groupId, UNKNOWN_GROUP_ID);
    const ruleId = text(ruleStatus.ruleId, UNKNOWN_RULE_ID);
    ruleStatuses.append(
      createRuleEntry(
        groupId,
        ruleId,
        text(ruleStatus.status, "error"),
        ruleDisplayLabel(labels, groupId, ruleId, seenLabels),
      ),
    );
    seenLabels.add(
      labels.get(ruleIdentityKey(groupId, ruleId)) ?? `${groupId}/${ruleId}`,
    );
  }
  rules.body.append(badge, ruleStatuses);
  rules.body.append(
    createMatchLoggingToggle({
      api: chrome,
      enabled: matchLoggingEnabled,
      onPersisted: (enabled) => {
        matchLoggingEnabled = enabled;
      },
    }),
  );
  sidebar.append(rules.card);

  const selectedError = reconcileSelectedErrorRule();
  if (selectedError !== null) {
    const card = document.createElement("section");
    card.className = "rogatio-rule-error-card";
    card.dataset.ruleErrorCard = "true";
    const heading = document.createElement("h2");
    heading.textContent = "Rule install error";
    const identity = document.createElement("p");
    identity.className = "rogatio-rule-error-card-identity";
    // The same committed-project label the rule rows use, so the card names the
    // rule the way the rest of the page does. The map is built once per render.
    identity.textContent =
      labels.get(
        ruleIdentityKey(selectedError.groupId, selectedError.ruleId),
      ) ?? `${selectedError.groupId}/${selectedError.ruleId}`;
    const reason = document.createElement("p");
    reason.className = "rogatio-rule-error-card-reason";
    reason.textContent = ruleErrorReasonFor(
      selectedError.groupId,
      selectedError.ruleId,
    );
    card.append(heading, identity, reason);
    sidebar.append(card);
  }

  return sidebar;
}

/**
 * Identifiers that survive a sidebar re-render, so focus can be put back on
 * the control the user was actually using. The sidebar is rebuilt wholesale, so
 * without this the focused node is destroyed and focus falls to `<body>`.
 */
const FOCUSABLE_HOOKS = ["ruleLink", "command", "matchLoggingToggle"] as const;

function captureSidebarFocus(): {
  readonly hook: string;
  readonly key: string;
  readonly position: number;
} | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const data = active.dataset;
  for (const hook of FOCUSABLE_HOOKS) {
    const value = data[hook];
    if (typeof value !== "string") continue;
    if (hook === "command" || hook === "matchLoggingToggle") {
      return { hook, key: value, position: -1 };
    }
    const position = [...document.querySelectorAll("[data-rule-link]")].indexOf(
      active,
    );
    if (value === "true" || position >= 0) {
      return { hook, key: value, position };
    }
  }
  return null;
}

function restoreSidebarFocus(
  captured: ReturnType<typeof captureSidebarFocus>,
): void {
  if (captured === null) return;
  const selector =
    captured.hook === "command"
      ? `[data-command="${CSS.escape(captured.key)}"]`
      : captured.hook === "matchLoggingToggle"
        ? "[data-match-logging-toggle] input"
        : "[data-rule-link]";
  const target =
    captured.position >= 0
      ? ([...document.querySelectorAll(selector)][captured.position] as
          | HTMLElement
          | undefined)
      : (document.querySelector(selector) as HTMLElement | null);
  // `preventScroll` matters: putting focus back must not move the viewport,
  // and the control being restored is often in a different part of the page
  // than where the user is looking.
  if (target && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
}

/**
 * Update sidebar chrome without remounting a dirty editor draft. This is the
 * only path a sidebar state change may take: `renderShell()` destroys the
 * mounted editor and would discard unsaved work.
 */
function patchWorkspaceEnablementChrome(): void {
  const captured = captureSidebarFocus();
  const existing = root.querySelector(".rogatio-sidebar");
  if (existing) existing.replaceWith(createSidebar());
  restoreSidebarFocus(captured);
  const status = root.querySelector(".rogatio-status");
  if (status) status.textContent = statusMessage;
  const badge = root.querySelector("[data-badge-state]");
  if (badge) badge.textContent = badgeLabelText();
  editor?.syncGroupEnablement(activeEnabledGroupIds());
}

function activeEnabledGroupIds(): readonly string[] {
  const project = state.activeProjectId
    ? state.projects[state.activeProjectId]
    : undefined;
  const ids = project?.enabledGroupIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}

function renderOverview(shell: HTMLElement): void {
  const overview = document.createElement("section");
  overview.dataset.overview = "true";
  overview.className = "rogatio-overview";

  const heading = document.createElement("h2");
  heading.textContent = "Projects";
  const subtitle = document.createElement("p");
  subtitle.className = "rogatio-overview-subtitle";
  subtitle.textContent = "Manage your active modification rules.";
  overview.append(heading, subtitle);

  const ids = Object.keys(state.projects).sort();
  const grid = document.createElement("div");
  grid.className = "rogatio-project-grid";
  for (const id of ids) {
    const project = state.projects[id];
    if (!project) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "rogatio-project-card";
    card.dataset.projectCard = "true";
    card.dataset.projectId = id;
    const phase = state.nativeRuntimeState?.phase ?? "stopped";
    const isStarted = phase === "started";
    if (state.activeProjectId === id && isStarted) card.dataset.active = "true";

    const title = document.createElement("p");
    title.className = "rogatio-project-card-title";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = text(project.name, id);
    title.append(nameSpan);
    card.append(title);

    const status = document.createElement("span");
    status.dataset.projectStatus = "true";
    status.className = "rogatio-project-status";
    const isActive = state.activeProjectId === id;
    if (isActive && isStarted) {
      status.textContent = "Active Runtime";
    } else if (isActive && (phase === "failed" || phase === "error")) {
      status.textContent = "Runtime failed";
    } else if (isActive && phase === "unsupported") {
      status.textContent = "Runtime unavailable";
    } else if (isActive && phase === "starting") {
      status.textContent = "Runtime starting";
    } else {
      status.textContent = "Idle";
    }
    card.append(status);

    const stats = document.createElement("div");
    stats.className = "rogatio-project-stats";
    const groups = countGroups(project.data);
    const rules = countRules(project.data);
    const enabled = project.enabledGroupIds.length;
    const statRow = (label: string, selector: string, value: string) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const count = document.createElement("span");
      count.dataset[selector] = "true";
      count.textContent = value;
      row.append(name, count);
      return row;
    };
    stats.append(
      statRow("Groups", "projectGroups", String(groups)),
      statRow("Rules", "projectRules", String(rules)),
      statRow("Enabled", "projectEnabled", `${enabled} of ${groups}`),
    );
    card.append(stats);

    const footer = document.createElement("div");
    footer.className = "rogatio-project-footer";
    const projectId = document.createElement("span");
    projectId.dataset.projectIdLabel = "true";
    projectId.textContent = `ID: ${id}`;
    footer.append(projectId);
    card.append(footer);
    grid.append(card);
  }

  const creationGrid = document.createElement("div");
  creationGrid.className = "rogatio-creation-grid";

  const creationSection = document.createElement("section");
  creationSection.className = "rogatio-dashboard-card rogatio-create-section";
  creationSection.dataset.dashboardSection = "create";
  const creationHeading = document.createElement("div");
  creationHeading.className = "rogatio-dashboard-section-heading";
  const creationTitle = document.createElement("h3");
  creationTitle.textContent = "Start a project";
  const creationHint = document.createElement("p");
  creationHint.textContent = "Choose how you want to begin.";
  creationHeading.append(creationTitle, creationHint);
  creationSection.append(creationHeading, creationGrid);

  const createNewCard = document.createElement("button");
  createNewCard.type = "button";
  createNewCard.className = "rogatio-create-project";
  createNewCard.dataset.command = "create";
  const createNewIcon = document.createElement("span");
  createNewIcon.className = "rogatio-create-icon";
  createNewIcon.textContent = "+";
  const createNewTitle = document.createElement("span");
  createNewTitle.className = "rogatio-create-title";
  createNewTitle.textContent = "Create New Project";
  const createNewHint = document.createElement("span");
  createNewHint.className = "rogatio-create-hint";
  createNewHint.textContent = "Start with a clean project for rules.";
  createNewCard.append(createNewIcon, createNewTitle, createNewHint);
  creationGrid.append(createNewCard);

  const importCard = document.createElement("button");
  importCard.type = "button";
  importCard.className = "rogatio-create-project";
  importCard.dataset.command = "import";
  const importIcon = document.createElement("span");
  importIcon.className = "rogatio-create-icon";
  importIcon.textContent = "↥";
  const importTitle = document.createElement("span");
  importTitle.className = "rogatio-create-title";
  importTitle.textContent = "Import Project";
  const importHint = document.createElement("span");
  importHint.className = "rogatio-create-hint";
  importHint.textContent =
    "Open a project file from your device. Any filename works.";
  importCard.append(importIcon, importTitle, importHint);
  creationGrid.append(importCard);

  const dashboardImportInput = document.createElement("input");
  dashboardImportInput.type = "file";
  dashboardImportInput.hidden = true;
  dashboardImportInput.dataset.importInput = "true";
  overview.append(dashboardImportInput);

  const aiCard = document.createElement("button");
  aiCard.type = "button";
  aiCard.className = "rogatio-create-project rogatio-create-ai";
  aiCard.dataset.command = "ai-generate";
  aiCard.disabled = !aiSupported;
  aiCard.setAttribute("aria-describedby", "rogatio-ai-create-hint");
  const aiIcon = document.createElement("span");
  aiIcon.className = "rogatio-create-icon";
  aiIcon.textContent = "✦";
  const aiTitle = document.createElement("span");
  aiTitle.className = "rogatio-create-title";
  aiTitle.textContent = "Create using AI";
  const aiHint = document.createElement("span");
  aiHint.className = "rogatio-create-hint";
  aiHint.id = "rogatio-ai-create-hint";
  aiHint.textContent = aiSupported
    ? "Describe the project you want to build."
    : "Start the native runtime and configure AI to enable generation.";
  aiCard.append(aiIcon, aiTitle, aiHint);
  creationGrid.append(aiCard);

  if (aiPromptOpen) {
    const composer = document.createElement("section");
    composer.className = "rogatio-ai-composer";
    composer.setAttribute("aria-labelledby", "rogatio-ai-heading");
    const aiHeading = document.createElement("h3");
    aiHeading.id = "rogatio-ai-heading";
    aiHeading.textContent =
      aiPreview === null ? "Describe your project" : "Review generated project";
    composer.append(aiHeading);

    if (aiPreview === null) {
      const form = document.createElement("form");
      form.dataset.aiForm = "true";
      const label = document.createElement("label");
      label.htmlFor = "rogatio-ai-prompt";
      label.textContent = "What should Rogatio create?";
      const prompt = document.createElement("textarea");
      prompt.id = "rogatio-ai-prompt";
      prompt.name = "prompt";
      prompt.required = true;
      prompt.maxLength = 4000;
      prompt.rows = 4;
      prompt.placeholder =
        "For example: redirect example.com/docs to the new guide...";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.disabled = aiBusy;
      submit.textContent = aiBusy ? "Generating…" : "Generate preview";
      const cancel = button("Cancel", "ai-cancel");
      form.append(label, prompt, submit, cancel);
      composer.append(form);
    } else {
      const preview = document.createElement("div");
      preview.className = "rogatio-ai-preview";
      const summaryData = summarizeAiPreview(aiPreview);
      const name = document.createElement("strong");
      name.textContent = summaryData.name;
      const summary = document.createElement("p");
      summary.textContent = `${countGroups(aiPreview)} groups, ${countRules(aiPreview)} rules. This preview has not been saved.`;
      preview.append(name, summary);
      preview.append(createAiPreviewDetails(summaryData));
      const create = button("Create project", "ai-create");
      const cancel = button("Cancel", "ai-cancel");
      composer.append(preview, create, cancel);
    }
    if (aiMessage.length > 0) {
      const message = document.createElement("p");
      message.className = "rogatio-ai-message";
      message.setAttribute("role", "status");
      message.textContent = aiMessage;
      composer.append(message);
    }
    creationSection.append(composer);
  }

  const projectsSection = document.createElement("section");
  projectsSection.className = "rogatio-dashboard-card rogatio-projects-section";
  projectsSection.dataset.dashboardSection = "projects";
  const projectsHeading = document.createElement("div");
  projectsHeading.className = "rogatio-dashboard-section-heading";
  const projectsCopy = document.createElement("div");
  const projectsTitle = document.createElement("h3");
  projectsTitle.textContent = "Your projects";
  const projectsHint = document.createElement("p");
  projectsHint.textContent =
    ids.length === 0
      ? "Your saved projects will appear here."
      : "Select a project to open it in Workspace.";
  projectsCopy.append(projectsTitle, projectsHint);

  const projectActions = document.createElement("div");
  projectActions.className = "rogatio-dashboard-section-actions";
  const selectorLabel = document.createElement("label");
  selectorLabel.textContent = "Project to switch";
  const selector = document.createElement("select");
  selector.dataset.projectSelector = "true";
  for (const id of ids) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text(state.projects[id]?.name, id);
    selector.append(option);
  }
  if (ids.length > 0) {
    selector.value = pendingProjectId ?? state.activeProjectId ?? ids[0];
  }
  selectorLabel.append(selector);
  projectActions.append(selectorLabel, button("Switch project", "switch"));
  projectsHeading.append(projectsCopy, projectActions);
  projectsSection.append(projectsHeading, grid);

  overview.append(creationSection, projectsSection);
  shell.append(overview);
}

function renderShell(): void {
  // Both rebuild paths restore focus: `renderShell` for a clean editor and
  // `patchWorkspaceEnablementChrome` for a dirty one. Without this the focused
  // node is destroyed and focus falls to `<body>`.
  const capturedFocus = captureSidebarFocus();
  editor?.destroy();
  editor = undefined;
  root.replaceChildren();
  const shell = document.createElement("section");
  shell.className = "rogatio-shell";
  shell.setAttribute("aria-labelledby", "rogatio-title");

  renderChrome(shell);

  const layout = document.createElement("div");
  layout.className = "rogatio-layout";
  layout.dataset.view = activeTab;
  if (activeTab === "workspace") layout.append(createSidebar());

  const main = document.createElement("main");
  main.className = "rogatio-main";
  const status = document.createElement("p");
  status.className = "rogatio-status";
  status.setAttribute("role", "status");
  status.textContent = statusMessage;
  main.append(status);

  const runtimePhase = state.nativeRuntimeState?.phase ?? "stopped";
  if (
    activeTab === "workspace" &&
    (runtimePhase === "failed" || runtimePhase === "unsupported")
  ) {
    const guidance = document.createElement("section");
    guidance.className = "rogatio-runtime-guidance";
    guidance.dataset.runtimeGuidance = "true";
    const guidanceTitle = document.createElement("h2");
    guidanceTitle.textContent = "Runtime needs attention";
    const guidanceError = document.createElement("p");
    guidanceError.className = "rogatio-runtime-guidance-error";
    guidanceError.textContent = state.nativeRuntimeError
      ? `Error: ${state.nativeRuntimeError}`
      : `Status: ${runtimeStatusText()}`;
    const guidanceFix = document.createElement("p");
    guidanceFix.textContent = runtimeRecoveryText();
    guidance.append(guidanceTitle, guidanceError, guidanceFix);
    if (runtimePhase === "failed") {
      const id = extensionId();
      const cmd = id.length > 0 ? runtimeInstallCommand(id) : installCommand;
      if (cmd) {
        const installCommandRow = document.createElement("div");
        installCommandRow.className = "rogatio-install-command";
        const guidanceCommand = document.createElement("code");
        guidanceCommand.dataset.runtimeInstallCommand = "true";
        guidanceCommand.textContent = cmd;
        const copyInstall = button("⧉", "copy-install-command");
        copyInstall.className = "rogatio-copy-icon";
        copyInstall.setAttribute("aria-label", "Copy install command");
        copyInstall.title = "Copy install command";
        installCommandRow.append(guidanceCommand, copyInstall);
        guidance.append(installCommandRow);
      }
    }
    main.append(guidance);
  }

  if (activeTab === "dashboard") {
    renderOverview(main);
  } else {
    const editorRoot = document.createElement("div");
    editorRoot.dataset.editorRoot = "true";
    main.append(editorRoot);
  }
  layout.append(main);
  shell.append(layout);
  root.append(shell);

  // Render diagnostics modal if open
  if (diagnosticsOpen && diagnosticsData) {
    renderDiagnosticsModal(root);
  }

  // Tab switching
  shell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const ruleLink = target.closest<HTMLAnchorElement>("[data-rule-link]");
    if (ruleLink) {
      // Only take over a plain primary click. A modifier or non-primary click
      // must keep its native meaning, otherwise ctrl/cmd+click and shift+click
      // stop opening a new tab and the entry is not actually a link.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      const groupId = ruleLink.dataset.groupId ?? "";
      const ruleId = ruleLink.dataset.ruleId ?? "";
      if (groupId.length === 0 || ruleId.length === 0) return;
      // Selecting a rule is the one control that both navigates and, when the
      // rule failed, shows its install reason. Clear the previous selection so
      // the card never describes a different rule than the one on screen.
      selectedErrorRule =
        text(statusForRule(groupId, ruleId), "") === "error"
          ? { groupId, ruleId }
          : null;
      navigateToRuleDeepLink(groupId, ruleId, { push: true });
      return;
    }
    const tab = target.dataset.tab;
    if (tab === "dashboard" || tab === "workspace") {
      activeTab = tab;
      renderShell();
      return;
    }
    const commandTarget = target.closest<HTMLElement>("[data-command]");
    const command = commandTarget?.dataset.command;
    if (command === "refresh") void refresh();
    if (command === "switch") void switchProject();
    if (command === "create") void createProject();
    if (command === "import") importInput().click();
    if (command === "ai-generate") openAIComposer();
    if (command === "ai-cancel") cancelAIComposer();
    if (command === "ai-create") void createGeneratedProject();
    if (command === "copy-install-command") void copyInstallCommand();
    if (command === "copy-extension-id") void copyExtensionId();
    if (command === "start-native-runtime")
      void nativeRuntimeCommand("start-native-runtime");
    if (command === "stop-native-runtime")
      void nativeRuntimeCommand("stop-native-runtime");
    if (command === "show-diagnostics") void showDiagnostics();
    if (command === "export" || command === "remove") {
      // Project details actions belong to the open project. A dashboard
      // selection that has not been switched must not redirect them.
      const fromDetails =
        commandTarget?.closest("[data-project-actions]") != null;
      if (!fromDetails) {
        const projectId = target.dataset.projectAction ?? pendingProjectId;
        if (projectId) pendingProjectId = projectId;
      }
      const explicit = fromDetails ? (state.activeProjectId ?? "") : undefined;
      if (command === "export") void exportProject(explicit);
      if (command === "remove") void removeProject(explicit);
    }
  });

  const aiForm = shell.querySelector<HTMLFormElement>("[data-ai-form]");
  aiForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt =
      aiForm.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
    void generateProject(prompt);
  });

  const selector = shell.querySelector<HTMLSelectElement>(
    "[data-project-selector]",
  );
  selector?.addEventListener("change", () => {
    pendingProjectId = selector.value;
    statusMessage = `Selected ${text(
      state.projects[pendingProjectId]?.name,
      pendingProjectId ?? "",
    )}. Choose Switch project to activate it.`;
    renderShell();
  });

  const overview = shell.querySelector<HTMLElement>("[data-overview]");
  overview?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const createCardEl = target.closest<HTMLElement>("[data-create-project]");
    if (createCardEl) {
      void createProject();
      return;
    }
    if (target.dataset.command) return; // action buttons handled at shell level
    const card = target.closest<HTMLElement>("[data-project-card]");
    if (!card?.dataset.projectId) return;
    if (card.dataset.projectId === state.activeProjectId) {
      activeTab = "workspace";
      renderShell();
      return;
    }
    pendingProjectId = card.dataset.projectId;
    await switchProject();
    activeTab = "workspace";
    statusMessage = `Opened ${text(
      state.projects[pendingProjectId]?.name,
      pendingProjectId,
    )}.`;
    renderShell();
  });

  const importControl = shell.querySelector<HTMLInputElement>(
    "[data-import-input]",
  );
  importControl?.addEventListener(
    "change",
    () => void importProject(importControl),
  );
  if (activeTab === "workspace" && ids().length > 0) {
    const editorRoot = shell.querySelector<HTMLElement>("[data-editor-root]");
    if (editorRoot) {
      editor = createEditor({
        root: editorRoot,
        initialProject: safeProjectData(),
        validate(value) {
          const result = validateProjectDetailed(value);
          if (result.valid) return [];
          return result.errors.map((error) => ({
            code: `schema.${error.keyword}`,
            severity: "error" as const,
            path: error.instancePath,
            message: error.message ?? "The project contains invalid data.",
          }));
        },
        save: async (draft) => {
          if (!state.activeProjectId)
            return { ok: false, code: "extension.not-found" };
          const response = await client.send({
            version: 1,
            command: "save-project",
            projectId: state.activeProjectId,
            expectedRevision: state.projects[state.activeProjectId]?.revision,
            data: draft,
          });
          if (response?.ok === true) {
            await refresh();
            return { ok: true };
          }
          return {
            ok: false,
            code: response?.diagnostic?.code ?? "extension.storage-failed",
            message:
              response?.diagnostic?.code === "extension.conflict"
                ? "The committed project changed. Refresh before saving."
                : "The project could not be saved.",
          };
        },
        dryRun: async (draft, cases, options) => {
          const response = await client.send({
            version: 1,
            command: "dry-run",
            project: draft,
            cases,
            options,
          });
          if (response?.ok === true && isDryRunValue(response.value)) {
            return response.value;
          }
          return {
            ok: false as const,
            diagnostics: dryRunDiagnostics(response),
          };
        },
        ...(aiSupported
          ? {
              aiAssist: async (request: AIAssistRequest) => {
                const response = await client.send({
                  version: 1,
                  command: "ai-assist",
                  kind: request.kind,
                  prompt: request.prompt,
                  context: request.context,
                });
                if (response?.ok !== true || !response.value) {
                  throw new Error(
                    response?.diagnostic?.code
                      ? `AI Assist failed (${response.diagnostic.code}).`
                      : "AI Assist failed.",
                  );
                }
                const value = response.value as { proposal?: AIProposal };
                if (!value.proposal) {
                  throw new Error("AI Assist returned no proposal.");
                }
                return { proposal: value.proposal };
              },
            }
          : {}),
        groupEnablement: {
          isEnabled(groupId) {
            return activeEnabledGroupIds().includes(groupId);
          },
          setEnabled(groupId, enabled) {
            return setGroupEnabled(groupId, enabled);
          },
        },
        projectActions: [
          { command: "refresh", label: "Refresh" },
          { command: "export", label: "Export project" },
          { command: "remove", label: "Remove project", tone: "danger" },
        ],
      });
      // The URL is the source of truth for the destination, so a remount must
      // not silently drop it. But only the *first* mount reveals and focuses the
      // rule: a later remount is a rebuild (a group toggle, a refresh, a tab
      // switch), not navigation, and re-running the reveal would yank the
      // viewport back to a rule the user had already scrolled away from. The
      // route still comes from the URL, so the user stays where they were.
      const deepLink = readRuleDeepLink();
      if (deepLink) {
        const firstMount = !editorHasMounted;
        editorHasMounted = true;
        if (deepLink.ruleId.length > 0 && firstMount) {
          editor.navigateToRule(deepLink.groupId, deepLink.ruleId);
        } else {
          editor.navigateToGroup(deepLink.groupId);
        }
      } else {
        editorHasMounted = true;
      }
    }
  }

  restoreSidebarFocus(capturedFocus);
}

function openAIComposer(): void {
  if (!aiSupported) return;
  aiPromptOpen = true;
  aiPreview = null;
  aiMessage = "";
  renderShell();
  root.querySelector<HTMLTextAreaElement>("#rogatio-ai-prompt")?.focus();
}

function cancelAIComposer(): void {
  aiPromptOpen = false;
  aiBusy = false;
  aiPreview = null;
  aiMessage = "";
  renderShell();
}

async function generateProject(prompt: string): Promise<void> {
  aiBusy = true;
  aiMessage = "";
  renderShell();
  const response = await client.send({
    version: 1,
    command: "generate-project",
    prompt,
  });
  aiBusy = false;
  if (response.ok === true && response.value !== undefined) {
    aiPreview = response.value;
    aiMessage = "Review the safe preview before saving it.";
  } else {
    aiMessage =
      "AI could not generate a valid project. Check the runtime and try again.";
  }
  renderShell();
}

async function createGeneratedProject(): Promise<void> {
  if (aiPreview === null) return;
  const response = await client.send({
    version: 1,
    command: "import-project",
    data: aiPreview,
  });
  if (response.ok === true) {
    statusMessage = "AI project created.";
    aiPromptOpen = false;
    aiPreview = null;
    aiMessage = "";
  } else {
    aiMessage = "The generated project could not be saved.";
  }
  await refresh();
}

function importInput(): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>("[data-import-input]");
  if (input) return input;
  const created = document.createElement("input");
  created.type = "file";
  created.hidden = true;
  created.dataset.importInput = "true";
  created.addEventListener("change", () => void importProject(created));
  root.append(created);
  return created;
}

function ids(): readonly string[] {
  return Object.keys(state.projects).sort();
}

function isProjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function createProject(): Promise<void> {
  const name = window.prompt("Project name", "New Rogatio project")?.trim();
  if (!name) return;
  const response = await client.send({
    version: 1,
    command: "create-project",
    data: { version: PROJECT_VERSION, name, groups: [] },
  });
  statusMessage =
    response.ok === true
      ? "Project created."
      : "The project could not be created.";
  await refresh();
}

async function importProject(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as unknown;
    const rejection = projectImportFailure(data);
    if (rejection !== null) {
      statusMessage = rejection;
    } else {
      const response = await client.send({
        version: 1,
        command: "import-project",
        data,
      });
      statusMessage =
        response.ok === true
          ? "Project imported."
          : "The project could not be imported.";
    }
  } catch {
    statusMessage = "The selected file is not valid JSON.";
  }
  await refresh();
}

async function setGroupEnabled(
  groupId: string,
  enabled: boolean,
): Promise<void> {
  if (!state.activeProjectId || !groupId) return;
  const response = await client.send({
    version: 1,
    command: "set-group-enabled",
    projectId: state.activeProjectId,
    groupId,
    enabled,
  });
  statusMessage =
    response.ok === true
      ? enabled
        ? "Group enabled."
        : "Group disabled."
      : enabled
        ? "The group could not be enabled."
        : "The group could not be disabled.";
  await refresh({
    remountEditor: shouldRemountEditorAfterGroupEnablement(),
  });
}

async function nativeRuntimeCommand(
  command: "start-native-runtime" | "stop-native-runtime",
): Promise<void> {
  const response = await client.send({ version: 1, command });
  const code = response?.diagnostic?.code;
  const responseParams = response?.diagnostic as
    | { readonly params?: Readonly<Record<string, unknown>> }
    | undefined;
  const responseReason =
    typeof responseParams?.params?.reason === "string"
      ? responseParams.params.reason
      : null;
  installCommand = null;
  if (response?.ok === true) {
    statusMessage =
      command === "start-native-runtime"
        ? "Runtime started."
        : "Runtime stopped.";
  } else if (code === "extension.native-host-origin-forbidden") {
    const id = extensionId();
    installCommand = runtimeInstallCommand(id);
    statusMessage = nativeHostOriginMismatchMessage(id);
  } else if (
    code === "extension.native-host-missing" ||
    code === "extension.request-body-needs-trust"
  ) {
    const id = extensionId();
    if (id.length > 0) {
      installCommand = runtimeInstallCommand(id);
    } else {
      installCommand = null;
    }
    statusMessage =
      code === "extension.native-host-missing"
        ? "The native runtime host is not installed on this device. Run the install command below once in a terminal, then restart Chrome and click Start runtime again. If you just ran install, try restarting Chrome first."
        : "Request-body rules need the device-local CA trusted on this device. Run the install command below to register the host and (on capable platforms) trust the device-local CA, then restart Chrome and click Start runtime again. Mocks and response-body rules do not need trust.";
  } else if (code === "extension.native-runtime-unavailable") {
    statusMessage = "Runtime action unavailable on this platform.";
  } else {
    statusMessage = [
      "The runtime action failed.",
      responseReason ? `Runtime error: ${responseReason}` : "",
      "Open Show diagnostics for details.",
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }
  await refresh();
  if (
    response?.ok !== true &&
    state.nativeRuntimeError &&
    code !== "extension.native-host-origin-forbidden"
  ) {
    statusMessage = [
      "The runtime action failed.",
      `Runtime error: ${state.nativeRuntimeError}`,
      "Fix: run the install command if the host is missing, then reload the extension and restart Chrome.",
    ].join(" ");
    renderShell();
  }
}

async function copyInstallCommand(): Promise<void> {
  const id = extensionId();
  const phase = state.nativeRuntimeState?.phase ?? "stopped";
  const cmd =
    installCommand ??
    (phase === "failed" && id.length > 0 ? runtimeInstallCommand(id) : null);
  if (!cmd) return;
  statusMessage = (await copyText(cmd))
    ? "Install command copied. Paste it in a terminal, run it, then click Start runtime again."
    : "Copying failed. Select the command text and copy it manually.";
  await refresh();
}

async function copyExtensionId(): Promise<void> {
  const id = extensionId();
  if (!id) {
    statusMessage = "The extension ID is unavailable.";
    renderShell();
    return;
  }
  statusMessage = (await copyText(id))
    ? "Extension ID copied to clipboard."
    : "Copying failed. Select the extension ID and copy it manually.";
  renderShell();
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API can be unavailable in some contexts; fall back to a
    // selection-based copy on a temporary textarea.
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

async function checkNativeAISupport(): Promise<void> {
  try {
    const response = await client.send({
      version: 1,
      command: "check-ai-support",
    });
    const value =
      response?.ok === true &&
      typeof response.value === "object" &&
      response.value !== null
        ? (response.value as {
            supported?: unknown;
            reported?: unknown;
            providerUrl?: unknown;
            model?: unknown;
          })
        : null;
    const reported = value?.reported === true;
    const providerUrl = value?.providerUrl;
    const model = value?.model;
    if (
      reported &&
      value?.supported === true &&
      typeof providerUrl === "string" &&
      providerUrl.length > 0 &&
      typeof model === "string" &&
      model.length > 0
    ) {
      aiSupported = true;
      aiReported = true;
      // Copy the two display strings only; nothing else from the response
      // reaches the DOM.
      aiProvider = { url: providerUrl, model };
    } else if (reported && value?.supported === true) {
      // Partial metadata is non-conforming: "not reported", never a
      // half-populated card (spec REQ-007).
      aiSupported = false;
      aiReported = false;
      aiProvider = null;
    } else {
      aiSupported = false;
      aiReported = reported;
      aiProvider = null;
    }
    aiStatusChecked = true;
  } catch {
    aiSupported = false;
    aiReported = false;
    aiProvider = null;
    aiStatusChecked = true;
  }
}

async function showDiagnostics(): Promise<void> {
  const response = await client.send({
    version: 1,
    command: "diagnose-native-runtime",
  });
  if (response?.ok === true && response.value) {
    diagnosticsData = response.value as {
      phase: string;
      extensionId: string | null;
      hostName: string;
      chromeError: string | null;
      runtimeError: string | null;
      connectNativeAvailable: boolean;
      timestamp: number;
    };
    diagnosticsOpen = true;
  }
  renderShell();
}

function formatDiagnosticsText(): string {
  if (!diagnosticsData) return "";
  const lines = [
    `Phase: ${diagnosticsData.phase}`,
    `Extension ID: ${diagnosticsData.extensionId ?? "unknown"}`,
    `Host name: ${diagnosticsData.hostName}`,
    `connectNative available: ${diagnosticsData.connectNativeAvailable}`,
    `Chrome error: ${diagnosticsData.chromeError ?? "none"}`,
    `Runtime error: ${diagnosticsData.runtimeError ?? "none"}`,
    `Timestamp: ${new Date(diagnosticsData.timestamp).toISOString()}`,
  ];
  return lines.join("\n");
}

async function copyDiagnostics(): Promise<void> {
  const text = formatDiagnosticsText();
  if (!text) return;
  const ok = await copyText(text);
  statusMessage = ok
    ? "Diagnostics copied to clipboard."
    : "Copying failed. Select the text and copy manually.";
  renderShell();
}

function renderDiagnosticsModal(container: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.className = "rogatio-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "rogatio-modal";

  const header = document.createElement("div");
  header.className = "rogatio-modal-header";
  const title = document.createElement("h3");
  title.textContent = "Runtime Diagnostics";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "\u00d7";
  closeBtn.className = "rogatio-modal-close";
  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "rogatio-modal-body";
  if (diagnosticsData) {
    const table = document.createElement("div");
    table.className = "rogatio-diag-table";
    const row = (label: string, value: string) => {
      const r = document.createElement("div");
      r.className = "rogatio-diag-row";
      const l = document.createElement("span");
      l.className = "rogatio-diag-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "rogatio-diag-value";
      v.textContent = value;
      r.append(l, v);
      return r;
    };
    table.append(
      row("Phase", diagnosticsData.phase),
      row("Extension ID", diagnosticsData.extensionId ?? "unknown"),
      row("Host name", diagnosticsData.hostName),
      row(
        "connectNative",
        diagnosticsData.connectNativeAvailable ? "available" : "missing",
      ),
      row("Chrome error", diagnosticsData.chromeError ?? "none"),
      row("Runtime error", diagnosticsData.runtimeError ?? "none"),
    );
    const hint = document.createElement("p");
    hint.className = "rogatio-diag-hint";
    hint.textContent =
      "If the error mentions a missing host, file, or permission, copy the extension ID, run the install command, reload the extension, and restart Chrome.";
    body.append(table, hint);
  }

  const footer = document.createElement("div");
  footer.className = "rogatio-modal-footer";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy diagnostics";
  const closeFooterBtn = document.createElement("button");
  closeFooterBtn.type = "button";
  closeFooterBtn.textContent = "Close";
  footer.append(copyBtn, closeFooterBtn);

  modal.append(header, body, footer);
  overlay.append(modal);
  container.append(overlay);

  // Direct listeners — the overlay is a sibling of shell, not a child, so
  // the shell delegated click handler cannot reach these elements.
  function closeModal(): void {
    diagnosticsOpen = false;
    renderShell();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  closeFooterBtn.addEventListener("click", closeModal);
  copyBtn.addEventListener("click", () => void copyDiagnostics());
}

async function loadMatchLoggingEnabled(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(MATCH_LOGGING_ENABLED_KEY);
    matchLoggingEnabled = readMatchLoggingEnabledFromStorageResult(result);
  } catch {
    matchLoggingEnabled = false;
  }
}

async function refresh(
  options: { readonly remountEditor?: boolean } = {},
): Promise<void> {
  await loadMatchLoggingEnabled();
  const response = await client.send({ version: 1, command: "refresh" });
  if (response?.ok !== true || !response.value) {
    statusMessage = "The project state could not be refreshed.";
    if (options.remountEditor === false) {
      patchWorkspaceEnablementChrome();
      return;
    }
    renderShell();
    return;
  }
  const previousActiveProjectId = state.activeProjectId;
  state = response.value as Envelope;
  const activeProjectChanged =
    previousActiveProjectId !== state.activeProjectId;
  if (activeProjectChanged) {
  }
  if (pendingProjectId && !Object.hasOwn(state.projects, pendingProjectId))
    pendingProjectId = state.activeProjectId;

  const previousAiSupported = aiSupported;
  // Check AI support when runtime is running
  if (state.nativeRuntimeState?.phase === "started") {
    await checkNativeAISupport();
  } else {
    aiSupported = false;
    aiStatusChecked = false;
    aiReported = false;
    aiProvider = null;
  }
  const aiSupportChanged = previousAiSupported !== aiSupported;

  // Never soft-patch across an active-project change: the mounted draft belongs
  // to the previous project and must not be saved against the new active id.
  // Also remount when AI Assist availability flips so Workspace gets/loses aiAssist.
  if (
    options.remountEditor === false &&
    !activeProjectChanged &&
    !aiSupportChanged
  ) {
    patchWorkspaceEnablementChrome();
    return;
  }
  renderShell();
}

async function switchProject(): Promise<void> {
  if (!pendingProjectId || pendingProjectId === state.activeProjectId) return;
  const response = await client.send({
    version: 1,
    command: "switch-project",
    projectId: pendingProjectId,
  });
  if (response?.ok !== true) {
    statusMessage =
      response?.diagnostic?.code === "extension.conflict"
        ? "The committed project changed. Choose Refresh to continue."
        : "The project could not be switched. Refresh and try again.";
    renderShell();
    return;
  }
  statusMessage = "Project switched.";
  await refresh();
}

async function exportProject(explicitId?: string): Promise<void> {
  const projectId = explicitId ?? pendingProjectId ?? state.activeProjectId;
  if (!projectId) return;
  const response = await client.send({
    version: 1,
    command: "export-project",
    projectId,
  });
  if (response?.ok !== true) {
    statusMessage = "The project could not be exported.";
    renderShell();
    return;
  }
  const contents = JSON.stringify(response.value, null, 2);
  try {
    const result = await saveExportedProject({
      contents,
      showSaveFilePicker: saveFilePicker(),
      promptFilename: (suggested) =>
        window.prompt("Save project as", suggested),
      download: downloadProjectFile,
    });
    if (result.status === "cancelled") return;
    statusMessage = "Project exported.";
  } catch {
    statusMessage = "The project could not be exported.";
  }
  renderShell();
}

function saveFilePicker(): ShowSaveFilePicker | undefined {
  const candidate = (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker;
  if (typeof candidate !== "function") return undefined;
  const picker = candidate as (
    this: typeof window,
    options?: SaveFilePickerOptions,
  ) => ReturnType<ShowSaveFilePicker>;
  return (options) => picker.call(window, options);
}

function downloadProjectFile(contents: string, filename: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function removeProject(explicitId?: string): Promise<void> {
  const projectId = explicitId ?? pendingProjectId ?? state.activeProjectId;
  if (!projectId) return;
  const name = text(state.projects[projectId]?.name, projectId);
  if (!window.confirm(`Remove project ${name}?`)) return;
  const response = await client.send({
    version: 1,
    command: "remove-project",
    projectId,
    confirm: true,
  });
  if (response?.ok !== true) {
    statusMessage = "The project could not be removed.";
    renderShell();
    return;
  }
  pendingProjectId = null;
  statusMessage = `Project ${name} removed.`;
  await refresh();
}

// Deep links from the popup and from a copied rule URL open the workspace
// editor at a group or a rule.
if (readRuleDeepLink()) activeTab = "workspace";

// Browser Back and Forward after an in-page rule navigation. Resolving without
// pushing keeps history from growing. Both directions reconcile the active tab
// from the URL so Back and Forward behave symmetrically: a rule link means
// Workspace, and no rule link means the view is left alone rather than silently
// changing underneath the user.
window.addEventListener("popstate", () => {
  const link = readRuleDeepLink();
  if (link === null) {
    if (activeTab !== "workspace") return;
    editor?.navigateToGroup(null);
    patchWorkspaceEnablementChrome();
    return;
  }
  navigateToRuleDeepLink(link.groupId, link.ruleId, { push: false });
});

void refresh();
