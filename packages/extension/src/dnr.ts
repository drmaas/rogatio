import type { RuleInstallerAdapter } from "@rogatio/browser-core";
import type {
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { type DnrQueryTransform, queryActionToDNR } from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";
import {
  buildInstallIndexSnapshot,
  type MatchIndexSnapshot,
  readMatchIndexSnapshot,
  writeMatchIndex,
} from "./match-index.js";

export interface DnrRedirectRule {
  id: number;
  priority: number;
  action: { type: "redirect"; redirect: { url: string } };
  condition: {
    regexFilter: string;
    resourceTypes: readonly string[];
    requestDomains?: string[];
  };
}

export interface DnrQueryRule {
  id: number;
  priority: number;
  action: {
    type: "redirect";
    redirect: { transform: { queryTransform: DnrQueryTransform } };
  };
  condition: {
    regexFilter: string;
    resourceTypes: readonly string[];
    requestDomains?: string[];
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
    // Chrome DNR requestDomains rejects bare IPv4/IPv6 literals in practice for
    // dynamic rules; origin scoping stays in regexFilter (which includes host:port).
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":")) {
      continue;
    }
    if (value.length > 0) hosts.push(value);
  }
  return hosts;
}

function redirectQueryCondition(
  operation: RedirectOperation | QueryOperation,
): {
  regexFilter: string;
  resourceTypes: readonly string[];
  requestDomains?: string[];
} {
  const requestDomains = hostnamesFromOrigins(operation.matcher.origins);
  return {
    regexFilter: operation.matcher.urlRegex.source,
    resourceTypes: operation.matcher.resourceTypes,
    ...(requestDomains.length > 0 ? { requestDomains } : {}),
  };
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
    condition: redirectQueryCondition(operation),
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
          queryTransform: queryActionToDNR(operation.action),
        },
      },
    },
    condition: redirectQueryCondition(operation),
  };
}

function ruleIdHash(ruleId: string): number {
  let hash = 0;
  for (let index = 0; index < ruleId.length; index += 1) {
    hash = (hash * 31 + ruleId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1_000_000) + 1;
}

export interface DnrInstallerWithMatchIndex extends RuleInstallerAdapter {
  syncHeaderMatchIndex(
    headerEntries: ReadonlyArray<{
      readonly ruleId: number;
      readonly operation: RogatioOperation;
    }>,
  ): Promise<void>;
}

export function createDnrInstaller(api: ChromeApi): DnrInstallerWithMatchIndex {
  const tracked = new Map<number, RogatioOperation>();
  let matchIndexWriteTail: Promise<void> = Promise.resolve();

  function withMatchIndexWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = matchIndexWriteTail;
    let release!: () => void;
    matchIndexWriteTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }

  async function storedIndexByKind(): Promise<{
    header: MatchIndexSnapshot;
    redirectQuery: MatchIndexSnapshot;
  }> {
    const header: MatchIndexSnapshot = {};
    const redirectQuery: MatchIndexSnapshot = {};
    for (const [id, entry] of Object.entries(
      await readMatchIndexSnapshot(api),
    )) {
      if (entry.kind === "header") header[id] = entry;
      else redirectQuery[id] = entry;
    }
    return { header, redirectQuery };
  }

  // Sole wholesale writer for the index (ADR 0003). Serialized on one
  // in-process queue so overlapping install and header sync cannot drop slices.
  //
  // Overlay: redirect/query from tracked when non-empty; else stored when
  // `keepStoredRedirectQuery` (header sync after SW restart), else {}.
  // Headers from `headerOverlay` when provided; else stored (redirect install).
  async function writeWholesaleMatchIndex(options: {
    readonly headerOverlay?: ReadonlyArray<{
      readonly ruleId: number;
      readonly operation: RogatioOperation;
    }>;
    readonly keepStoredRedirectQuery?: boolean;
  }): Promise<void> {
    await withMatchIndexWriteLock(async () => {
      const redirectQueryEntries = [...tracked.entries()].map(
        ([ruleId, operation]) => ({ ruleId, operation }),
      );
      const needsStored =
        options.headerOverlay === undefined ||
        (redirectQueryEntries.length === 0 &&
          options.keepStoredRedirectQuery === true);
      const stored = needsStored
        ? await storedIndexByKind()
        : { header: {}, redirectQuery: {} };
      const snapshot: MatchIndexSnapshot = {
        ...(redirectQueryEntries.length > 0
          ? buildInstallIndexSnapshot(redirectQueryEntries)
          : options.keepStoredRedirectQuery === true
            ? stored.redirectQuery
            : {}),
        ...(options.headerOverlay === undefined
          ? stored.header
          : buildInstallIndexSnapshot(options.headerOverlay)),
      };
      try {
        await writeMatchIndex(api, snapshot);
      } catch {
        // ignored
      }
    });
  }

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

      // Drop previously tracked redirect/query ids first.
      if (removeRuleIds.length > 0) {
        try {
          await dnr.updateDynamicRules({ removeRuleIds, addRules: [] });
        } catch {
          // Continue; per-rule adds below still attempt a clean install.
        }
      }
      tracked.clear();

      // Install each rule independently so one invalid transform cannot block
      // the rest (Chrome rejects the whole updateDynamicRules batch on error).
      let anyFailed = false;
      let anySucceeded = false;
      for (const entry of added) {
        const rule = addRules.find(
          (candidate) => candidate.id === entry.ruleId,
        );
        if (rule === undefined) continue;
        try {
          await dnr.updateDynamicRules({
            removeRuleIds: [],
            addRules: [rule],
          });
          tracked.set(entry.ruleId, entry.operation);
          anySucceeded = true;
        } catch (error) {
          anyFailed = true;
          console.log(
            "[rogatio] DNR install failed:",
            error instanceof Error ? error.message : String(error),
            JSON.stringify(rule),
          );
        }
      }

      // Preserve prior index when every add fails. Empty install([]) still
      // clears the index deliberately.
      if (anySucceeded || removeRuleIds.length > 0 || operations.length === 0) {
        await writeWholesaleMatchIndex({});
      }

      return anyFailed && tracked.size === 0 && operations.length > 0
        ? { ok: false, diagnostics: [] }
        : { ok: true };
    },
    async syncHeaderMatchIndex(
      headerEntries: ReadonlyArray<{
        readonly ruleId: number;
        readonly operation: RogatioOperation;
      }>,
    ): Promise<void> {
      await writeWholesaleMatchIndex({
        headerOverlay: headerEntries,
        keepStoredRedirectQuery: true,
      });
    },
  };
}
