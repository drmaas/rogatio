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
  | "response-body"
  | "request-body";

export type HeaderDirection = "request" | "response";
export type HeaderOperationKind = "set" | "append" | "remove";

export interface RedirectAction {
  /** Absolute http(s) URL. May contain \1..\9 backreferences to urlRegex capture groups. */
  destination: string;
}

export type QueryParamOperation = "set" | "remove";

export interface RogatioQueryParam {
  name: string;
  operation?: QueryParamOperation;
  /** Set value may contain `$1`..`$9` URL captures and `$$` for a literal `$`. */
  value?: string;
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
  /** Set/append value may contain `$1`..`$9` URL captures. */
  headerValue?: string;
}

export interface ResponseBodyReplacement {
  pattern: string;
  replacement: string;
}

export type ResponseBodyMode = "replace" | "regex";

export interface ResponseBodyReplaceAction {
  mode: "replace";
  /** May contain `$1`..`$9` URL captures. */
  body: string;
}

export interface ResponseBodyRegexAction {
  mode: "regex";
  replacements: ResponseBodyReplacement[];
}

export interface ResponseBodyUntaggedRegexAction {
  replacements: ResponseBodyReplacement[];
}

export type ResponseBodyAction =
  | ResponseBodyReplaceAction
  | ResponseBodyRegexAction
  | ResponseBodyUntaggedRegexAction;

export type RequestBodyMode = "replace" | "regex";

export interface RequestBodyReplaceAction {
  mode: "replace";
  /** May contain `$1`..`$9` URL captures. */
  body: string;
}

export interface RequestBodyRegexAction {
  mode: "regex";
  pattern: string;
  replacement: string;
}

export type RequestBodyAction =
  | RequestBodyReplaceAction
  | RequestBodyRegexAction;

export interface RequestBodyPolicyConfig {
  localOrigins: string[];
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

  /** Required iff type === "response-body". */
  responseBody?: ResponseBodyAction;
  /** Required iff type === "request-body". */
  requestBody?: RequestBodyAction;

  /** When true, deny-list sensitive query/header values in match logs. Absent => false. */
  redactSensitiveInLogs?: boolean;
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
  requestBodyPolicy?: RequestBodyPolicyConfig;
}
