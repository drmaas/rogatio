import {
  type AIClient,
  type AICompletionOptions,
  type AIProviderConfig,
  createAIClient,
} from "./ai-client.js";
import { buildSystemPrompt as buildSystemPromptImpl } from "./ai-prompt.js";

export { buildSystemPromptImpl as buildSystemPrompt };

export interface EditorDiagnostic {
  readonly code: string;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export interface DryRunTestCase {
  readonly url: string;
  readonly method?: string;
  readonly resourceType?: string;
}

export interface DryRunMatchDimension {
  readonly state: "matched" | "unmatched" | "not-applicable";
  readonly matched: boolean | null;
  readonly detail: string;
}

export interface DryRunActionPreview {
  readonly kind: string;
  readonly summary: string;
}

export interface DryRunRuleMatchResult {
  readonly groupId: string;
  readonly ruleId: string;
  readonly matched: boolean;
  readonly source: DryRunMatchDimension;
  readonly method: DryRunMatchDimension;
  readonly resourceType: DryRunMatchDimension;
  readonly actionPreview: DryRunActionPreview | null;
}

export interface DryRunUrlResult {
  readonly url: string;
  readonly rules: readonly DryRunRuleMatchResult[];
  readonly matchedRuleCount: number;
}

export interface DryRunError {
  readonly code: string;
  readonly message: string;
  readonly index?: number;
}

export interface DryRunSummary {
  readonly caseCount: number;
  readonly urlCount: number;
  readonly matchedUrlCount: number;
  readonly matchedRuleTotal: number;
}

export interface DryRunResult {
  readonly results: readonly DryRunUrlResult[];
  readonly errors: readonly DryRunError[];
  readonly summary: DryRunSummary;
}

export interface AIAssistRequest {
  kind: "generate" | "fix" | "explain";
  prompt: string;
  context: {
    project: { groups?: unknown[] } & Record<string, unknown>;
    activeGroupId?: string;
    focusedRuleId?: string;
    diagnostics?: readonly EditorDiagnostic[];
    dryRunCases?: readonly DryRunTestCase[];
  };
}

export interface SourceProposal {
  key: "url" | "host";
  operator: "regex";
  value: string;
}

export interface RuleProposal {
  kind: "redirect" | "query" | "header" | "response-body" | "request-body";
  groupId: string;
  name: string;
  source: SourceProposal;
  resourceTypes?: string[];
  priority?: number;
  method?: string;
  action: unknown;
}

export interface AIProposal {
  rules: readonly RuleProposal[];
  explanation: string;
}

export interface AIAssistChunk {
  type: "token" | "done" | "error";
  content?: string;
  proposal?: AIProposal;
  error?: { code: string; message: string };
}

const MAX_FIX_ATTEMPTS = 3;

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

/** Map a RuleProposal onto a schema-shaped rule object. */
export function ruleFromProposal(
  proposal: RuleProposal,
  ruleId: string,
): Record<string, unknown> {
  const rule: Record<string, unknown> = {
    id: ruleId,
    name: proposal.name,
    source: {
      key: proposal.source.key,
      operator: "regex",
      value: proposal.source.value,
    },
    resourceTypes: proposal.resourceTypes
      ? [...proposal.resourceTypes]
      : ["main_frame"],
    priority: proposal.priority ?? 100,
  };
  if (proposal.method !== undefined) {
    rule.method = proposal.method;
  }

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

/**
 * Insert proposal rules into a copy of the project (schema-shaped groups/rules).
 * Creates a group when `groupId` is missing.
 */
export function mergeProposalIntoProject(
  project: { groups?: unknown[] } & Record<string, unknown>,
  proposal: AIProposal,
): Record<string, unknown> {
  const groups: Record<string, unknown>[] = Array.isArray(project.groups)
    ? project.groups.map((group) => {
        if (!isRecord(group)) {
          return { id: "invalid", name: "invalid", rules: [] };
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
        rules: [],
      };
      groups.push(group);
    }
    const rules = group.rules as unknown[];
    rules.push(ruleFromProposal(ruleProposal, `ai-${Date.now()}-${seq++}`));
  }

  return { ...project, groups };
}

const RULE_PATH_PATTERN =
  /^\/groups\/(0|[1-9][0-9]*)\/rules\/(0|[1-9][0-9]*)(?:\/|$)/;

export interface RepairTarget {
  readonly groupIndex: number;
  readonly ruleIndex: number;
}

/**
 * Rule-level repair targets extracted from editor diagnostics. Diagnostics whose
 * path points inside a rule (`/groups/<gi>/rules/<ri>/...`) identify the rule to
 * repair; results are sorted by path position and de-duplicated.
 */
export function repairTargetsFromDiagnostics(
  diagnostics: readonly unknown[] | undefined,
): RepairTarget[] {
  if (!Array.isArray(diagnostics)) return [];
  const seen = new Set<string>();
  const targets: RepairTarget[] = [];
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

const RULE_KINDS = new Set<RuleProposal["kind"]>([
  "redirect",
  "query",
  "header",
  "response-body",
  "request-body",
]);

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string",
  );
  return items.length === value.length ? items : undefined;
}

/** Defensive structural parse of one untrusted proposal rule. */
function parseSourceProposal(value: unknown): SourceProposal | null {
  if (!isRecord(value)) return null;
  if (value.key !== "url" && value.key !== "host") return null;
  if (value.operator !== "regex") return null;
  if (typeof value.value !== "string" || value.value.length === 0) return null;
  return {
    key: value.key,
    operator: "regex",
    value: value.value,
  };
}

function parseProposalRule(value: unknown): RuleProposal | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const source = parseSourceProposal(value.source);
  if (
    typeof kind !== "string" ||
    !RULE_KINDS.has(kind as RuleProposal["kind"]) ||
    typeof value.groupId !== "string" ||
    typeof value.name !== "string" ||
    source === null ||
    !Object.hasOwn(value, "action")
  ) {
    return null;
  }
  return {
    kind: kind as RuleProposal["kind"],
    groupId: value.groupId,
    name: value.name,
    source,
    resourceTypes: stringArray(value.resourceTypes),
    priority: typeof value.priority === "number" ? value.priority : undefined,
    method: typeof value.method === "string" ? value.method : undefined,
    action: value.action,
  };
}

