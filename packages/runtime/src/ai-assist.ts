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
  readonly urlRegex: DryRunMatchDimension;
  readonly effectiveOrigin: DryRunMatchDimension;
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

export interface RuleProposal {
  kind: "redirect" | "query" | "header" | "response-body" | "request-body";
  groupId: string;
  name: string;
  urlRegex: string;
  origins?: string[];
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
    urlRegex: proposal.urlRegex,
    origins: proposal.origins ? [...proposal.origins] : [],
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

  let currentProposal: AIProposal | null = null;
  let attempts = 0;

  while (attempts < MAX_FIX_ATTEMPTS) {
    attempts++;

    const isFixAttempt = attempts > 1 || request.kind === "fix";
    const validationErrors = (() => {
      if (!isFixAttempt || !currentProposal) return [];
      return validate(
        mergeProposalIntoProject(request.context.project, currentProposal),
      );
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

    const testProject = mergeProposalIntoProject(
      request.context.project,
      proposal,
    );
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
