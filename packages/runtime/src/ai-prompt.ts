const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "fetch",
  "media",
  "websocket",
  "manifest",
  "other",
] as const;

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
] as const;

const FORBIDDEN_REQUEST_HEADERS = [
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const;

const FORBIDDEN_RESPONSE_HEADERS = ["set-cookie", "set-cookie2"] as const;

function formatResourceTypes(): string {
  return RESOURCE_TYPES.join(", ");
}

function formatHttpMethods(): string {
  return HTTP_METHODS.join(", ");
}

function formatForbiddenHeaders(): string {
  return [
    ...FORBIDDEN_REQUEST_HEADERS.map((h) => `request: ${h}`),
    ...FORBIDDEN_RESPONSE_HEADERS.map((h) => `response: ${h}`),
  ].join(", ");
}

function formatProjectContext(project: unknown): string {
  try {
    return JSON.stringify(project, null, 2);
  } catch {
    return "{}";
  }
}

export function buildSystemPrompt(project: unknown): string {
  const projectJson = formatProjectContext(project);

  return `You are an expert Rogatio rule author. Rogatio is a local-first browser request/response rule engine.

## Schema Constraints (version 2)

### Source condition
Each rule matches with \`source: { key, operator, value }\`.
- \`key\`: \`"url"\` tests the full request URL; \`"host"\` tests the hostname only.
- \`operator\`: must be the constant \`"regex"\`.
- \`value\`: non-empty ECMAScript regex, max 2048 characters, case-sensitive, no flags.

There are no group or rule \`origins\` fields and no \`urlRegex\` field.

### Forbidden Headers
Cannot set/remove these headers:
${formatForbiddenHeaders()}

### Resource Types
${formatResourceTypes()}

### HTTP Methods
${formatHttpMethods()}

### Bounds
- Max 64 projects per profile
- Max 100 groups per project
- Max 500 rules per project

## Rule Types

Each rule has: id, name, source, resourceTypes[], priority, method?, action

### redirect
Action: destination string. Use $1 through $9 for URL source captures when \`source.key\` is \`"url"\`. $$ is a literal dollar sign. Existing redirect \\\\1 references remain compatible.

### query
Action: query parameters with name, operation, and value. Set values may use URL captures.

### header
Action: header direction, operation, name, and value. Set and append values may use URL captures.

### response-body
Replace-mode body may use URL captures. Regex-mode replacement strings use captures from the body pattern, not the source pattern.

### request-body
Replace-mode body may use URL captures. Regex-mode replacement strings use captures from the body pattern, not the source pattern.

## Compiler Diagnostic Codes (stable)
- schema.invalid-regex - Invalid regex syntax
- schema.duplicate-id - Duplicate group/rule ID
- schema.invalid-resource-type - Unknown resource type
- schema.invalid-method - Unknown HTTP method
- schema.regex-too-long - Regex exceeds 2048 chars
- compiler.unsupported-operation - Operation kind not supported

## Current Project
${projectJson}

## Output Format

Return ONLY valid JSON matching this TypeScript interface:

\`\`\`typescript
interface SourceProposal {
  key: "url" | "host";
  operator: "regex";
  value: string;
}

interface RuleProposal {
  kind: "redirect" | "query" | "header" | "response-body" | "request-body";
  groupId: string;
  name: string;
  source: SourceProposal;
  resourceTypes?: string[];
  priority?: number;
  method?: string;
  action: unknown;
}

interface AIProposal {
  rules: RuleProposal[];
  explanation: string;
}
\`\`\`

## Instructions

1. Propose MINIMAL changes - only what the user asked for
2. Use existing groups when possible; create new only if needed
3. All source.value regex must be valid ECMAScript
4. source.operator must be exactly "regex"
5. Resource types must be from the allowed list
6. Methods must be from the allowed list
7. Priority: higher = more specific (100 default)
8. Action object must match the rule kind schema exactly
9. Use $1–$9 only when source defines those capture groups; use $$ for a literal dollar sign
10. Before proposing, mentally validate against dry-run: would this rule match the intended URLs?
11. Explanation should be 1-2 sentences describing what the rules do
`;
}
