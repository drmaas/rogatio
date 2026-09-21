/**
 * Browser-safe Assist helpers for the extension service worker.
 * Mirrors runtime merge semantics without importing @rogatio/runtime.
 */

export interface ExtensionRuleProposal {
  readonly kind:
    | "redirect"
    | "query"
    | "header"
    | "response-body"
    | "request-body";
  readonly groupId: string;
  readonly name: string;
  readonly urlRegex: string;
  readonly origins?: readonly string[];
  readonly resourceTypes?: readonly string[];
  readonly priority?: number;
  readonly method?: string;
  readonly action: unknown;
}

export interface ExtensionAIProposal {
  readonly rules: readonly ExtensionRuleProposal[];
  readonly explanation: string;
}

const RULE_KINDS = new Set([
  "redirect",
  "query",
  "header",
  "response-body",
  "request-body",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownString(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function parseAIProposal(value: unknown): ExtensionAIProposal | null {
  if (!isRecord(value) || typeof value.explanation !== "string") return null;
  if (!Array.isArray(value.rules)) return null;
  const rules: ExtensionRuleProposal[] = [];
  for (const entry of value.rules) {
    if (!isRecord(entry)) return null;
    if (typeof entry.kind !== "string" || !RULE_KINDS.has(entry.kind)) {
      return null;
    }
    if (typeof entry.groupId !== "string" || typeof entry.name !== "string") {
      return null;
    }
    if (typeof entry.urlRegex !== "string" || !Object.hasOwn(entry, "action")) {
      return null;
    }
    rules.push({
      kind: entry.kind as ExtensionRuleProposal["kind"],
      groupId: entry.groupId,
      name: entry.name,
      urlRegex: entry.urlRegex,
      origins: Array.isArray(entry.origins)
        ? entry.origins.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      resourceTypes: Array.isArray(entry.resourceTypes)
        ? entry.resourceTypes.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      priority: typeof entry.priority === "number" ? entry.priority : undefined,
      method: typeof entry.method === "string" ? entry.method : undefined,
      action: entry.action,
    });
  }
  return { rules, explanation: value.explanation };
}

export function ruleFromProposal(
  proposal: ExtensionRuleProposal,
  ruleId: string,
): Record<string, unknown> {
  const rule: Record<string, unknown> = {
    id: ruleId,
    name: proposal.name,
    urlRegex: proposal.urlRegex,
    origins: proposal.origins ? [...proposal.origins] : [],
    resourceTypes: proposal.resourceTypes
      ? [...proposal.resourceTypes]
      : ["main_frame"],
    priority: proposal.priority ?? 100,
  };
  if (proposal.method !== undefined) rule.method = proposal.method;

  switch (proposal.kind) {
    case "redirect":
      rule.type = "redirect";
      rule.redirect = proposal.action;
      break;
    case "query":
      rule.type = "query";
      rule.action = proposal.action;
      break;
    case "header": {
      rule.type = "header";
      if (isRecord(proposal.action)) {
        const direction = ownString(
          proposal.action,
          "headerDirection",
          "direction",
        );
        const operation = ownString(
          proposal.action,
          "headerOperation",
          "operation",
        );
        const name = ownString(proposal.action, "headerName", "name");
        const value = ownString(proposal.action, "headerValue", "value");
        if (direction !== undefined) rule.headerDirection = direction;
        if (operation !== undefined) rule.headerOperation = operation;
        if (name !== undefined) rule.headerName = name;
        if (value !== undefined) rule.headerValue = value;
      }
      break;
    }
    case "response-body":
      rule.type = "response-body";
      rule.responseBody = proposal.action;
      break;
    case "request-body":
      rule.type = "request-body";
      rule.requestBody = proposal.action;
      break;
    default: {
      const _exhaustive: never = proposal.kind;
      void _exhaustive;
    }
  }
  return rule;
}

export function mergeProposalIntoProject(
  project: { groups?: unknown[] } & Record<string, unknown>,
  proposal: ExtensionAIProposal,
): Record<string, unknown> {
  const groups: Record<string, unknown>[] = Array.isArray(project.groups)
    ? project.groups.map((group) => {
        if (!isRecord(group)) {
          return { id: "invalid", name: "invalid", origins: [], rules: [] };
        }
        return {
          ...group,
          rules: Array.isArray(group.rules) ? [...group.rules] : [],
        };
      })
    : [];

  let seq = 0;
  for (const ruleProposal of proposal.rules) {
    let group = groups.find(
      (candidate) => candidate.id === ruleProposal.groupId,
    );
    if (!group) {
      group = {
        id: ruleProposal.groupId,
        name: "AI Group",
        origins: [],
        rules: [],
      };
      groups.push(group);
    }
    const rules = group.rules as unknown[];
    rules.push(ruleFromProposal(ruleProposal, `ai-${Date.now()}-${seq++}`));
  }

  return { ...project, groups };
}

export function buildAssistSystemPrompt(project: unknown): string {
  let projectJson = "{}";
  try {
    projectJson = JSON.stringify(project);
  } catch {
    projectJson = "{}";
  }
  return [
    "You are an expert Rogatio rule author.",
    'Return ONLY valid JSON: {"rules":RuleProposal[],"explanation":string}.',
    "RuleProposal: kind (redirect|query|header|response-body|request-body), groupId, name, urlRegex, optional origins/resourceTypes/priority/method, action.",
    "redirect action: {destination} (http/https absolute URL; $1-$9 for captures).",
    "query action: query parameter ops; header: direction/operation/name/value; body rules: replace or regex modes.",
    "Origins must be explicit http(s) host origins (no wildcards/paths). Prefer existing groups. Minimal changes.",
    "urlRegex must be valid ECMAScript, max 2048 chars, case-sensitive, no flags.",
    `Current project JSON: ${projectJson}`,
  ].join(" ");
}

/** Soft cap under native envelope 64 KiB UTF-8 limit (includes framing overhead). */
export const MAX_AI_ASSIST_ENVELOPE_BYTES = 60 * 1024;
