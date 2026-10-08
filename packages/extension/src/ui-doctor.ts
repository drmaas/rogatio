/**
 * Browser-side doctor checks. The service worker fills the facts. The popup
 * and the management page render the result. This module does not import the
 * runtime package or dry-run.
 */

import { type DoctorReport, parseDoctorReport } from "./doctor-report.js";
import {
  isNativeHostOriginForbiddenMessage,
  RELEASE_EXTENSION_ID,
  runtimeInstallCommand,
} from "./extension-id.js";

export const EXTENSION_UI_CHECK_IDS = [
  "ext.worker",
  "ext.native",
  "ext.id",
  "ext.version",
  "ext.proxy",
  "ext.access",
  "ext.rules",
  "ext.incognito",
  "ext.tab",
] as const;

export type ExtensionUiCheckId = (typeof EXTENSION_UI_CHECK_IDS)[number];

export type DoctorStatus = "pass" | "warn" | "fail";

export const EXTENSION_UI_TITLES: Record<ExtensionUiCheckId, string> = {
  "ext.worker": "Service worker",
  "ext.native": "Native connection",
  "ext.id": "Extension ID",
  "ext.version": "Version",
  "ext.proxy": "Proxy",
  "ext.access": "Site access",
  "ext.rules": "Rules",
  "ext.incognito": "Incognito",
  "ext.tab": "Current tab",
};

export const EXT_WORKER_FAIL_SUMMARY =
  "The extension service worker did not answer.";
export const EXT_WORKER_FIX = "Reload the extension at chrome://extensions";
export const EXT_WORKER_PASS_SUMMARY = "The extension service worker answered.";

export const EXT_NATIVE_MISSING_SUMMARY =
  "Native host manifest was not found. Reload the extension after installing the host.";
export const EXT_NATIVE_ORIGIN_SUMMARY =
  "This extension ID is not in the native host manifest allowed_origins. Reload the extension after installing the host.";
export const EXT_NATIVE_TIMEOUT_SUMMARY =
  "The native host did not answer within 25000ms.";
export const EXT_NATIVE_DISCONNECTED_SUMMARY =
  "The native host disconnected before answering.";
export const EXT_NATIVE_UNREADABLE_SUMMARY =
  "The native host reply could not be read.";
export const EXT_NATIVE_PASS_SUMMARY = "The native host answered.";
export const EXT_NATIVE_DOCTOR_FIX = "rogatio doctor";
export const EXT_NATIVE_TIMEOUT_MESSAGE =
  "Native messaging host timed out before responding.";

export const EXT_PROXY_OTHER_SUMMARY = "Another extension controls the proxy.";
export const EXT_PROXY_OTHER_FIX =
  "Disable the other proxy/VPN extension, then click Start runtime.";
export const EXT_PROXY_POLICY_SUMMARY = "The proxy is set by policy.";
export const EXT_PROXY_ABSENT_SUMMARY =
  "Runtime is started, but this extension does not control the proxy.";
export const EXT_PROXY_ABSENT_FIX = "Click Stop runtime, then Start runtime.";
export const EXT_PROXY_OURS_SUMMARY = "This extension controls the proxy.";
export const EXT_PROXY_STALE_SUMMARY =
  "A Rogatio PAC script is still set after the runtime stopped.";
export const EXT_PROXY_STALE_FIX = "Click Start runtime, then Stop runtime.";
export const EXT_PROXY_CLEAR_SUMMARY =
  "Chrome proxy settings do not block Rogatio.";
export const EXT_PROXY_UNAVAILABLE_SUMMARY =
  "Chrome proxy settings could not be read.";

export const EXT_ACCESS_PASS_SUMMARY = "Site access includes all sites.";
export const EXT_ACCESS_NARROW_SUMMARY =
  "Site access is narrower than all sites.";
export const EXT_ACCESS_FIX =
  "chrome://extensions → Rogatio → Site access → On all sites";
export const EXT_ACCESS_UNKNOWN_SUMMARY = "Site access could not be checked.";

export const EXT_INCOGNITO_PASS_SUMMARY = "Incognito access is allowed.";
export const EXT_INCOGNITO_WARN_SUMMARY =
  "Incognito windows are not covered. The PAC is installed for regular windows only.";
