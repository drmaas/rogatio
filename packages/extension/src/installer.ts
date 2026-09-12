import type { HeaderProjection } from "./projection.js";

export interface DnrHeaderRule {
  readonly id: number;
  readonly priority: number;
  readonly action: {
    readonly type: "modifyHeaders";
    readonly requestHeaders: readonly DnrHeaderAction[];
    readonly responseHeaders: readonly DnrHeaderAction[];
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

export interface InstallResult {
  readonly installed: readonly number[];
  readonly errors: readonly DnrInstallError[];
}

export interface DnrInstallError {
  readonly ruleId: number;
  readonly code: string;
  readonly message: string;
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
  const { allowed: initiatorDomains, excluded: excludedInitiatorDomains } =
    toDnrDomains(projection.matcher.origins);
  return {
    id: projection.id,
    priority: projection.matcher.priority,
    action: {
      type: "modifyHeaders",
      requestHeaders:
        projection.action.direction === "request"
          ? [toDnrHeaderAction(projection.action)]
          : [],
      responseHeaders:
        projection.action.direction === "response"
          ? [toDnrHeaderAction(projection.action)]
          : [],
    },
    condition: {
      // Header rules use the compiler's regular-expression matcher directly.
      regexFilter: projection.matcher.urlRegex.source,
      resourceTypes:
        projection.matcher.resourceTypes.length > 0
          ? toDnrResourceTypes(projection.matcher.resourceTypes)
          : undefined,
      initiatorDomains:
        initiatorDomains.length > 0 ? initiatorDomains : undefined,
      excludedInitiatorDomains:
        excludedInitiatorDomains.length > 0
          ? excludedInitiatorDomains
          : undefined,
      requestMethods:
        projection.matcher.method !== undefined
          ? [projection.matcher.method.toLowerCase()]
          : undefined,
    },
  };
}

export async function installHeaderRules(
  projections: readonly HeaderProjection[],
  removeRuleIds: readonly number[] = projections.map((rule) => rule.id),
): Promise<InstallResult> {
  const rules = projections.map(toDnrRule);
  const installed: number[] = [];
  const errors: DnrInstallError[] = [];
  const dnr = (
    globalThis as {
      chrome?: {
        declarativeNetRequest?: {
          updateDynamicRules: (options: {
            removeRuleIds: number[];
            addRules: DnrHeaderRule[];
          }) => Promise<void>;
          getDynamicRules?: () => Promise<Array<{ id: number }>>;
        };
      };
    }
  ).chrome?.declarativeNetRequest;
  if (!dnr) {
    for (const rule of rules) {
      errors.push({
        ruleId: rule.id,
        code: "extension.dnr-error",
        message: "declarativeNetRequest API not available",
      });
    }
    return { installed, errors };
  }
  let existingIds: readonly number[] = [];
  if (dnr.getDynamicRules) {
    try {
      const current = await dnr.getDynamicRules();
      const currentIds = new Set(current.map((rule) => rule.id));
      existingIds = removeRuleIds.filter((id) => currentIds.has(id));
    } catch {
      // Do not issue removals we could not verify; still attempt the add.
      existingIds = [];
    }
  }
  try {
    await dnr.updateDynamicRules({
      removeRuleIds: [...existingIds],
      addRules: rules,
    });
    installed.push(...rules.map((r) => r.id));
  } catch (error) {
    for (const rule of rules) {
      errors.push({
        ruleId: rule.id,
        code: "extension.dnr-error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to install header rule",
      });
    }
  }
  return { installed, errors };
}
