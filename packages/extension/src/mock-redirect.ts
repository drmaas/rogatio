import type { MockOperation } from "@rogatio/compiler";
import { LIMITS, RESOURCE_TYPES } from "@rogatio/schema";
import type { ChromeApi } from "./chrome.js";
import { MOCK_LISTENER_PREFIX } from "./mock-listener.js";
import {
  isMockRedirectId,
  MOCK_GUARD_ID,
  MOCK_REDIRECT_ID_MIN,
} from "./mock-redirect-ids.js";
import { projectSourceCondition } from "./source-projection.js";

export {
  isMockRedirectId,
  MOCK_GUARD_ID,
  MOCK_REDIRECT_ID_MAX,
  MOCK_REDIRECT_ID_MIN,
} from "./mock-redirect-ids.js";

export function mockRedirectUrl(
  port: number,
  token: string,
  digest: string,
): string {
  return `http://127.0.0.1:${port}${MOCK_LISTENER_PREFIX}${encodeURIComponent(token)}/${encodeURIComponent(digest)}`;
}

export function mockGuardRegex(port: number): string {
  return `^http://127\\.0\\.0\\.1:${port}/\\.rogatio/mock/`;
}

export function buildMockRedirectRule(
  operation: MockOperation,
  id: number,
  port: number,
  digest: string,
  token: string,
): {
  id: number;
  priority: number;
  action: { type: "redirect"; redirect: { url: string } };
  condition: {
    regexFilter: string;
    resourceTypes: string[];
    requestDomains?: string[];
    requestMethods?: string[];
  };
} {
  const projection = projectSourceCondition(operation.matcher);
  if (!projection.projectable) {
    throw new Error("extension.source-unprojectable");
  }
  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "redirect",
      redirect: { url: mockRedirectUrl(port, token, digest) },
    },
    condition: {
      regexFilter: projection.condition.regexFilter,
      resourceTypes: [...operation.matcher.resourceTypes],
      ...(projection.condition.requestDomains !== undefined
        ? { requestDomains: [...projection.condition.requestDomains] }
        : {}),
      ...(operation.matcher.method !== undefined
        ? { requestMethods: [operation.matcher.method.toLowerCase()] }
        : {}),
    },
  };
}

export function buildMockGuardRule(port: number): {
  id: number;
  priority: number;
  action: { type: "allow" };
  condition: { regexFilter: string; resourceTypes: readonly string[] };
} {
  return {
    id: MOCK_GUARD_ID,
    priority: LIMITS.maxPriority + 1,
    action: { type: "allow" },
    condition: {
      regexFilter: mockGuardRegex(port),
      resourceTypes: RESOURCE_TYPES,
    },
  };
}

export async function installMockRedirects(options: {
  readonly api: ChromeApi;
  readonly rules: readonly {
    readonly operation: MockOperation;
    readonly token: string;
  }[];
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
  const addRules = [
    ...options.rules.map((rule, index) =>
      buildMockRedirectRule(
        rule.operation,
        MOCK_REDIRECT_ID_MIN + index,
        options.port,
        options.digest,
        rule.token,
      ),
    ),
    buildMockGuardRule(options.port),
  ];
  try {
    await dnr.updateSessionRules({
      removeRuleIds: live.map((rule) => rule.id).filter(isMockRedirectId),
      addRules,
    });
  } catch {
    return { ok: false, reason: "extension.session-rules-update-failed" };
  }
  return { ok: true };
}

export async function removeMockRedirects(api: ChromeApi): Promise<void> {
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
  const removeRuleIds = live.map((rule) => rule.id).filter(isMockRedirectId);
  if (removeRuleIds.length === 0) return;
  try {
    await dnr.updateSessionRules({ removeRuleIds, addRules: [] });
  } catch {
    // Best-effort clear on stop.
  }
}