export const EXT_INCOGNITO_FIX =
  "chrome://extensions → Rogatio → Allow in Incognito";
export const EXT_INCOGNITO_UNKNOWN_SUMMARY =
  "Incognito access could not be checked.";

export const EXT_RULES_NONE_SUMMARY = "No active project is loaded.";
export const EXT_RULES_UNREADABLE_SUMMARY = "Rule statuses could not be read.";
export const EXT_RULES_NO_GROUPS_SUMMARY =
  "The active project has no enabled groups.";
export const EXT_RULES_NO_GROUPS_FIX = "Enable a group.";
export const EXT_RULES_OK_SUMMARY = "Enabled rules have no attention status.";
export const EXT_RULES_ERROR_FIX = "Open the rule and read its error.";
export const EXT_RULES_RUNTIME_FIX = "Click Start runtime.";
export const EXT_RULES_UNROUTABLE_FIX = "This rule's source can't be routed.";
export const EXT_RULES_ROOT_FIX = "Set mock file root.";
export const EXT_RULES_UNSUPPORTED_FIX =
  "This rule is unsupported in this browser.";

export const EXT_TAB_NO_URL_SUMMARY =
  "The current tab has no URL this extension can read.";
export const EXT_TAB_UNCHECKED_SUMMARY =
  "The current tab could not be checked.";
export const EXT_TAB_EMPTY_SUMMARY = "No rules to compare with this tab.";

export const EXT_VERSION_UNAVAILABLE_SUMMARY = "CLI version is unavailable.";
export const EXT_VERSION_UNCOMPARED_SUMMARY =
  "Extension and CLI versions could not be compared.";

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const EXACT_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SAFE_RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ATTENTION_STATUSES = [
  "error",
  "needs runtime",
  "needs root directory",
  "unsupported",
] as const;
const TAB_LIMIT = 12;

export type NativeConnectCode =
  | "ok"
  | "host-missing"
  | "origin-forbidden"
  | "timeout"
  | "disconnected"
  | "unreadable";

export type ProxyLevel =
  | "not_controllable"
  | "controlled_by_other_extensions"
  | "controllable_by_this_extension"
  | "controlled_by_this_extension";

export type ProxyMode =
  | "pac_script"
  | "direct"
  | "auto_detect"
  | "fixed_servers"
  | "system";

export interface ProxySnapshot {
  readonly available: boolean;
  readonly levelOfControl: ProxyLevel | null;
  readonly mode: ProxyMode | null;
}

export type MatchStateWord = "matched" | "unmatched" | "not-applicable";

export interface TabRuleFact {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly source: MatchStateWord;
  readonly method: MatchStateWord;
  readonly resourceType: MatchStateWord;
  readonly groupEnabled: boolean;
  readonly status: string | null;
}

export type TabFacts =
  | { readonly kind: "unavailable" }
  | { readonly kind: "unchecked" }
  | { readonly kind: "checked"; readonly rules: readonly TabRuleFact[] };

export interface RuleStatusFact {
  readonly ruleId: string;
  readonly status: string;
}

export interface ExtensionDoctorFacts {
  readonly workerReached: boolean;
  readonly extensionId: string;
  readonly extensionVersion: string | null;
  readonly cliVersion: string | null;
  readonly native: NativeConnectCode;
  readonly phase: string;
  readonly proxy: ProxySnapshot;
  readonly siteAccess: boolean | null;
  readonly incognito: boolean | null;
  readonly activeProject: boolean;
  readonly rulesReadable: boolean;
  readonly enabledGroupCount: number;
  readonly statuses: readonly RuleStatusFact[];
  readonly tab: TabFacts | null;
  readonly host: DoctorReport | null;
}

export interface UiDoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly optional: boolean;
  readonly summary: string;
  readonly fix: string | null;
}

export interface CombinedDiagnostics {
  readonly version: 1;
  readonly surface: "extension" | "editor";
  readonly ok: boolean;
  readonly ui: { readonly checks: readonly UiDoctorCheck[] };
  readonly host: DoctorReport | null;
}

