import type { RuleInstallerAdapter } from "@rogatio/browser-core";
import type {
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

export type DnrRule = DnrRedirectRule | DnrQueryRule;

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

function ruleIdHash(ruleId: string): number {
  let hash = 0;
  for (let index = 0; index < ruleId.length; index += 1) {
    hash = (hash * 31 + ruleId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1_000_000) + 1;
}

export function createDnrInstaller(api: ChromeApi): RuleInstallerAdapter {
  const tracked = new Map<number, RogatioOperation>();

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
      const addRules: DnrRule[] = [];
      const added: Array<{ ruleId: number; operation: RogatioOperation }> = [];
      const usedIds = new Set<number>();
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
        }
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
      return { ok: true };
    },
  };
}
