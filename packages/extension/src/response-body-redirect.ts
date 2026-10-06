import type { ResponseBodyOperation } from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";
import { projectSourceCondition } from "./source-projection.js";

/**
 * Session-rule band for response-body redirects.
 * Dynamic redirect/query is 1..1_000_000, header starts at 2_000_001,
 * body markers start at 3_000_001. This band is session-store only.
 */
export const RESPONSE_BODY_REDIRECT_ID_MIN = 4_000_001;
export const RESPONSE_BODY_REDIRECT_ID_MAX = 5_000_000;

/** Keep in sync with the runtime listener prefix. */
export const RESPONSE_BODY_LISTENER_PREFIX = "/.rogatio/body/";

export function isResponseBodyRedirectId(id: number): boolean {
  return (
    Number.isInteger(id) &&
    id >= RESPONSE_BODY_REDIRECT_ID_MIN &&
    id <= RESPONSE_BODY_REDIRECT_ID_MAX
  );
}

export function responseBodyRedirectSubstitution(
  port: number,
  ruleId: string,
  digest: string,
): string {
  return `http://127.0.0.1:${port}${RESPONSE_BODY_LISTENER_PREFIX}${encodeURIComponent(ruleId)}/${encodeURIComponent(digest)}/\\0`;
}

export function buildResponseBodyRedirectRule(
  operation: ResponseBodyOperation,
  id: number,
  port: number,
  digest: string,
): {
  id: number;
  priority: number;
  action: {
    type: "redirect";
    redirect: { regexSubstitution: string };
  };
  condition: {
    regexFilter: string;
    resourceTypes: string[];
    requestDomains?: string[];
    requestMethods: string[];
  };
} {
  const projection = projectSourceCondition(operation.matcher);
  if (!projection.projectable) {
    throw new Error("extension.source-unprojectable");
  }
  const method =
    operation.matcher.method !== undefined
      ? operation.matcher.method.toLowerCase()
      : "get";
  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: responseBodyRedirectSubstitution(
          port,
          operation.ruleId,
          digest,
        ),
      },
    },
    condition: {
      regexFilter: projection.condition.regexFilter,
      resourceTypes: [...operation.matcher.resourceTypes],
      ...(projection.condition.requestDomains !== undefined
        ? { requestDomains: [...projection.condition.requestDomains] }
        : {}),
      requestMethods: [method],
    },
  };
}

export async function installResponseBodyRedirects(options: {
  readonly api: ChromeApi;
  readonly operations: readonly ResponseBodyOperation[];
  readonly port: number;
  readonly digest: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dnr = options.api.declarativeNetRequest;
  if (
    dnr?.getSessionRules === undefined ||
    dnr.updateSessionRules === undefined
  ) {
    return { ok: false, reason: "extension.session-rules-unavailable" };
  }
  let live: Array<{ id: number }>;
  try {
    live = await dnr.getSessionRules();
  } catch {
    return { ok: false, reason: "extension.session-rules-unreadable" };
  }
  if (!Array.isArray(live)) {
    return { ok: false, reason: "extension.session-rules-unreadable" };
  }
  const addRules = options.operations.map((operation, index) =>
    buildResponseBodyRedirectRule(
      operation,
      RESPONSE_BODY_REDIRECT_ID_MIN + index,
      options.port,
      options.digest,
    ),
  );
  try {
    await dnr.updateSessionRules({
      removeRuleIds: live
        .map((rule) => rule.id)
        .filter(isResponseBodyRedirectId),
      addRules,
    });
  } catch {
    return { ok: false, reason: "extension.session-rules-update-failed" };
  }
  return { ok: true };
}

export async function removeResponseBodyRedirects(
  api: ChromeApi,
): Promise<void> {
  const dnr = api.declarativeNetRequest;
  if (
    dnr?.getSessionRules === undefined ||
    dnr.updateSessionRules === undefined
  ) {
    return;
  }
  let live: Array<{ id: number }>;
  try {
    live = await dnr.getSessionRules();
  } catch {
    return;
  }
  if (!Array.isArray(live)) return;
  const removeRuleIds = live
    .map((rule) => rule.id)
    .filter(isResponseBodyRedirectId);
  if (removeRuleIds.length === 0) return;
  try {
    await dnr.updateSessionRules({ removeRuleIds, addRules: [] });
  } catch {
    // Best-effort clear on stop.
  }
}