export function exactDoctorVersion(value: string): string | null {
  return EXACT_VERSION_RE.test(value) ? value : null;
}

function classifyOne(message: string | null): NativeConnectCode | null {
  if (message === null || message.length === 0) return null;
  if (message === "extension.native-host-missing") return "host-missing";
  if (message === "extension.native-host-origin-forbidden") {
    return "origin-forbidden";
  }
  if (message === EXT_NATIVE_TIMEOUT_MESSAGE) return "timeout";
  if (message === "Native messaging host disconnected before responding.") {
    return "disconnected";
  }
  if (isNativeHostOriginForbiddenMessage(message)) return "origin-forbidden";
  const lower = message.toLowerCase();
  if (
    lower.includes("specified native messaging host not found") ||
    lower.includes("native messaging host not found")
  ) {
    return "host-missing";
  }
  return null;
}

/** Map a connect failure to a code. The original text is not returned. */
export function classifyNativeFailure(
  primary: string | null,
  secondary: string | null = null,
): NativeConnectCode {
  return classifyOne(primary) ?? classifyOne(secondary) ?? "disconnected";
}

export function cliVersionFromMetadata(metadata: unknown): string | null {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  if (!Object.hasOwn(metadata, "cliVersion")) return null;
  const value = (metadata as { cliVersion?: unknown }).cliVersion;
  return typeof value === "string" ? exactDoctorVersion(value) : null;
}

function check(
  id: ExtensionUiCheckId,
  status: DoctorStatus,
  optional: boolean,
  summary: string,
  fix: string | null,
): UiDoctorCheck {
  return { id, status, optional, summary, fix };
}

function workerUnreachableCheck(): UiDoctorCheck {
  return check(
    "ext.worker",
    "fail",
    false,
    EXT_WORKER_FAIL_SUMMARY,
    EXT_WORKER_FIX,
  );
}

export function workerUnreachableDiagnostics(): CombinedDiagnostics {
  return combined("extension", [workerUnreachableCheck()], null);
}

function combined(
  surface: "extension" | "editor",
  checks: readonly UiDoctorCheck[],
  host: DoctorReport | null,
): CombinedDiagnostics {
  const uiFailed = checks.some(
    (item) => item.status === "fail" && item.optional === false,
  );
  const hostOk = host === null ? true : host.ok;
  return {
    version: 1,
    surface,
    ok: !uiFailed && hostOk,
    ui: { checks },
    host,
  };
}

