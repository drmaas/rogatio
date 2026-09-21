/**
 * Phase 1 probe (#163 body-rule-match-logging): prove session (preferred) or
 * dynamic DNR `modifyHeaders` with reserved requestHeaders marker + strip
 * fires `onRuleMatchedDebug` for body-shaped URL matchers and does not leak
 * marker headers upstream.
 *
 * Probe notes (locked after empirical Chrome 153 — cite for §3 / ADR 0006):
 * - Rule class: **session** (`updateSessionRules`) succeeded; dynamic unused.
 * - Id band: session body band `3_000_001+` (request `3_000_001`, response
 *   `3_000_002`).
 * - Empirical variants (same reserved header `X-Rogatio-Dispatch-BodyMatch`):
 *   1. Same-rule set+remove → event fires, **leaks** upstream.
 *   2. DNR set + higher-priority DNR remove → **no leak**, events **silent**.
 *   3. Remove-only when header absent → no leak, events **silent**.
 *   4. **Locked:** remove-only when header present (probe client sends inert
 *      value) → event fires + no leak. Proves reserved-name strip + match
 *      signal. §2 must not ship DNR set+DNR strip of the same header if both
 *      asserts are required; prefer remove-when-present, or DNR set with
 *      non-DNR strip (runtime) once session proxy strips are live.
 * - Inert values: opaque probe ids; forbid capability/digest/rewrite-auth.
 * - Gate: both request-body and response-body shapes passed event + no-leak.
 * - No responseHeaders-only mechanism.
 */
import type { WebDriver } from "selenium-webdriver";
import { expect as vitestExpect } from "vitest";
import { waitForExtensionServiceWorker } from "./cdp-service-worker.js";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";
import { Page } from "./page.js";

const SMOKE_ORIGIN = "http://127.0.0.1:4173";
const SMOKE_HOST_PATTERN = `${SMOKE_ORIGIN}/*`;

/** Session body-marker band (plan / ADR 0009 amendment): 3_000_001+. */
const REQUEST_BODY_RULE_ID = 3_000_001;
const RESPONSE_BODY_RULE_ID = 3_000_002;

const MARKER_HEADER = "X-Rogatio-Dispatch-BodyMatch";
/** Inert opaque id — must not look like F17 capability / digest / rewrite auth. */
const INERT_MARKER_VALUE = "body-match-probe-opaque-3000001";

const FORBIDDEN_VALUE_SUBSTRINGS = [
  "capability",
  "digest",
  "pending-auth",
  "rewrite-auth",
  "session-capability",
] as const;

type ProbeMatchEvent = {
  readonly ruleId: number;
  readonly url?: string;
};

type RuleStore = "session" | "dynamic";

type InstallResult = {
  readonly accepted: boolean;
  readonly store: RuleStore | null;
  readonly message: string | null;
};

type BodyShape = "request-body" | "response-body";

function pathForShape(shape: BodyShape): string {
  return shape === "request-body"
    ? "/body-match-probe-request"
    : "/body-match-probe-response";
}

function ruleIdForShape(shape: BodyShape): number {
  return shape === "request-body"
    ? REQUEST_BODY_RULE_ID
    : RESPONSE_BODY_RULE_ID;
}

async function withNewTab<T>(
  driver: WebDriver,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const original = await driver.getWindowHandle();
  await driver.switchTo().newWindow("tab");
  const page = new Page(driver);
  try {
    return await fn(page);
  } finally {
    await driver.close();
    await driver.switchTo().window(original);
  }
}

async function installProbeListener(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr?.onRuleMatchedDebug?.addListener) return false;
    const events: ProbeMatchEvent[] = [];
    (
      globalThis as { __rogatioBodyMatchProbeEvents?: ProbeMatchEvent[] }
    ).__rogatioBodyMatchProbeEvents = events;
    dnr.onRuleMatchedDebug.addListener((info) => {
      events.push({
        ruleId: info.rule.ruleId,
        url: info.request.url,
      });
    });
    return true;
  });
}

async function readProbeEvents(page: Page): Promise<ProbeMatchEvent[]> {
  return page.evaluate(() => {
    const events = (
      globalThis as { __rogatioBodyMatchProbeEvents?: ProbeMatchEvent[] }
    ).__rogatioBodyMatchProbeEvents;
    return events ? [...events] : [];
  });
}

async function clearProbeEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events = (
      globalThis as { __rogatioBodyMatchProbeEvents?: ProbeMatchEvent[] }
    ).__rogatioBodyMatchProbeEvents;
    if (events) events.length = 0;
  });
}

/**
 * Locked shape: session (preferred) remove-only on reserved header name,
 * body-shaped URL matcher (`xmlhttprequest` + smoke regex). Falls back to
 * dynamic only if session install throws.
 */
