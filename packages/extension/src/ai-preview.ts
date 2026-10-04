/**
 * Browser-safe AI preview summarizer for the dashboard composer.
 *
 * The service worker already validates `generate-project` output, but the
 * dashboard renders `aiPreview` directly, so every read here is defensive:
 * own data-descriptor reads only (never invokes accessors), try/catch around
 * Proxy throws, and bounded output for large or hostile values.
 */

export interface AiPreviewRuleSummary {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly source: string;
  readonly resourceTypes: string;
  readonly priority: string;
  readonly method: string | null;
  readonly action: string;
}

export interface AiPreviewGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly rules: readonly AiPreviewRuleSummary[];
  /** Rules omitted from `rules` when the group exceeds the display cap. */
  readonly omittedRules: number;
}

export interface AiPreviewSummary {
  readonly name: string;
  readonly description: string | null;
  readonly groups: readonly AiPreviewGroupSummary[];
  /** Groups omitted from `groups` when the project exceeds the display cap. */
  readonly omittedGroups: number;
}

const MAX_PREVIEW_GROUPS = 64;
const MAX_PREVIEW_RULES_PER_GROUP = 256;
const MAX_BODY_PREVIEW_CHARS = 200;
const MAX_QUERY_PREVIEW_CHARS = 300;
const MAX_NAME_PREVIEW_CHARS = 200;
const MAX_DESCRIPTION_PREVIEW_CHARS = 500;
const MAX_SOURCE_PREVIEW_CHARS = 500;
const MAX_DESTINATION_PREVIEW_CHARS = 500;
const MAX_RESOURCE_NAME_CHARS = 100;
const MAX_HEADER_NAME_CHARS = 200;

function safeLength(value: unknown): number {
  try {
    if (!Array.isArray(value)) return 0;
    const length = (value as readonly unknown[]).length;
    return typeof length === "number" &&
      Number.isSafeInteger(length) &&
      length >= 0
      ? length
      : 0;
  } catch {
    return 0;
  }
}