function compareVersions(left: string, right: string): number {
  const a = EXACT_VERSION_RE.exec(left);
  const b = EXACT_VERSION_RE.exec(right);
  if (a === null || b === null) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const av = Number(a[index]);
    const bv = Number(b[index]);
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function idCheck(extensionId: string): UiDoctorCheck {
  if (extensionId === RELEASE_EXTENSION_ID) {
    return check(
      "ext.id",
      "pass",
      true,
      "This is the release extension.",
      null,
    );
  }
  if (EXTENSION_ID_RE.test(extensionId)) {
    return check(
      "ext.id",
      "warn",
      true,
      `This is a development or fork build (${extensionId}).`,
      null,
    );
  }
  return check("ext.id", "warn", true, "Extension ID is unavailable.", null);
}

/**
 * Global CLI install command for an exact extension version. The scope and
 * the at-sign are joined at runtime so the bundle scan does not see an
 * import specifier. `version` is already major.minor.patch.
 */
function cliInstallFix(version: string): string {
  return [
    "npm install -g ",
    String.fromCharCode(64),
    "rogatio/cli@",
    version,
  ].join("");
}

function versionCheck(
  extensionVersion: string | null,
  cliVersion: string | null,
): UiDoctorCheck {
  const ext =
    extensionVersion === null ? null : exactDoctorVersion(extensionVersion);
  const cli = cliVersion === null ? null : exactDoctorVersion(cliVersion);
  if (cli === null && ext !== null) {
    return check(
      "ext.version",
      "warn",
      true,
      EXT_VERSION_UNAVAILABLE_SUMMARY,
      null,
    );
  }
  if (ext === null || cli === null) {
    return check(
      "ext.version",
      "warn",
      true,
      EXT_VERSION_UNCOMPARED_SUMMARY,
      null,
    );
  }
  const compared = compareVersions(ext, cli);
  if (compared === 0) {
    return check(
      "ext.version",
      "pass",
      true,
      `Extension ${ext} matches CLI ${cli}.`,
      null,
    );
  }
  if (compared > 0) {
    return check(
      "ext.version",
      "warn",
      true,
      `CLI ${cli} is older than extension ${ext}.`,
      cliInstallFix(ext),
    );
  }
  return check(
    "ext.version",
    "warn",
    true,
    `Extension ${ext} is older than CLI ${cli}.`,
    `Install the Rogatio extension release that matches CLI ${cli}.`,
  );
}

function nativeCheck(
  code: NativeConnectCode,
  extensionId: string,
): UiDoctorCheck {
  if (code === "ok") {
    return check("ext.native", "pass", false, EXT_NATIVE_PASS_SUMMARY, null);
  }
  if (code === "host-missing") {
    return check(
      "ext.native",
      "fail",
      false,
      EXT_NATIVE_MISSING_SUMMARY,
      runtimeInstallCommand(extensionId),
    );
  }
  if (code === "origin-forbidden") {
    return check(
      "ext.native",
      "fail",
      false,
      EXT_NATIVE_ORIGIN_SUMMARY,
      runtimeInstallCommand(extensionId),
    );
  }
  if (code === "timeout") {
    return check(
      "ext.native",
      "fail",
      false,
      EXT_NATIVE_TIMEOUT_SUMMARY,
      EXT_NATIVE_DOCTOR_FIX,
    );
  }
  if (code === "unreadable") {
    return check(
      "ext.native",
      "fail",
      false,
      EXT_NATIVE_UNREADABLE_SUMMARY,
      EXT_NATIVE_DOCTOR_FIX,
    );
  }
  return check(
    "ext.native",
    "fail",
    false,
    EXT_NATIVE_DISCONNECTED_SUMMARY,
    EXT_NATIVE_DOCTOR_FIX,
  );
}

function proxyCheck(phase: string, proxy: ProxySnapshot): UiDoctorCheck {
  if (!proxy.available || proxy.levelOfControl === null) {
    return check(
      "ext.proxy",
      "warn",
      false,
      EXT_PROXY_UNAVAILABLE_SUMMARY,
      null,
    );
  }
  const blockingPhase = phase === "started" || phase === "failed";
  if (
    blockingPhase &&
    proxy.levelOfControl === "controlled_by_other_extensions"
  ) {
    return check(
      "ext.proxy",
      "fail",
      false,
      EXT_PROXY_OTHER_SUMMARY,
      EXT_PROXY_OTHER_FIX,
    );
  }
  if (blockingPhase && proxy.levelOfControl === "not_controllable") {
    return check("ext.proxy", "fail", false, EXT_PROXY_POLICY_SUMMARY, null);
  }
  if (
    phase === "started" &&
    proxy.levelOfControl === "controllable_by_this_extension"
  ) {
    return check(
      "ext.proxy",
      "fail",
      false,
      EXT_PROXY_ABSENT_SUMMARY,
      EXT_PROXY_ABSENT_FIX,
    );
  }
  if (
    phase === "started" &&
    proxy.levelOfControl === "controlled_by_this_extension"
  ) {
    return check("ext.proxy", "pass", false, EXT_PROXY_OURS_SUMMARY, null);
  }
  if (
    phase === "stopped" &&
    proxy.levelOfControl === "controlled_by_this_extension" &&
    proxy.mode === "pac_script"
  ) {
    return check(
      "ext.proxy",
      "warn",
      false,
      EXT_PROXY_STALE_SUMMARY,
      EXT_PROXY_STALE_FIX,
    );
  }
  return check("ext.proxy", "pass", false, EXT_PROXY_CLEAR_SUMMARY, null);
}

function accessCheck(siteAccess: boolean | null): UiDoctorCheck {
  if (siteAccess === true) {
    return check("ext.access", "pass", false, EXT_ACCESS_PASS_SUMMARY, null);
  }
  if (siteAccess === false) {
    return check(
      "ext.access",
      "warn",
      false,
      EXT_ACCESS_NARROW_SUMMARY,
      EXT_ACCESS_FIX,
    );
  }
  return check("ext.access", "warn", false, EXT_ACCESS_UNKNOWN_SUMMARY, null);
}

function incognitoCheck(allowed: boolean | null): UiDoctorCheck {
  if (allowed === true) {
    return check(
      "ext.incognito",
      "pass",
      true,
      EXT_INCOGNITO_PASS_SUMMARY,
      null,
    );
  }
  if (allowed === false) {
    return check(
      "ext.incognito",
      "warn",
      true,
      EXT_INCOGNITO_WARN_SUMMARY,
      EXT_INCOGNITO_FIX,
    );
  }
  return check(
    "ext.incognito",
    "warn",
    true,
    EXT_INCOGNITO_UNKNOWN_SUMMARY,
    null,
  );
}

function ruleLabel(ruleId: string): string {
  return SAFE_RULE_ID_RE.test(ruleId) ? ruleId : "a rule";
}

function countPhrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function rulesCheck(facts: ExtensionDoctorFacts): UiDoctorCheck {
  if (!facts.activeProject) {
    return check("ext.rules", "warn", false, EXT_RULES_NONE_SUMMARY, null);
  }
  if (!facts.rulesReadable) {
    return check(
      "ext.rules",
      "warn",
      false,
      EXT_RULES_UNREADABLE_SUMMARY,
      null,
    );
  }
  if (facts.enabledGroupCount === 0) {
    return check(
      "ext.rules",
      "warn",
      false,
      EXT_RULES_NO_GROUPS_SUMMARY,
      EXT_RULES_NO_GROUPS_FIX,
    );
  }
  const counts = { error: 0, runtime: 0, root: 0, unsupported: 0 };
  for (const status of facts.statuses) {
    if (status.status === "error") counts.error += 1;
    else if (status.status === "needs runtime") counts.runtime += 1;
    else if (status.status === "needs root directory") counts.root += 1;
    else if (status.status === "unsupported") counts.unsupported += 1;
  }
  const total =
    counts.error + counts.runtime + counts.root + counts.unsupported;
  if (total === 0) {
    return check("ext.rules", "pass", false, EXT_RULES_OK_SUMMARY, null);
  }
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(countPhrase(counts.error, "error", "errors"));
  }
  if (counts.runtime > 0) {
    parts.push(countPhrase(counts.runtime, "needs runtime", "need runtime"));
  }
  if (counts.root > 0) {
    parts.push(
      countPhrase(
        counts.root,
        "needs a mock file root",
        "need a mock file root",
      ),
    );
  }
  if (counts.unsupported > 0) {
    parts.push(countPhrase(counts.unsupported, "unsupported", "unsupported"));
  }
  const blocking = ATTENTION_STATUSES.find((status) =>
    facts.statuses.some((item) => item.status === status),
  );
  const first = facts.statuses.find((item) => item.status === blocking);
  const summary = `${parts.join(", ")}. First problem: ${ruleLabel(first?.ruleId ?? "")} (${blocking ?? "error"}).`;
  const fix =
    blocking === "error"
      ? EXT_RULES_ERROR_FIX
      : blocking === "needs runtime"
        ? facts.phase === "started"
          ? EXT_RULES_UNROUTABLE_FIX
          : EXT_RULES_RUNTIME_FIX
        : blocking === "needs root directory"
          ? EXT_RULES_ROOT_FIX
          : EXT_RULES_UNSUPPORTED_FIX;
  return check(
    "ext.rules",
    blocking === "error" ? "fail" : "warn",
    false,
    summary,
    fix,
  );
}