async function installBodyMarkerRule(
  page: Page,
  ruleId: number,
  pathSuffix: string,
): Promise<InstallResult> {
  return page.evaluate(
    async ({ id, suffix, headerName }) => {
      const dnr = chrome.declarativeNetRequest;
      if (!dnr) {
        return {
          accepted: false,
          store: null,
          message: "declarativeNetRequest unavailable",
        };
      }

      const rule = {
        id,
        priority: 400,
        action: {
          type: "modifyHeaders" as const,
          requestHeaders: [
            {
              header: headerName,
              operation: "remove" as const,
            },
          ],
        },
        condition: {
          regexFilter: `^http://127\\.0\\.0\\.1:4173${suffix}`,
          resourceTypes: ["xmlhttprequest" as const],
          requestMethods: ["get" as const],
        },
      };

      const dnrApi = dnr;
      type SessionDnr = {
        updateSessionRules?: (options: {
          addRules: Array<typeof rule>;
          removeRuleIds: number[];
        }) => Promise<void>;
        getSessionRules?: () => Promise<Array<{ id: number }>>;
      };
      const sessionApi = dnrApi as SessionDnr;
      const sessionUpdate = sessionApi.updateSessionRules;

      async function installedIds(
        store: "session" | "dynamic",
      ): Promise<number[]> {
        if (
          store === "session" &&
          typeof sessionApi.getSessionRules === "function"
        ) {
          const listed = await sessionApi.getSessionRules();
          return listed.map((r) => r.id);
        }
        const listed = await dnrApi.getDynamicRules();
        return listed.map((r) => r.id);
      }

      if (typeof sessionUpdate === "function") {
        try {
          await sessionUpdate.call(dnrApi, {
            addRules: [rule],
            removeRuleIds: [],
          });
          const ids = await installedIds("session");
          return {
            accepted: true,
            store: "session" as const,
            message: `mode=remove-when-present; installedIds=${JSON.stringify(ids)}`,
          };
        } catch (sessionError) {
          const sessionMessage =
            sessionError instanceof Error
              ? sessionError.message
              : String(sessionError);
          try {
            await dnrApi.updateDynamicRules({
              addRules: [rule],
              removeRuleIds: [],
            });
            const ids = await installedIds("dynamic");
            return {
              accepted: true,
              store: "dynamic" as const,
              message: `mode=remove-when-present; session failed (${sessionMessage}); used dynamic fallback; installedIds=${JSON.stringify(ids)}`,
            };
          } catch (dynamicError) {
            return {
              accepted: false,
              store: null,
              message: `session: ${sessionMessage}; dynamic: ${
                dynamicError instanceof Error
                  ? dynamicError.message
                  : String(dynamicError)
              }`,
            };
          }
        }
      }

      try {
        await dnrApi.updateDynamicRules({
          addRules: [rule],
          removeRuleIds: [],
        });
        const ids = await installedIds("dynamic");
        return {
          accepted: true,
          store: "dynamic" as const,
          message: `mode=remove-when-present; updateSessionRules unavailable; used dynamic fallback; installedIds=${JSON.stringify(ids)}`,
        };
      } catch (error) {
        return {
          accepted: false,
          store: null,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      id: ruleId,
      suffix: pathSuffix,
      headerName: MARKER_HEADER,
    },
  );
}

async function removeBodyMarkerRule(
  page: Page,
  ruleId: number,
  store: RuleStore | null,
): Promise<void> {
  if (!store) return;
  await page.evaluate(
    async ({ id, ruleStore }) => {
      const dnr = chrome.declarativeNetRequest;
      if (!dnr) return;
      try {
        if (ruleStore === "session") {
          const sessionUpdate = (
            dnr as {
              updateSessionRules?: (options: {
                addRules: never[];
                removeRuleIds: number[];
              }) => Promise<void>;
            }
          ).updateSessionRules;
          if (typeof sessionUpdate === "function") {
            await sessionUpdate.call(dnr, {
              addRules: [],
              removeRuleIds: [id],
            });
          }
          return;
        }
        await dnr.updateDynamicRules({
          addRules: [],
          removeRuleIds: [id],
        });
      } catch {
        // Best-effort cleanup.
      }
    },
    { id: ruleId, ruleStore: store },
  );
}

type UpstreamEcho = {
  readonly ok: boolean;
  readonly status: number;
  readonly seenRequestHeaders: Record<string, string>;
};

async function triggerBodyProbeFetch(
  driver: WebDriver,
  path: string,
  requestHeaders: Record<string, string>,
): Promise<UpstreamEcho> {
  return withNewTab(driver, async (webPage) => {
    await webPage.goto(`${SMOKE_ORIGIN}/browser-fixture.html`);
    return webPage.evaluate(
      async ({ probeUrl, headers }) => {
        const response = await fetch(probeUrl, {
          method: "GET",
          headers,
        });
        const status = response.status;
        let seenRequestHeaders: Record<string, string> = {};
        try {
          const body = (await response.json()) as {
            seenRequestHeaders?: Record<string, string>;
          };
          seenRequestHeaders = body.seenRequestHeaders ?? {};
        } catch {
          seenRequestHeaders = {};
        }
        return { ok: response.ok, status, seenRequestHeaders };
      },
      { probeUrl: `${SMOKE_ORIGIN}${path}`, headers: requestHeaders },
    );
  });
}

function headerPresent(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function anyReservedDispatchHeader(
  headers: Record<string, string>,
): string | null {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith("x-rogatio-dispatch-")) return key;
  }
  return null;
}

async function runBodyShapeProbe(
  page: Page,
  driver: WebDriver,
  shape: BodyShape,
): Promise<{
  store: RuleStore | null;
  eventFired: boolean;
  noLeak: boolean;
  notes: string;
  upstreamKeys: string[];
}> {
  const ruleId = ruleIdForShape(shape);
  const path = pathForShape(shape);
  const markerValue = `${INERT_MARKER_VALUE}-${shape}`;

  vitestExpect(
    FORBIDDEN_VALUE_SUBSTRINGS.every(
      (s) => !markerValue.toLowerCase().includes(s),
    ),
    `probe marker value must be inert (no capability/digest/auth): ${markerValue}`,
  ).toBe(true);

  await clearProbeEvents(page);

  const install = await installBodyMarkerRule(page, ruleId, path);
  vitestExpect(
    install.accepted,
    install.message ?? `${shape} marker install failed`,
  ).toBe(true);

  try {
    // Client sends reserved header with inert value so the session remove rule
    // has a real header to strip (absent-header remove is a silent no-op in
    // Chrome 153). Product §2/§3: DNR set alone leaks; DNR set+DNR strip
    // silences onRuleMatchedDebug; remove-when-present fires + no-leak.
    const upstream = await triggerBodyProbeFetch(driver, path, {
      [MARKER_HEADER]: markerValue,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const events = await readProbeEvents(page);
    const eventFired = events.some((event) => event.ruleId === ruleId);
    // Fail closed if smoke echo is missing/stale (wrong worktree on :4173):
    // empty headers would make noLeak vacuously true.
    const echoLive =
      upstream.ok &&
      upstream.status === 200 &&
      headerPresent(upstream.seenRequestHeaders, "host");
    const leakedName =
      anyReservedDispatchHeader(upstream.seenRequestHeaders) ??
      (headerPresent(upstream.seenRequestHeaders, MARKER_HEADER)
        ? MARKER_HEADER
        : null);
    const noLeak = echoLive && leakedName === null;

    const notes = [
      `shape=${shape}`,
      `mode=remove-when-present`,
      `store=${install.store ?? "none"}`,
      install.message ? `installNote=${install.message}` : null,
      `eventFired=${eventFired}`,
      `echoLive=${echoLive}`,
      `noLeak=${noLeak}`,
      leakedName ? `leakedHeader=${leakedName}` : null,
      `upstreamStatus=${upstream.status}`,
      `events=${JSON.stringify(events)}`,
    ]
      .filter(Boolean)
      .join("; ");

    return {
      store: install.store,
      eventFired,
      noLeak,
      notes,
      upstreamKeys: Object.keys(upstream.seenRequestHeaders),
    };
  } finally {
    await removeBodyMarkerRule(page, ruleId, install.store);
  }
}

test("body-match probe — request-body and response-body URL markers", async ({
  registerDriver,
}) => {
  const { driver, page, extensionId, close } = await extensionContext({
    grantOrigins: [SMOKE_HOST_PATTERN],
  });
  registerDriver(driver, close);

  expect(await waitForExtensionServiceWorker(driver, extensionId)).toBe(true);

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  const hostGranted = await page.evaluate(async (originPattern) => {
    return chrome.permissions.contains({ origins: [originPattern] });
  }, SMOKE_HOST_PATTERN);
  vitestExpect(hostGranted).toBe(true);

  vitestExpect(await installProbeListener(page)).toBe(true);

  const requestResult = await runBodyShapeProbe(page, driver, "request-body");
  vitestExpect(
    requestResult.eventFired,
    requestResult.notes || "request-body: onRuleMatchedDebug did not fire",
  ).toBe(true);
  vitestExpect(
    requestResult.noLeak,
    requestResult.notes ||
      `request-body: marker leaked upstream; keys=${JSON.stringify(requestResult.upstreamKeys)}`,
  ).toBe(true);

  const responseResult = await runBodyShapeProbe(page, driver, "response-body");
  vitestExpect(
    responseResult.eventFired,
    responseResult.notes || "response-body: onRuleMatchedDebug did not fire",
  ).toBe(true);
  vitestExpect(
    responseResult.noLeak,
    responseResult.notes ||
      `response-body: marker leaked upstream; keys=${JSON.stringify(responseResult.upstreamKeys)}`,
  ).toBe(true);

  // Gate record for later phases (§3): both shapes passed event + no-leak.
  // Winning rule class: session (see notes). Response-body ship path unlocked.
  vitestExpect(requestResult.store).toBe("session");
  vitestExpect(responseResult.store).toBe("session");
});
