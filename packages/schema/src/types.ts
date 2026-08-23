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

export type RuleType = "redirect";

export interface RedirectAction {
  /** Absolute http(s) URL. May contain \1..\9 backreferences to urlRegex capture groups. */
  destination: string;
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