function stateWord(state: MatchStateWord): string {
  if (state === "not-applicable") return "not tested";
  return state;
}

function attentionStatus(status: string | null): string | null {
  if (status === null) return null;
  return ATTENTION_STATUSES.some((item) => item === status) ? status : null;
}

function tabSummary(rules: readonly TabRuleFact[]): string {
  if (rules.length === 0) return EXT_TAB_EMPTY_SUMMARY;
  const matches: string[] = [];
  const misses: string[] = [];
  const blocked: string[] = [];
  for (const rule of rules) {
    const label = ruleLabel(rule.ruleId);
    const attention = attentionStatus(rule.status);
    if (rule.matched && !rule.groupEnabled) {
      blocked.push(`${label} matches but its group is disabled.`);
      continue;
    }
    if (rule.matched && attention !== null) {
      blocked.push(`${label} matches but its status is ${attention}.`);
      continue;
    }
    if (rule.matched) {
      matches.push(label);
      continue;
    }
    misses.push(
      `${label} (source ${stateWord(rule.source)}, method ${stateWord(rule.method)}, resourceType ${stateWord(rule.resourceType)}).`,
    );
  }
  const parts: string[] = [];
  let named = 0;
  const room = (): number => Math.max(0, TAB_LIMIT - named);
  if (matches.length > 0) {
    const shown = matches.slice(0, room());
    named += shown.length;
    if (shown.length > 0) parts.push(`Matches: ${shown.join(", ")}.`);
  }
  if (misses.length > 0 && room() > 0) {
    const shown = misses.slice(0, room());
    named += shown.length;
    parts.push(`Does not match: ${shown.join(" ")}`);
  }
  if (blocked.length > 0 && room() > 0) {
    const shown = blocked.slice(0, room());
    named += shown.length;
    parts.push(shown.join(" "));
  }
  const hidden = rules.length - named;
  if (hidden > 0) parts.push(`${hidden} more.`);
  return parts.join(" ");
}

