import type { RuleInstallerAdapter } from "@rogatio/browser-core";
import type {
  MockOperation,
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { queryParamsToDNR } from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";

export interface DnrRedirectRule {
  id: number;
  priority: number;
  action: { type: "redirect"; redirect: { url: string } };
  condition: {
    regexFilter: string;
    resourceTypes: readonly string[];
    initiatorDomains: string[];
  };
}

export interface DnrQueryRule {
  id: number;
  priority: number;
  action: {
    type: "redirect";
    redirect: { transform: { query: { addOrReplaceParams: unknown[] } } };
  };
  condition: {
    regexFilter: string;
    resourceTypes: readonly string[];
    initiatorDomains: string[];
  };
}

export interface DnrAllowRule {
  id: number;
  priority: number;
  action: { type: "allow" };
  condition: { urlFilter: string };
}

export type DnrRule = DnrRedirectRule | DnrQueryRule | DnrAllowRule;

/** Stable high-priority id for the single loop-protection allow rule. */
export const MOCK_ALLOW_RULE_ID = 3_000_001;

function hostnamesFromOrigins(origins: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const origin of origins) {
    let value = typeof origin === "string" ? origin : "";
    const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
    if (schemeMatch) value = value.slice(schemeMatch[0].length);
    const slash = value.indexOf("/");
    if (slash !== -1) value = value.slice(0, slash);
    const colon = value.indexOf(":");
    if (colon !== -1) value = value.slice(0, colon);
    if (value.startsWith("*.")) value = value.slice(2);
    if (value.length > 0) hosts.push(value);
  }
  return hosts;
}

export function translateRedirectToDnr(
  operation: RedirectOperation,
  id: number,
): DnrRedirectRule {
  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "redirect",
      redirect: { url: operation.redirect.destination },
    },
    condition: {
      regexFilter: operation.matcher.urlRegex.source,
      resourceTypes: operation.matcher.resourceTypes,
      initiatorDomains: hostnamesFromOrigins(operation.matcher.origins),
    },
  };
}

export function translateQueryToDnr(
  operation: QueryOperation,
  id: number,
): DnrQueryRule {
  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          query: { addOrReplaceParams: queryParamsToDNR(operation.action) },
        },
      },
    },
    condition: {
      regexFilter: operation.matcher.urlRegex.source,
      resourceTypes: operation.matcher.resourceTypes,
      initiatorDomains: hostnamesFromOrigins(operation.matcher.origins),
    },
  };
}

export function translateMockToDnr(
  operation: MockOperation,
  id: number,
  mockUrl: string,
): DnrRedirectRule {
  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "redirect",
      redirect: { url: mockUrl },
    },
    condition: {
      regexFilter: operation.matcher.urlRegex.source,
      resourceTypes: operation.matcher.resourceTypes,
      initiatorDomains: hostnamesFromOrigins(operation.matcher.origins),
    },
  };
}

/**
 * Loop protection: Chrome DNR re-evaluates a redirected request as a new request,
 * so a broad rule (e.g. `.*`) would also match the mock server URL and loop. One
 * high-priority `allow` rule matching the mock URL substring prevents the
 * extension's own redirect rules from ever applying to the mock server.
 */
export function mockLoopProtectionRule(port: number): DnrAllowRule {
  return {
    id: MOCK_ALLOW_RULE_ID,
    priority: 1_000_000_000,
    action: { type: "allow" },
    condition: { urlFilter: `127.0.0.1:${port}/mock/` },
  };
}

function ruleIdHash(ruleId: string): number {
  let hash = 0;
  for (let index = 0; index < ruleId.length; index += 1) {
    hash = (hash * 31 + ruleId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1_000_000) + 1;
}

export interface DnrInstallerOptions {
  /**
   * Resolves the mock redirect URL for a mock operation. Required for mock
   * operations to be installed; mock ops without a resolvable URL are skipped.
   */
  readonly mockUrlResolver?: (operation: MockOperation) => string | null;
}

export function createDnrInstaller(
  api: ChromeApi,
  options: DnrInstallerOptions = {},
): RuleInstallerAdapter {
  // Maps the DNR rule id we assigned back to the RogatioOperation we installed.
  const tracked = new Map<number, RogatioOperation>();
  let allowRuleId: number | null = null;

  return {
    async current(): Promise<readonly RogatioOperation[]> {
      const dnr = api.declarativeNetRequest;
      if (dnr === undefined) return [];
      let rules: Array<{ id: number }>;
      try {
        rules = await dnr.getDynamicRules();
      } catch {
        return [];
      }
      const operations: RogatioOperation[] = [];
      for (const rule of rules) {
        const operation = tracked.get(rule.id);
        if (operation !== undefined) operations.push(operation);
      }
      return operations;
    },

    async install(
      operations: readonly RogatioOperation[],
    ): Promise<{ ok: true } | { ok: false; diagnostics: never[] }> {
      const removeRuleIds = [...tracked.keys()];
      if (allowRuleId !== null) removeRuleIds.push(allowRuleId);
      const addRules: DnrRule[] = [];
      const added: Array<{ ruleId: number; operation: RogatioOperation }> = [];
      const usedIds = new Set<number>();
      let mockPort: number | null = null;
      for (const operation of operations) {
        if (operation.kind === "redirect") {
          const redirect = operation as RedirectOperation;
          let id = ruleIdHash(redirect.ruleId);
          while (usedIds.has(id)) id = (id % 1_000_000) + 1;
          usedIds.add(id);
          addRules.push(translateRedirectToDnr(redirect, id));
          added.push({ ruleId: id, operation: redirect });
        } else if (operation.kind === "query") {
          const query = operation as QueryOperation;
          let id = ruleIdHash(query.ruleId);
          while (usedIds.has(id)) id = (id % 1_000_000) + 1;
          usedIds.add(id);
          addRules.push(translateQueryToDnr(query, id));
          added.push({ ruleId: id, operation: query });
        } else if (operation.kind === "mock") {
          const mock = operation as MockOperation;
          const mockUrl = options.mockUrlResolver?.(mock);
          if (mockUrl === null || mockUrl === undefined) continue;
          let id = ruleIdHash(mock.ruleId);
          while (usedIds.has(id)) id = (id % 1_000_000) + 1;
          usedIds.add(id);
          addRules.push(translateMockToDnr(mock, id, mockUrl));
          added.push({ ruleId: id, operation: mock });
          try {
            const port = Number(new URL(mockUrl).port);
            if (Number.isInteger(port) && port > 0) mockPort = port;
          } catch {
            // Unparsable mock URL: skip loop protection for this rule.
          }
        }
      }
      let nextAllowRuleId: number | null = null;
      if (mockPort !== null) {
        const allow = mockLoopProtectionRule(mockPort);
        addRules.push(allow);
        nextAllowRuleId = allow.id;
      }

      const dnr = api.declarativeNetRequest;
      if (dnr === undefined) return { ok: false, diagnostics: [] };
      try {
        await dnr.updateDynamicRules({
          removeRuleIds,
          addRules,
        });
      } catch {
        return { ok: false, diagnostics: [] };
      }

      tracked.clear();
      for (const entry of added) tracked.set(entry.ruleId, entry.operation);
      allowRuleId = nextAllowRuleId;
      return { ok: true };
    },
  };
}