/**
 * Insert proposal rules into a copy of the project, repairing the rules that
 * carry diagnostics. Repair targets are replaced in place (keeping their rule
 * ids and positions) group-scoped FIFO; proposal rules without a remaining
 * target append exactly like `mergeProposalIntoProject`.
 */
export function repairProposalIntoProject(
  project: { groups?: unknown[] } & Record<string, unknown>,
  diagnostics: readonly unknown[] | undefined,
  proposal: AIProposal,
): Record<string, unknown> {
  const groups: Record<string, unknown>[] = Array.isArray(project.groups)
    ? project.groups.map((group) => {
        if (!isRecord(group)) {
          return { id: "invalid", name: "invalid", rules: [] };
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
  const proposed = Array.isArray(proposal.rules) ? proposal.rules : [];
  for (const entry of proposed as readonly unknown[]) {
    const ruleProposal = parseProposalRule(entry);
    if (!ruleProposal) continue;
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
        rules: [],
      };
      groups.push(group);
    }
    (group.rules as unknown[]).push(ruleFromProposal(ruleProposal, newId()));
  }

  return { ...project, groups };
}

function parseProposal(content: string): AIProposal | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.rules && parsed.explanation) {
      return parsed as AIProposal;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function buildMessages(
  systemPrompt: string,
  request: AIAssistRequest,
  previousProposal?: AIProposal,
  validationErrors?: readonly EditorDiagnostic[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  if (previousProposal) {
    messages.push({
      role: "assistant",
      content: JSON.stringify(previousProposal),
    });
  }

  let userContent = "";
  if (request.kind === "fix" && validationErrors) {
    userContent = `The previous proposal failed validation. Fix the following errors:\n\n`;
    for (const err of validationErrors) {
      userContent += `- ${err.path}: ${err.message} (${err.code})\n`;
    }
    userContent += `\nOriginal request: ${request.prompt}`;
  } else if (request.kind === "explain") {
    userContent = `Explain this rule/project: ${request.prompt}`;
  } else {
    userContent = request.prompt;
  }

  if (request.context.dryRunCases && request.context.dryRunCases.length > 0) {
    userContent += `\n\nDry-run test cases:`;
    for (const tc of request.context.dryRunCases) {
      userContent += `\n- ${tc.url}${tc.method ? ` (${tc.method})` : ""}${tc.resourceType ? ` [${tc.resourceType}]` : ""}`;
    }
  }

  messages.push({ role: "user", content: userContent });

  return messages;
}

async function runComplete(
  client: AIClient,
  options: AICompletionOptions,
): Promise<AIProposal | null> {
  const result = await client.complete(options);
  return parseProposal(result.content);
}

async function runStream(
  client: AIClient,
  options: AICompletionOptions,
): Promise<AIProposal | null> {
  let fullContent = "";
  for await (const chunk of client.stream(options)) {
    if (chunk.delta) {
      fullContent += chunk.delta;
    }
    if (chunk.done) {
      return parseProposal(fullContent);
    }
  }
  return parseProposal(fullContent);
}

export async function runAIAssist(
  request: AIAssistRequest,
  config: AIProviderConfig,
  validate: (value: unknown) => readonly EditorDiagnostic[],
  dryRun?: (project: unknown, cases: readonly DryRunTestCase[]) => DryRunResult,
  client?: AIClient,
): Promise<AIProposal> {
  const aiClient = client ?? createAIClient(config);
  const systemPrompt = buildSystemPromptImpl(request.context.project);

  // Fix requests repair the rules that carry diagnostics; other requests only
  // append proposal rules (merge semantics).
  const merge = (
    project: { groups?: unknown[] } & Record<string, unknown>,
    proposal: AIProposal,
  ): Record<string, unknown> =>
    request.kind === "fix"
      ? repairProposalIntoProject(
          project,
          request.context.diagnostics,
          proposal,
        )
      : mergeProposalIntoProject(project, proposal);

  let currentProposal: AIProposal | null = null;
  let attempts = 0;

  while (attempts < MAX_FIX_ATTEMPTS) {
    attempts++;

    const isFixAttempt = attempts > 1 || request.kind === "fix";
    const validationErrors = (() => {
      if (!isFixAttempt || !currentProposal) return [];
      return validate(merge(request.context.project, currentProposal));
    })();

    const messages = buildMessages(
      systemPrompt,
      request,
      currentProposal ?? undefined,
      validationErrors,
    );

    const completionOptions: AICompletionOptions = {
      messages,
      model: config.model,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    };

    let proposal: AIProposal | null = null;

    try {
      proposal = await runStream(aiClient, {
        ...completionOptions,
        stream: true,
      });
    } catch {
      try {
        proposal = await runComplete(aiClient, completionOptions);
      } catch (e) {
        throw new Error(`AI request failed: ${e}`);
      }
    }

    if (!proposal) {
      throw new Error("AI returned invalid proposal format");
    }

    currentProposal = proposal;

    const testProject = merge(request.context.project, proposal);
    const diagnostics = validate(testProject);

    if (diagnostics.length === 0) {
      // Optional: run dry-run if test cases provided
      if (
        dryRun &&
        request.context.dryRunCases &&
        request.context.dryRunCases.length > 0
      ) {
        dryRun(testProject, request.context.dryRunCases);
        // Could add logic here to check dry-run results and iterate
      }
      return proposal;
    }

    // If this was a fix request, continue loop to retry
    // For generate, only continue if we haven't reached max attempts
    if (request.kind === "fix") {
      continue;
    }
    if (attempts < MAX_FIX_ATTEMPTS) {
      continue;
    }

    // Max attempts reached for generate
    throw new Error(
      `Max fix attempts (${MAX_FIX_ATTEMPTS}) reached. Remaining errors: ${diagnostics.map((d) => d.message).join(", ")}`,
    );
  }

  throw new Error(`Max fix attempts (${MAX_FIX_ATTEMPTS}) reached`);
}