function tabCheck(tab: TabFacts): UiDoctorCheck {
  if (tab.kind === "unavailable") {
    return check("ext.tab", "warn", true, EXT_TAB_NO_URL_SUMMARY, null);
  }
  if (tab.kind === "unchecked") {
    return check("ext.tab", "warn", true, EXT_TAB_UNCHECKED_SUMMARY, null);
  }
  return check("ext.tab", "pass", true, tabSummary(tab.rules), null);
}

function acceptedHost(value: unknown): DoctorReport | null {
  const parsed = parseDoctorReport(value);
  if (parsed === null || parsed.checks.length !== 6) return null;
  return parsed;
}

export function buildExtensionDoctor(
  facts: ExtensionDoctorFacts,
): CombinedDiagnostics {
  if (!facts.workerReached) return workerUnreachableDiagnostics();
  const host = facts.native === "ok" ? acceptedHost(facts.host) : null;
  const native =
    host === null && facts.native === "ok" ? "unreadable" : facts.native;
  const checks: UiDoctorCheck[] = [
    check("ext.worker", "pass", false, EXT_WORKER_PASS_SUMMARY, null),
    nativeCheck(native, facts.extensionId),
    idCheck(facts.extensionId),
    versionCheck(
      facts.extensionVersion,
      native === "ok" ? facts.cliVersion : null,
    ),
    proxyCheck(facts.phase, facts.proxy),
    accessCheck(facts.siteAccess),
    rulesCheck(facts),
    incognitoCheck(facts.incognito),
  ];
  if (facts.tab !== null) checks.push(tabCheck(facts.tab));
  return combined("extension", checks, host);
}

interface DryRunRuleLike {
  readonly ruleId?: unknown;
  readonly matched?: unknown;
  readonly source?: { readonly state?: unknown };
  readonly method?: { readonly state?: unknown };
  readonly resourceType?: { readonly state?: unknown };
  readonly groupId?: unknown;
}

function matchState(value: unknown): MatchStateWord {
  if (
    value === "matched" ||
    value === "unmatched" ||
    value === "not-applicable"
  ) {
    return value;
  }
  return "not-applicable";
}

/**
 * Copy match facts and drop the URL. `detail` strings are not read.
 */
