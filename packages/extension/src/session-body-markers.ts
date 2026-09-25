import type {
  RequestBodyOperation,
  ResponseBodyOperation,
} from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";

/**
 * Body URL-match markers live in the Chrome **session** rule store.
 * Band starts at 3_000_001 (ADR 0009 amendment). Dynamic redirect/query
 * (1–1_000_000) and header (2_000_001+) bands are a separate store.
 */
export const BODY_MARKER_ID_MIN = 3_000_001;

/** Reserved request header name for logging-only markers (runtime strips). */
export const BODY_MARKER_HEADER_NAME = "X-Rogatio-Dispatch-BodyMatch";

export type BodyMarkerOperation = RequestBodyOperation | ResponseBodyOperation;

export interface BodyMarkerSessionRule {
  readonly id: number;
  readonly priority: number;
  readonly action: {
    readonly type: "modifyHeaders";
    readonly requestHeaders: readonly [
      {
        readonly header: string;
        readonly operation: "set";
        readonly value: string;
      },
    ];
  };
  readonly condition: {
    readonly regexFilter: string;
    readonly resourceTypes: readonly string[];
    /** Same as header modifyHeaders: request URL host, not initiator. */
    readonly requestDomains?: readonly string[];
    readonly excludedRequestDomains?: readonly string[];
    readonly requestMethods?: readonly string[];
  };
}

export function isBodyMarkerBandId(id: number): boolean {
  return Number.isInteger(id) && id >= BODY_MARKER_ID_MIN;
}

export function bodyMarkerIdForIndex(index: number): number {
  return BODY_MARKER_ID_MIN + index;
}

/** Opaque match-log sentinel — never capability / digest / rewrite auth. */
export function inertMarkerValue(id: number): string {
  return String(id);
}

/** Align with `toDnrRule` origin → requestDomains (installer.ts). */
function requestDomainsFromOrigins(origins: readonly string[]): {
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
        allowed.push(new URL(origin).hostname);
      } catch {
        allowed.push(origin);
      }
    }
  }
  return { allowed, excluded };
}

export function buildBodyMarkerRule(
  operation: BodyMarkerOperation,
  id: number,
): BodyMarkerSessionRule {
  const { allowed: requestDomains, excluded: excludedRequestDomains } =
    requestDomainsFromOrigins(operation.matcher.origins);
  const requestMethods =
    operation.matcher.method !== undefined
      ? [operation.matcher.method.toLowerCase()]
      : undefined;

  return {
    id,
    priority: operation.matcher.priority,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: BODY_MARKER_HEADER_NAME,
          operation: "set",
          value: inertMarkerValue(id),
        },
      ],
    },
    condition: {
      // requestDomains (not initiatorDomains): same reason as header DNR —
      // main_frame / cross-initiator XHR still match when URL host is in scope.
      regexFilter: operation.matcher.urlRegex.source,
      resourceTypes: [...operation.matcher.resourceTypes],
      ...(requestDomains.length > 0 ? { requestDomains } : {}),
      ...(excludedRequestDomains.length > 0 ? { excludedRequestDomains } : {}),
      ...(requestMethods !== undefined ? { requestMethods } : {}),
    },
  };
}

function isBodyMarkerOperation(
  operation: unknown,
): operation is BodyMarkerOperation {
  if (operation === null || typeof operation !== "object") return false;
  const kind = (operation as { kind?: unknown }).kind;
  return kind === "request-body" || kind === "response-body";
}

function removeIdsForBodyBand(live: ReadonlyArray<{ id: number }>): number[] {
  return live.map((rule) => rule.id).filter(isBodyMarkerBandId);
}

export type BodyMarkerInstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface BodyMarkerSessionHelper {
  install(
    operations: readonly BodyMarkerOperation[],
  ): Promise<BodyMarkerInstallResult>;
  removeOwned(): Promise<BodyMarkerInstallResult>;
}

/**
 * Session-store helper for body URL-match logging markers.
 * Never calls `updateDynamicRules`. Remove set = `getSessionRules ∩` body band.
 */
export function createBodyMarkerSessionHelper(
  api: ChromeApi,
): BodyMarkerSessionHelper {
  async function sessionPorts(): Promise<
    | {
        getSessionRules: NonNullable<
          NonNullable<ChromeApi["declarativeNetRequest"]>["getSessionRules"]
        >;
        updateSessionRules: NonNullable<
          NonNullable<ChromeApi["declarativeNetRequest"]>["updateSessionRules"]
        >;
      }
    | undefined
  > {
    const dnr = api.declarativeNetRequest;
    if (dnr === undefined) return undefined;
    if (
      typeof dnr.getSessionRules !== "function" ||
      typeof dnr.updateSessionRules !== "function"
    ) {
      return undefined;
    }
    return {
      getSessionRules: dnr.getSessionRules.bind(dnr),
      updateSessionRules: dnr.updateSessionRules.bind(dnr),
    };
  }

  return {
    async install(
      operations: readonly BodyMarkerOperation[],
    ): Promise<BodyMarkerInstallResult> {
      const ports = await sessionPorts();
      if (ports === undefined) {
        return { ok: false, reason: "extension.session-rules-unavailable" };
      }

      let live: Array<{ id: number }>;
      try {
        live = await ports.getSessionRules();
      } catch {
        return { ok: false, reason: "extension.session-rules-unreadable" };
      }
      if (!Array.isArray(live)) {
        return { ok: false, reason: "extension.session-rules-unreadable" };
      }

      const bodyOps = operations.filter(isBodyMarkerOperation);
      const addRules = bodyOps.map((operation, index) =>
        buildBodyMarkerRule(operation, bodyMarkerIdForIndex(index)),
      );
      const removeRuleIds = removeIdsForBodyBand(live);

      try {
        await ports.updateSessionRules({
          removeRuleIds,
          addRules,
        });
      } catch {
        return { ok: false, reason: "extension.session-rules-update-failed" };
      }
      return { ok: true };
    },

    async removeOwned(): Promise<BodyMarkerInstallResult> {
      const ports = await sessionPorts();
      if (ports === undefined) {
        return { ok: false, reason: "extension.session-rules-unavailable" };
      }

      let live: Array<{ id: number }>;
      try {
        live = await ports.getSessionRules();
      } catch {
        return { ok: false, reason: "extension.session-rules-unreadable" };
      }
      if (!Array.isArray(live)) {
        return { ok: false, reason: "extension.session-rules-unreadable" };
      }

      const removeRuleIds = removeIdsForBodyBand(live);
      if (removeRuleIds.length === 0) return { ok: true };

      try {
        await ports.updateSessionRules({
          removeRuleIds,
          addRules: [],
        });
      } catch {
        return { ok: false, reason: "extension.session-rules-update-failed" };
      }
      return { ok: true };
    },
  };
}
