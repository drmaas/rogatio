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

const RULE_PATH_PATTERN =
  /^\/groups\/(0|[1-9][0-9]*)\/rules\/(0|[1-9][0-9]*)(?:\/|$)/;

export interface ExtensionRepairTarget {
  readonly groupIndex: number;
  readonly ruleIndex: number;
}

/**
 * Rule-level repair targets from editor diagnostics (JSON-pointer rule paths),
 * sorted by path position and de-duplicated. Mirrors the runtime helper.
 */
export function repairTargetsFromDiagnostics(
  diagnostics: readonly unknown[] | undefined,
): ExtensionRepairTarget[] {
  if (!Array.isArray(diagnostics)) return [];
  const seen = new Set<string>();
  const targets: ExtensionRepairTarget[] = [];
  for (const diagnostic of diagnostics) {
    if (!isRecord(diagnostic) || typeof diagnostic.path !== "string") continue;
    const match = RULE_PATH_PATTERN.exec(diagnostic.path);
    if (!match) continue;
    const groupIndex = Number(match[1]);
    const ruleIndex = Number(match[2]);
    if (!Number.isSafeInteger(groupIndex) || !Number.isSafeInteger(ruleIndex)) {
      continue;
    }
    const key = `${groupIndex}/${ruleIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ groupIndex, ruleIndex });
  }
  targets.sort(
    (left, right) =>
      left.groupIndex - right.groupIndex || left.ruleIndex - right.ruleIndex,
  );
  return targets;
}

/**
 * Insert proposal rules into a copy of the project, repairing the rules that
 * carry diagnostics (group-scoped FIFO, keeping repaired rule ids). Proposal
 * rules without a remaining target append like `mergeProposalIntoProject`.
 * Mirrors the runtime helper without importing @rogatio/runtime.
 */
export function repairProposalIntoProject(
  project: { groups?: unknown[] } & Record<string, unknown>,
  diagnostics: readonly unknown[] | undefined,
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

  const queues = new Map<number, number[]>();
  for (const target of repairTargetsFromDiagnostics(diagnostics)) {
    const group = groups[target.groupIndex];
    if (!group) continue;
    const rules = group.rules as unknown[];
    if (target.ruleIndex >= rules.length) continue;
    if (!isRecord(rules[target.ruleIndex])) continue;
    const queue = queues.get(target.groupIndex) ?? [];
    queue.push(target.ruleIndex);
    queues.set(target.groupIndex, queue);
  }

  let seq = 0;
  const newId = (): string => `ai-${Date.now()}-${seq++}`;
  for (const ruleProposal of proposal.rules) {
    const groupIndex = groups.findIndex(
      (candidate) => candidate.id === ruleProposal.groupId,
    );
    const queue = groupIndex >= 0 ? queues.get(groupIndex) : undefined;
    const targetIndex = queue?.shift();
    if (groupIndex >= 0 && targetIndex !== undefined) {
      const rules = groups[groupIndex].rules as unknown[];
      const existing = rules[targetIndex] as Record<string, unknown>;
      const keptId = typeof existing.id === "string" ? existing.id : newId();
      rules[targetIndex] = ruleFromProposal(ruleProposal, keptId);
      continue;
    }
    let group = groupIndex >= 0 ? groups[groupIndex] : undefined;
    if (!group) {
      group = {
        id: ruleProposal.groupId,
        name: "AI Group",
        origins: [],
        rules: [],
      };
      groups.push(group);
    }
    (group.rules as unknown[]).push(ruleFromProposal(ruleProposal, newId()));
  }

  return { ...project, groups };
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
