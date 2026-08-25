export const PROJECT_VERSION = 1 as const;

export const RESOURCE_TYPES = Object.freeze([
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
] as const);

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const HTTP_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
] as const);

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RuleType =
  | "redirect"
  | "query"
  | "header"
  | "mock"
  | "response-body";

export type HeaderDirection = "request" | "response";
export type HeaderOperationKind = "set" | "append" | "remove";

export interface RedirectAction {
  /** Absolute http(s) URL. May contain \1..\9 backreferences to urlRegex capture groups. */
  destination: string;
}

export interface RogatioQueryParam {
  name: string;
  value: string;
}

export interface RogatioQueryAction {
  type: "query";
  params: RogatioQueryParam[];
}

export type RogatioRuleAction = RedirectAction | RogatioQueryAction;

export interface HeaderAction {
  headerDirection: HeaderDirection;
  headerOperation: HeaderOperationKind;
  headerName: string;
  headerValue?: string;
}

export interface MockHeader {
  name: string;
  value: string;
}

export interface MockAction {
  /** HTTP status to serve, integer in [200, 599]. */
  status: number;
  headers?: MockHeader[];
  /** Bounded artificial delay in milliseconds before the response. */
  delayMs?: number;
  /** Inline UTF-8 response body. Exactly one of `body`/`file` is set. */
  body?: string;
  /** Relative logical path of one approved local file snapshot. */
  file?: string;
}

export interface ResponseBodyReplacement {
  pattern: string;
  replacement: string;
}

export interface ResponseBodyAction {
  replacements: ResponseBodyReplacement[];
}

export interface RogatioRule {
  id: string;
  name: string;
  urlRegex: string;
  origins: string[];
  resourceTypes: ResourceType[];
  priority: number;
  method?: HttpMethod;

  /** Action selector. Absent => actionless (still valid, surfaced as "unsupported"). */
  type?: RuleType;

  /** Required iff type === "redirect". */
  redirect?: RedirectAction;

  /** Required iff type === "query". */
  action?: RogatioRuleAction;
  /** Required iff type === "header". */
  headerDirection?: HeaderDirection;
  headerOperation?: HeaderOperationKind;
  headerName?: string;
  headerValue?: string;

  /** Required iff type === "mock". */
  mock?: MockAction;
  /** Required iff type === "response-body". */
  responseBody?: ResponseBodyAction;
}

export interface RogatioGroup {
  id: string;
  name: string;
  origins: string[];
  rules: RogatioRule[];
}

export interface RogatioProject {
  version: typeof PROJECT_VERSION;
  name: string;
  description?: string;
  groups: RogatioGroup[];
}
