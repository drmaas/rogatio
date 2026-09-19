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

/** Redirect/query DNR ids occupy 1..1_000_000 (ADR 0009). */
const REDIRECT_QUERY_ID_MAX = 1_000_000;
/** Header DNR ids start at 2_000_001 (ADR 0009). */
const HEADER_ID_MIN = 2_000_001;

type RogatioDnrBand = "redirect-query" | "header";

function ruleIdHash(ruleId: string): number {
  let hash = 0;
  for (let index = 0; index < ruleId.length; index += 1) {
    hash = (hash * 31 + ruleId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % REDIRECT_QUERY_ID_MAX) + 1;
}

function isOwnedBandId(id: number, band: RogatioDnrBand): boolean {
  if (!Number.isInteger(id)) return false;
  if (band === "redirect-query") return id >= 1 && id <= REDIRECT_QUERY_ID_MAX;
  return id >= HEADER_ID_MIN;
}

/** Live Chrome ids ∩ Rogatio-owned band for this replace (ADR 0009). */
function removeIdsForBand(
  live: ReadonlyArray<{ id: number }>,
  band: RogatioDnrBand,
): number[] {
  return live.map((rule) => rule.id).filter((id) => isOwnedBandId(id, band));
}

export interface DnrInstallerWithMatchIndex extends RuleInstallerAdapter {
  /** Warm cold tracked from Chrome ∩ index ∩ compiled (ADR 0008). */
  hydrateInstalled(compiled: readonly RogatioOperation[]): Promise<void>;
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
      if (!Array.isArray(rules)) return [];
      const operations: RogatioOperation[] = [];
      for (const rule of rules) {
        const operation = tracked.get(rule.id);
        if (operation !== undefined) operations.push(operation);
      }
      return operations;
    },

    async hydrateInstalled(
      compiled: readonly RogatioOperation[],
    ): Promise<void> {
      // ADR 0008: hydrate only when memory is cold. Wiping warm tracked would
      // hide stale compiler ids from projectState sameSet and skip install()
      // orphan cleanup (P1).
      for (const id of tracked.keys()) {
        if (isOwnedBandId(id, "redirect-query")) return;
      }

      const dnr = api.declarativeNetRequest;
      if (dnr === undefined) return;
      let live: Array<{ id: number }>;
      try {
        live = await dnr.getDynamicRules();
      } catch {
        return;
      }
      if (!Array.isArray(live)) return;

      const byRuleId = new Map<string, RogatioOperation>();
      for (const operation of compiled) {
        if (operation.kind === "redirect" || operation.kind === "query") {
          byRuleId.set(operation.ruleId, operation);
        }
      }

      const index = await readMatchIndexSnapshot(api);
      for (const rule of live) {
        if (!isOwnedBandId(rule.id, "redirect-query")) continue;
        const key = String(rule.id);
        if (!Object.hasOwn(index, key)) continue;
        const entry = index[key];
        if (entry.kind !== "redirect" && entry.kind !== "query") continue;
        const operation = byRuleId.get(entry.ruleId);
        if (operation === undefined) continue;
        if (operation.kind !== entry.kind) continue;
        tracked.set(rule.id, operation);
      }
    },

    async install(
      operations: readonly RogatioOperation[],
    ): Promise<{ ok: true } | { ok: false; diagnostics: never[] }> {
      const addRules: DnrRule[] = [];
      const added: Array<{ ruleId: number; operation: RogatioOperation }> = [];
      const usedIds = new Set<number>();
      for (const operation of operations) {
        if (operation.kind === "redirect") {
          const redirect = operation as RedirectOperation;
          let id = ruleIdHash(redirect.ruleId);
          while (usedIds.has(id)) id = (id % REDIRECT_QUERY_ID_MAX) + 1;
          usedIds.add(id);
          addRules.push(translateRedirectToDnr(redirect, id));
          added.push({ ruleId: id, operation: redirect });
        } else if (operation.kind === "query") {
          const query = operation as QueryOperation;
          let id = ruleIdHash(query.ruleId);
          while (usedIds.has(id)) id = (id % REDIRECT_QUERY_ID_MAX) + 1;
          usedIds.add(id);
          addRules.push(translateQueryToDnr(query, id));
          added.push({ ruleId: id, operation: query });
        }
      }

      const dnr = api.declarativeNetRequest;
      if (dnr === undefined) return { ok: false, diagnostics: [] };

      // Chrome live set is authority for remove (ADR 0009). Fail closed if
      // unreadable — never treat as empty and add (duplicate-id / wipe risk).
      let liveOwned: number[];
      try {
        const live = await dnr.getDynamicRules();
        if (!Array.isArray(live)) return { ok: false, diagnostics: [] };
        // Kind-scoped: redirect/query replace only touches 1..1_000_000.
        liveOwned = removeIdsForBand(live, "redirect-query");
      } catch {
        return { ok: false, diagnostics: [] };
      }

      const desiredIds = new Set(addRules.map((rule) => rule.id));
      const orphanIds = liveOwned.filter((id) => !desiredIds.has(id));

      tracked.clear();

      // Orphans only: best-effort bulk drop. Desired ids are never removed
      // here — each add below does atomic remove+add for its own id so a
      // failed orphan batch cannot leave a duplicate-id add path.
      if (orphanIds.length > 0) {
        try {
          await dnr.updateDynamicRules({
            removeRuleIds: orphanIds,
            addRules: [],
          });
        } catch {
          // Best-effort; desired per-rule replace below still proceeds.
        }
      }

      // Install each rule independently so one invalid transform cannot block
      // the rest (Chrome rejects the whole updateDynamicRules batch on error).
      // Always removeRuleIds: [rule.id] with the add so Chrome-held desired
      // ids survive a prior orphan-remove failure (no empty-remove-then-add).
      let anyFailed = false;
      let anySucceeded = false;
      for (const entry of added) {
        const rule = addRules.find(
          (candidate) => candidate.id === entry.ruleId,
        );
        if (rule === undefined) continue;
        try {
          await dnr.updateDynamicRules({
            removeRuleIds: [rule.id],
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
      if (anySucceeded || orphanIds.length > 0 || operations.length === 0) {
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
