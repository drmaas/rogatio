import {
  type CoreDiagnostic,
  coreDiagnostic,
  type RuleInstallerAdapter,
} from "@rogatio/browser-core";
import type {
  HeaderOperation,
  QueryOperation,
  RedirectOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { type DnrQueryTransform, queryActionToDNR } from "@rogatio/compiler";
import { containsUrlCaptureReference } from "@rogatio/schema";
import type { ChromeApi } from "./chrome.js";
import { type DnrHeaderRule, toDnrRule } from "./installer.js";
import {
  buildInstallIndexSnapshot,
  type MatchIndexSnapshot,
  readMatchIndexSnapshot,
  writeMatchIndex,
} from "./match-index.js";
import { projectHeaders } from "./projection.js";

/** Per-rule Chrome/DNR failure from the last `install` attempt (ADR 0010). */
export type DnrInstallError = {
  readonly ruleId: string;
  readonly message: string;
};

function chromeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "Failed to install DNR rule";
}

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

export type DnrRule = DnrRedirectRule | DnrQueryRule | DnrHeaderRule;

function normalizeDnrRegexSubstitution(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$") {
      normalized += value[index];
      continue;
    }
    const next = value[index + 1];
    if (next === "$") {
      normalized += "$";
      index += 1;
    } else if (next !== undefined && next >= "1" && next <= "9") {
      normalized += `\\${next}`;
      index += 1;
    } else {
      normalized += "$";
    }
  }
  return normalized;
}

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
      redirect: {
        url: normalizeDnrRegexSubstitution(operation.redirect.destination),
      },
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
  /**
   * Consume per-rule install failures from the last `install` call.
   * Used by projectState for `extension.dnr-error` overlays (ADR 0010).
   */
  takeInstallErrors(): readonly DnrInstallError[];
}

