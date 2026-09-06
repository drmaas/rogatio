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

## Schema Constraants

### URL Regular Expression
- Maximum 2048 characters
- Case-sensitive, no flags
- Must be valid ECMAScript regex
- Used to match request URLs

### Origins
- Only explicit http:// and https:// origins with hostname
- Optional port (e.g., https://example.com:8080)
- No wildcards, credentials, paths, query strings, or fragments
- Effective origins are union of project, group, and rule origins

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
- Max 10 origins per group/rule

## Rule Types

Each rule has: id, name, urlRegex, origins[], resourceTypes[], priority, method?, action

### redirect
Action: { destination: string } - Absolute URL with $1, $2 capture substitution

### query
Action: { parameters: Record<string, string> } - Add/replace query parameters

### header
Action: { name: string, value: string, direction: "request" | "response", operation: "set" | "append" | "remove" }

### mock
Action: { status: number, headers?: Record<string, string>, delayMs?: number, body?: string, file?: string }

### response-body
Action: { replacement: string } - Regex replacement on response body (GET/HEAD only)

### request-body
Action: { replacement: string } - Regex replacement on request body (POST/PUT/PATCH XHR only)

## Compiler Diagnostic Codes (stable)
- schema.invalid-regex - Invalid regex syntax
- schema.duplicate-id - Duplicate group/rule ID
- schema.invalid-origin - Invalid origin format
- schema.invalid-resource-type - Unknown resource type
- schema.invalid-method - Unknown HTTP method
- schema.regex-too-long - Regex exceeds 2048 chars
- compiler.unsupported-operation - Operation kind not supported

## Current Project
${projectJson}

## Output Format

Return ONLY valid JSON matching this TypeScript interface:

\`\`\`typescript
interface RuleProposal {
  kind: "redirect" | "query" | "header" | "mock" | "response-body" | "request-body";
  groupId: string;
  name: string;
  urlRegex: string;
  origins?: string[];
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
3. All regex must be valid ECMAScript
4. All origins must be valid http/https with hostname
5. Resource types must be from the allowed list
6. Methods must be from the allowed list
7. Priority: higher = more specific (100 default)
8. Action object must match the rule kind schema exactly
9. Before proposing, mentally validate against dry-run: would this rule match the intended URLs?
10. Explanation should be 1-2 sentences describing what the rules do
`;
}