function readOwn(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return undefined;
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readOwnString(record: object, key: string): string | null {
  const value = readOwn(record, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncateWithLength(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… (${value.length} chars)`;
}

function sourceSummary(rule: Record<string, unknown>): string {
  const source = asRecord(readOwn(rule, "source"));
  if (source === null) return "Invalid source";
  const key = readOwn(source, "key");
  const operator = readOwn(source, "operator");
  const pattern = readOwn(source, "value");
  if (
    (key !== "url" && key !== "host") ||
    operator !== "regex" ||
    typeof pattern !== "string" ||
    pattern.length === 0
  ) {
    return "Invalid source";
  }
  return `${key} ${operator} ${truncateWithLength(pattern, MAX_SOURCE_PREVIEW_CHARS)}`;
}

function resourceTypesSummary(rule: Record<string, unknown>): string {
  const value = readOwn(rule, "resourceTypes");
  if (!Array.isArray(value) || safeLength(value) === 0) return "—";
  const names: string[] = [];
  const total = safeLength(value);
  for (let index = 0; index < total && names.length < 16; index += 1) {
    const item = readOwn(value, String(index));
    if (typeof item === "string" && item.length > 0)
      names.push(truncateWithLength(item, MAX_RESOURCE_NAME_CHARS));
  }
  return names.length > 0 ? names.join(", ") : "—";
}

function prioritySummary(rule: Record<string, unknown>): string {
  const value = readOwn(rule, "priority");
  return typeof value === "number" && Number.isSafeInteger(value)
    ? `priority ${value}`
    : "—";
}

function methodSummary(rule: Record<string, unknown>): string | null {
  const value = readOwn(rule, "method");
  return typeof value === "string" && value.length > 0 ? value : null;
}

function redirectSummary(rule: Record<string, unknown>): string {
  const redirect = asRecord(readOwn(rule, "redirect"));
  const destination =
    redirect === null ? null : readOwnString(redirect, "destination");
  if (destination === null) return "Redirect (missing destination)";
  return `Redirect to ${truncateWithLength(destination, MAX_DESTINATION_PREVIEW_CHARS)}`;
}

function querySummary(rule: Record<string, unknown>): string {
  const action = asRecord(readOwn(rule, "action"));
  const params = action === null ? undefined : readOwn(action, "params");
  if (!Array.isArray(params) || safeLength(params) === 0) return "Query rule";
  const parts: string[] = [];
  const total = safeLength(params);
  for (let index = 0; index < total; index += 1) {
    const entry = asRecord(readOwn(params, String(index)));
    if (entry === null) continue;
    const name = readOwn(entry, "name");
    if (typeof name !== "string" || name.length === 0) continue;
    const operation = readOwn(entry, "operation");
    const value = readOwn(entry, "value");
    if (operation === "remove") {
      parts.push(`${name} → removed`);
      continue;
    }
    if (typeof value === "string") {
      parts.push(`${name}=${value}`);
      continue;
    }
    parts.push(`${name} (invalid param)`);
  }
  if (parts.length === 0) return "Query rule";
  return truncateWithLength(
    `Query: ${parts.join(", ")}`,
    MAX_QUERY_PREVIEW_CHARS,
  );
}

function headerSummary(rule: Record<string, unknown>): string {
  const direction = readOwn(rule, "headerDirection");
  const operation = readOwn(rule, "headerOperation");
  const nameValue = readOwn(rule, "headerName");
  const value = readOwn(rule, "headerValue");
  if (
    (direction !== "request" && direction !== "response") ||
    (operation !== "set" && operation !== "append" && operation !== "remove") ||
    typeof nameValue !== "string" ||
    nameValue.length === 0
  ) {
    return "Header rule";
  }
  const name = truncateWithLength(nameValue, MAX_HEADER_NAME_CHARS);
  if (operation === "remove" || typeof value !== "string") {
    return `${direction} header ${operation} ${name}`;
  }
  return `${direction} header ${operation} ${name} = ${truncateWithLength(value, MAX_BODY_PREVIEW_CHARS)}`;
}

function responseBodySummary(rule: Record<string, unknown>): string {
  const action = asRecord(readOwn(rule, "responseBody"));
  if (action === null) return "Response body rule";
  const mode = readOwn(action, "mode");
  if (mode === "replace") {
    const body = readOwn(action, "body");
    if (typeof body !== "string") return "Response body replace";
    return `Response body replace (${body.length} chars): ${truncateWithLength(body, MAX_BODY_PREVIEW_CHARS)}`;
  }
  const replacements = readOwn(action, "replacements");
  if (!Array.isArray(replacements)) return "Response body rule";
  const total = safeLength(replacements);
  if (total === 0) return "Response body regex";
  const shown: string[] = [];
  const limit = Math.min(total, 5);
  for (let index = 0; index < limit; index += 1) {
    const entry = asRecord(readOwn(replacements, String(index)));
    if (entry === null) continue;
    const pattern = readOwn(entry, "pattern");
    const replacement = readOwn(entry, "replacement");
    shown.push(
      `${typeof pattern === "string" ? truncateWithLength(pattern, 100) : "?"} → ${typeof replacement === "string" ? truncateWithLength(replacement, 100) : "?"}`,
    );
  }
  if (shown.length === 0) return `Response body regex (${total} replacements)`;
  const suffix = total > shown.length ? ` (+${total - shown.length} more)` : "";
  return `Response body regex (${total} replacements): ${shown.join("; ")}${suffix}`;
}

function requestBodySummary(rule: Record<string, unknown>): string {
  const action = asRecord(readOwn(rule, "requestBody"));
  if (action === null) return "Request body rule";
  const mode = readOwn(action, "mode");
  if (mode === "replace") {
    const body = readOwn(action, "body");
    if (typeof body !== "string") return "Request body replace";
    return `Request body replace (${body.length} chars): ${truncateWithLength(body, MAX_BODY_PREVIEW_CHARS)}`;
  }
  if (mode === "regex") {
    const pattern = readOwn(action, "pattern");
    const replacement = readOwn(action, "replacement");
    return `Request body regex: ${typeof pattern === "string" ? truncateWithLength(pattern, MAX_BODY_PREVIEW_CHARS) : "?"} → ${typeof replacement === "string" ? truncateWithLength(replacement, MAX_BODY_PREVIEW_CHARS) : "?"}`;
  }
  return "Request body rule";
}

function actionSummary(rule: Record<string, unknown>): string {
  const type = readOwn(rule, "type");
  if (type === "redirect") return redirectSummary(rule);
  if (type === "query") return querySummary(rule);
  if (type === "header") return headerSummary(rule);
  if (type === "response-body") return responseBodySummary(rule);
  if (type === "request-body") return requestBodySummary(rule);
  return typeof type === "string" && type.length > 0
    ? `Unsupported rule type: ${type}`
    : "Unsupported rule";
}

function summarizeRule(value: unknown): AiPreviewRuleSummary {
  const rule = asRecord(value);
  if (rule === null) {
    return {
      id: "",
      name: "Invalid rule",
      type: "unknown",
      source: "Invalid source",
      resourceTypes: "—",
      priority: "—",
      method: null,
      action: "Unsupported rule",
    };
  }
  const id = readOwnString(rule, "id") ?? "";
  const rawName =
    readOwnString(rule, "name") ?? (id !== "" ? id : "Unnamed rule");
  const name = truncateWithLength(rawName, MAX_NAME_PREVIEW_CHARS);
  const typeValue = readOwn(rule, "type");
  return {
    id,
    name,
    type:
      typeof typeValue === "string" && typeValue.length > 0
        ? typeValue
        : "unknown",
    source: sourceSummary(rule),
    resourceTypes: resourceTypesSummary(rule),
    priority: prioritySummary(rule),
    method: methodSummary(rule),
    action: actionSummary(rule),
  };
}

function summarizeGroup(value: unknown): AiPreviewGroupSummary {
  const group = asRecord(value);
  if (group === null) {
    return { id: "", name: "Invalid group", rules: [], omittedRules: 0 };
  }
  const id = readOwnString(group, "id") ?? "";
  const rawName =
    readOwnString(group, "name") ?? (id !== "" ? id : "Unnamed group");
  const name = truncateWithLength(rawName, MAX_NAME_PREVIEW_CHARS);
  const rawRules = readOwn(group, "rules");
  const totalRules = safeLength(rawRules);
  if (!Array.isArray(rawRules) || totalRules === 0) {
    return { id, name, rules: [], omittedRules: 0 };
  }
  const shown = Math.min(totalRules, MAX_PREVIEW_RULES_PER_GROUP);
  const rules: AiPreviewRuleSummary[] = [];
  for (let index = 0; index < shown; index += 1) {
    try {
      rules.push(summarizeRule(readOwn(rawRules, String(index))));
    } catch {
      rules.push(summarizeRule(null));
    }
  }
  return {
    id,
    name,
    rules,
    omittedRules: totalRules - shown,
  };
}

/**
 * Structured, bounded summary of an AI-generated project preview.
 * Never throws on hostile input; unknown shapes become fallback text.
 */
export function summarizeAiPreview(value: unknown): AiPreviewSummary {
  try {
    const project = asRecord(value);
    if (project === null) {
      return {
        name: "Generated project",
        description: null,
        groups: [],
        omittedGroups: 0,
      };
    }
    const rawName = readOwnString(project, "name") ?? "Generated project";
    const name = truncateWithLength(rawName, MAX_NAME_PREVIEW_CHARS);
    const rawDescription = readOwn(project, "description");
    const description =
      typeof rawDescription === "string" && rawDescription.trim().length > 0
        ? truncateWithLength(rawDescription, MAX_DESCRIPTION_PREVIEW_CHARS)
        : null;
    const rawGroups = readOwn(project, "groups");
    const totalGroups = safeLength(rawGroups);
    if (!Array.isArray(rawGroups) || totalGroups === 0) {
      return { name, description, groups: [], omittedGroups: 0 };
    }
    const shown = Math.min(totalGroups, MAX_PREVIEW_GROUPS);
    const groups: AiPreviewGroupSummary[] = [];
    for (let index = 0; index < shown; index += 1) {
      try {
        groups.push(summarizeGroup(readOwn(rawGroups, String(index))));
      } catch {
        groups.push(summarizeGroup(null));
      }
    }
    return {
      name,
      description,
      groups,
      omittedGroups: totalGroups - shown,
    };
  } catch {
    return {
      name: "Generated project",
      description: null,
      groups: [],
      omittedGroups: 0,
    };
  }
}