export function createDnrInstaller(api: ChromeApi): DnrInstallerWithMatchIndex {
  const tracked = new Map<number, RogatioOperation>();
  let lastInstallErrors: DnrInstallError[] = [];
  let matchIndexWriteTail: Promise<void> = Promise.resolve();

  function withMatchIndexWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = matchIndexWriteTail;
    let release!: () => void;
    matchIndexWriteTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }

  async function writeWholesaleMatchIndex(): Promise<void> {
    await withMatchIndexWriteLock(async () => {
      const redirectQueryEntries: Array<{
        ruleId: number;
        operation: RogatioOperation;
      }> = [];
      const trackedHeaderEntries: Array<{
        ruleId: number;
        operation: RogatioOperation;
      }> = [];
      for (const [ruleId, operation] of tracked.entries()) {
        if (operation.kind === "header") {
          trackedHeaderEntries.push({ ruleId, operation });
        } else if (
          operation.kind === "redirect" ||
          operation.kind === "query"
        ) {
          redirectQueryEntries.push({ ruleId, operation });
        }
      }
      const snapshot: MatchIndexSnapshot = {
        ...buildInstallIndexSnapshot(redirectQueryEntries),
        ...buildInstallIndexSnapshot(trackedHeaderEntries),
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
      // ADR 0008: hydrate only when memory is cold per band. Wiping warm
      // tracked would hide stale compiler ids from projectState sameSet and
      // skip install() orphan cleanup (P1).
      let hydrateRedirectQuery = true;
      let hydrateHeader = true;
      for (const id of tracked.keys()) {
        if (isOwnedBandId(id, "redirect-query")) hydrateRedirectQuery = false;
        if (isOwnedBandId(id, "header")) hydrateHeader = false;
      }
      if (!hydrateRedirectQuery && !hydrateHeader) return;

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
        if (
          operation.kind === "redirect" ||
          operation.kind === "query" ||
          operation.kind === "header"
        ) {
          byRuleId.set(operation.ruleId, operation);
        }
      }

      const index = await readMatchIndexSnapshot(api);
      for (const rule of live) {
        const key = String(rule.id);
        if (!Object.hasOwn(index, key)) continue;
        const entry = index[key];
        const operation = byRuleId.get(entry.ruleId);
        if (operation === undefined) continue;
        if (operation.kind !== entry.kind) continue;
        if (
          hydrateRedirectQuery &&
          isOwnedBandId(rule.id, "redirect-query") &&
          (entry.kind === "redirect" || entry.kind === "query")
        ) {
          tracked.set(rule.id, operation);
        } else if (
          hydrateHeader &&
          isOwnedBandId(rule.id, "header") &&
          entry.kind === "header"
        ) {
          tracked.set(rule.id, operation);
        }
      }
    },

    takeInstallErrors(): readonly DnrInstallError[] {
      const errors = lastInstallErrors;
      lastInstallErrors = [];
      return errors;
    },

    async install(
      operations: readonly RogatioOperation[],
    ): Promise<
      { ok: true } | { ok: false; diagnostics: readonly CoreDiagnostic[] }
    > {
      lastInstallErrors = [];
      const addRules: DnrRule[] = [];
      const added: Array<{ ruleId: number; operation: RogatioOperation }> = [];
      const usedIds = new Set<number>();
      const headerOps: HeaderOperation[] = [];
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
          if (
            query.action.params.some(
              (param) =>
                param.operation !== "remove" &&
                typeof param.value === "string" &&
                containsUrlCaptureReference(param.value),
            )
          ) {
            lastInstallErrors.push({
              ruleId: query.ruleId,
              message: "Dynamic query values require the native runtime.",
            });
            continue;
          }
          let id = ruleIdHash(query.ruleId);
          while (usedIds.has(id)) id = (id % REDIRECT_QUERY_ID_MAX) + 1;
          usedIds.add(id);
          addRules.push(translateQueryToDnr(query, id));
          added.push({ ruleId: id, operation: query });
        } else if (operation.kind === "header") {
          const header = operation as HeaderOperation;
          if (
            header.header.operation !== "remove" &&
            typeof header.header.value === "string" &&
            containsUrlCaptureReference(header.header.value)
          ) {
            lastInstallErrors.push({
              ruleId: header.ruleId,
              message: "Dynamic header values require the native runtime.",
            });
            continue;
          }
          headerOps.push(header);
        }
      }
      for (const projection of projectHeaders(headerOps)) {
        addRules.push(toDnrRule(projection));
        const operation = headerOps.find(
          (candidate) => candidate.ruleId === projection.ruleId,
        );
        if (operation !== undefined) {
          added.push({ ruleId: projection.id, operation });
        }
      }
      const dnr = api.declarativeNetRequest;
      if (dnr === undefined) {
        return {
          ok: false,
          diagnostics: [coreDiagnostic("core.install-failed")],
        };
      }

      // Chrome live set is authority for remove (ADR 0009). Fail closed if
      // unreadable — never treat as empty and add (duplicate-id / wipe risk).
      // Unified replace touches both Rogatio bands; foreign ids stay untouched.
      let liveOwned: number[];
      try {
        const live = await dnr.getDynamicRules();
        if (!Array.isArray(live)) {
          return {
            ok: false,
            diagnostics: [coreDiagnostic("core.install-failed")],
          };
        }
        liveOwned = [
          ...removeIdsForBand(live, "redirect-query"),
          ...removeIdsForBand(live, "header"),
        ];
      } catch (error) {
        const reason = chromeFailureMessage(error);
        return {
          ok: false,
          diagnostics: [coreDiagnostic("core.install-failed", { reason })],
        };
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
          const message = chromeFailureMessage(error);
          lastInstallErrors.push({
            ruleId: entry.operation.ruleId,
            message,
          });
          console.log(
            "[rogatio] DNR install failed:",
            message,
            JSON.stringify(rule),
          );
        }
      }

      // Preserve prior index when every add fails. Empty or header-less
      // install still rewrites both Rogatio slices (unified replace).
      if (anySucceeded || orphanIds.length > 0 || operations.length === 0) {
        await writeWholesaleMatchIndex();
      }

      if (anyFailed && tracked.size === 0 && operations.length > 0) {
        const reason = lastInstallErrors[0]?.message;
        return {
          ok: false,
          diagnostics: [
            reason === undefined
              ? coreDiagnostic("core.install-failed")
              : coreDiagnostic("core.install-failed", { reason }),
          ],
        };
      }
      return { ok: true };
    },
  };
}
