import type { HeaderProjection } from "./projection.js";

export interface DnrHeaderRule {
  readonly id: number;
  readonly priority: number;
  readonly action: {
    readonly type: "modifyHeaders";
    readonly requestHeaders?: readonly DnrHeaderAction[];
    readonly responseHeaders?: readonly DnrHeaderAction[];
  };
  readonly condition: {
    readonly regexFilter: string;
    readonly resourceTypes?: readonly string[];
    readonly initiatorDomains?: readonly string[];
    readonly excludedInitiatorDomains?: readonly string[];
    readonly requestDomains?: readonly string[];
    readonly excludedRequestDomains?: readonly string[];
    readonly requestMethods?: readonly string[];
    readonly excludedRequestMethods?: readonly string[];
    readonly tabIds?: readonly number[];
    readonly excludedTabIds?: readonly number[];
  };
}

export interface DnrHeaderAction {
  readonly header: string;
  readonly operation: "set" | "append" | "remove";
  readonly value?: string;
}

function toDnrResourceTypes(types: readonly string[]): string[] {
  const mapping: Record<string, string> = {
    main_frame: "main_frame",
    sub_frame: "sub_frame",
    stylesheet: "stylesheet",
    script: "script",
    image: "image",
    font: "font",
    object: "object",
    media: "media",
    xmlhttprequest: "xmlhttprequest",
    ping: "ping",
    csp_report: "csp_report",
    websocket: "websocket",
    webtransport: "webtransport",
    webbundle: "webbundle",
    other: "other",
  };
  return types.map((t) => mapping[t] ?? t);
}

function toDnrDomains(origins: readonly string[]): {
  allowed: string[];
  excluded: string[];
} {
  const allowed: string[] = [];
  const excluded: string[] = [];
  for (const origin of origins) {
    if (origin.startsWith("!")) {
      excluded.push(origin.slice(1));
    } else {
      try {
        const url = new URL(origin);
        allowed.push(url.hostname);
      } catch {
        allowed.push(origin);
      }
    }
  }
  return { allowed, excluded };
}

function toDnrHeaderAction(
  action: HeaderProjection["action"],
): DnrHeaderAction {
  return {
    header: action.headerName,
    operation: action.operation,
    ...(action.headerValue !== undefined ? { value: action.headerValue } : {}),
  };
}

export function toDnrRule(projection: HeaderProjection): DnrHeaderRule {
  const { allowed: requestDomains, excluded: excludedRequestDomains } =
    toDnrDomains(projection.matcher.origins);
  const resourceTypes =
    projection.matcher.resourceTypes.length > 0
      ? toDnrResourceTypes(projection.matcher.resourceTypes)
      : undefined;
  const requestMethods =
    projection.matcher.method !== undefined
      ? [projection.matcher.method.toLowerCase()]
      : undefined;

  return {
    id: projection.id,
    priority: projection.matcher.priority,
    action: {
      type: "modifyHeaders",
      ...(projection.action.direction === "request"
        ? { requestHeaders: [toDnrHeaderAction(projection.action)] }
        : {}),
      ...(projection.action.direction === "response"
        ? { responseHeaders: [toDnrHeaderAction(projection.action)] }
        : {}),
    },
    condition: {
      // Header rules use the compiler's regular-expression matcher directly.
      // requestDomains (not initiatorDomains) so main_frame navigations and
      // cross-initiator XHR still match when the request URL host is in scope.
      regexFilter: projection.matcher.urlRegex.source,
      ...(resourceTypes !== undefined ? { resourceTypes } : {}),
      ...(requestDomains.length > 0 ? { requestDomains } : {}),
      ...(excludedRequestDomains.length > 0 ? { excludedRequestDomains } : {}),
      ...(requestMethods !== undefined ? { requestMethods } : {}),
    },
  };
}