export function tabFactsFromDryRun(
  result: unknown,
  enabledGroupIds: readonly string[],
  statuses: readonly RuleStatusFact[],
): TabFacts {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return { kind: "unchecked" };
  }
  const record = result as {
    readonly results?: unknown;
    readonly errors?: unknown;
  };
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return { kind: "unchecked" };
  }
  if (!Array.isArray(record.results) || record.results.length === 0) {
    return { kind: "unchecked" };
  }
  const first = record.results[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return { kind: "unchecked" };
  }
  const rules = (first as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return { kind: "unchecked" };
  const enabled = new Set(enabledGroupIds);
  const statusById = new Map(
    statuses.map((item) => [item.ruleId, item.status]),
  );
  const facts: TabRuleFact[] = [];
  for (const rule of rules) {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      continue;
    }
    const row = rule as DryRunRuleLike;
    const ruleId = typeof row.ruleId === "string" ? row.ruleId : "";
    const groupId = typeof row.groupId === "string" ? row.groupId : "";
    facts.push({
      ruleId,
      matched: row.matched === true,
      source: matchState(row.source?.state),
      method: matchState(row.method?.state),
      resourceType: matchState(row.resourceType?.state),
      groupEnabled: enabled.has(groupId),
      status: statusById.get(ruleId) ?? null,
    });
  }
  return { kind: "checked", rules: facts };
}

function checkValue(item: UiDoctorCheck): UiDoctorCheck {
  return {
    id: item.id,
    status: item.status,
    optional: item.optional,
    summary: item.summary,
    fix: item.fix,
  };
}

function hostValue(report: DoctorReport): {
  version: 1;
  ok: boolean;
  exitCode: 0 | 1;
  checks: UiDoctorCheck[];
} {
  return {
    version: 1,
    ok: report.ok,
    exitCode: report.exitCode,
    checks: report.checks.map((item) => ({
      id: item.id,
      status: item.status,
      optional: item.optional,
      summary: item.summary,
      fix: item.fix,
    })),
  };
}

export function combinedDiagnosticsValue(report: CombinedDiagnostics): {
  version: 1;
  surface: "extension" | "editor";
  ok: boolean;
  ui: { checks: UiDoctorCheck[] };
  host: ReturnType<typeof hostValue> | null;
} {
  return {
    version: 1,
    surface: report.surface,
    ok: report.ok,
    ui: { checks: report.ui.checks.map(checkValue) },
    host: report.host === null ? null : hostValue(report.host),
  };
}

export function serializeCombinedDiagnostics(
  report: CombinedDiagnostics,
): string {
  return `${JSON.stringify(combinedDiagnosticsValue(report), null, 2)}\n`;
}

function isStatus(value: unknown): value is DoctorStatus {
  return value === "pass" || value === "warn" || value === "fail";
}

const OPTIONAL_UI_IDS = new Set<string>([
  "ext.id",
  "ext.version",
  "ext.incognito",
  "ext.tab",
]);

function readUiCheck(value: unknown, id: string): UiDoctorCheck | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.id !== id || !isStatus(record.status)) return null;
  if (typeof record.summary !== "string") return null;
  if (record.fix !== null && typeof record.fix !== "string") return null;
  return {
    id,
    status: record.status,
    optional: OPTIONAL_UI_IDS.has(id),
    summary: record.summary,
    fix: record.fix,
  };
}

/** Accept a service-worker doctor payload. Unknown fields are dropped. */
export function parseExtensionDoctor(
  value: unknown,
): CombinedDiagnostics | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.surface !== "extension") return null;
  const ui = record.ui;
  if (ui === null || typeof ui !== "object" || Array.isArray(ui)) return null;
  const rawChecks = (ui as { checks?: unknown }).checks;
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) return null;
  const checks: UiDoctorCheck[] = [];
  let cursor = 0;
  for (const item of rawChecks) {
    const id =
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { id?: unknown }).id === "string"
        ? (item as { id: string }).id
        : "";
    const expected = EXTENSION_UI_CHECK_IDS.indexOf(id as ExtensionUiCheckId);
    if (expected < cursor) return null;
    if (!EXTENSION_UI_CHECK_IDS.includes(id as ExtensionUiCheckId)) return null;
    const parsed = readUiCheck(item, id);
    if (parsed === null) return null;
    checks.push(parsed);
    cursor = expected + 1;
  }
  if (checks[0]?.id !== "ext.worker") return null;
  let host: DoctorReport | null = null;
  if (record.host !== null && record.host !== undefined) {
    host = acceptedHost(record.host);
    if (host === null) return null;
  }
  return combined("extension", checks, host);
}
