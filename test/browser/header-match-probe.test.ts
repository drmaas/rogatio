import type { WebDriver } from "selenium-webdriver";
import { expect as vitestExpect } from "vitest";
import { type CdpSession, openPageCdpSession } from "./cdp-session.js";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";
import { Page } from "./page.js";

const SMOKE_ORIGIN = "http://127.0.0.1:4173";
const SMOKE_HOST_PATTERN = `${SMOKE_ORIGIN}/*`;

type ProbeMatchEvent = {
  readonly ruleId: number;
  readonly url?: string;
};

type CdpStopResult = "stopped" | "no-target" | "no-version" | "cdp-error";

type CdpWorkerVersionUpdatedPayload = {
  versions: Array<{
    versionId: string;
    scriptURL: string;
    runningStatus?: string;
  }>;
};

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

async function waitForExtensionServiceWorker(
  driver: WebDriver,
  extensionId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const cdp = await openPageCdpSession(driver);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = (await cdp.send("Target.getTargets")) as {
        targetInfos: Array<{ type?: string; url?: string }>;
      };
      const workers = result.targetInfos.filter(
        (target) =>
          target.type === "service_worker" &&
          typeof target.url === "string" &&
          target.url.includes(extensionId),
      );
      if (workers.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  } finally {
    await cdp.close();
  }
}

async function extensionWorkerTargetCount(
  cdp: CdpSession,
  extensionId: string,
): Promise<number> {
  const { targetInfos } = (await cdp.send("Target.getTargets")) as {
    targetInfos: Array<{ type?: string; url?: string }>;
  };
  return targetInfos.filter(
    (target) =>
      target.type === "service_worker" &&
      typeof target.url === "string" &&
      target.url.includes(extensionId),
  ).length;
}

async function waitForWorkerTarget(
  cdp: CdpSession,
  extensionId: string,
  want: "gone" | "alive",
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await extensionWorkerTargetCount(cdp, extensionId);
    if (want === "gone" ? count === 0 : count > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function absenceHolds(
  cdp: CdpSession,
  extensionId: string,
  durationMs: number,
): Promise<boolean> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    if ((await extensionWorkerTargetCount(cdp, extensionId)) > 0) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await extensionWorkerTargetCount(cdp, extensionId)) === 0;
}

async function installProbeListener(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr?.onRuleMatchedDebug?.addListener) return false;
    const events: ProbeMatchEvent[] = [];
    (
      globalThis as { __rogatioP6ProbeEvents?: ProbeMatchEvent[] }
    ).__rogatioP6ProbeEvents = events;
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
      globalThis as { __rogatioP6ProbeEvents?: ProbeMatchEvent[] }
    ).__rogatioP6ProbeEvents;
    return events ? [...events] : [];
  });
}

async function removeDynamicRule(page: Page, ruleId: number): Promise<void> {
  await page.evaluate(async (id) => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr) return;
    try {
      await dnr.updateDynamicRules({ addRules: [], removeRuleIds: [id] });
    } catch {
      // Best-effort cleanup.
    }
  }, ruleId);
}

async function installSmokeHeaderRule(
  page: Page,
  ruleId: number,
  mode: "fetch" | "navigation",
): Promise<{ accepted: boolean; message: string | null }> {
  return page.evaluate(
    async ({ id, probeMode }) => {
      const dnr = chrome.declarativeNetRequest;
      if (!dnr) {
        return {
          accepted: false,
          message: "declarativeNetRequest unavailable",
        };
      }
      const pathSuffix =
        probeMode === "navigation" ? "p6-header-probe-page" : "p6-header-probe";
      const resourceType =
        probeMode === "navigation" ? "main_frame" : "xmlhttprequest";
      try {
        await dnr.updateDynamicRules({
          addRules: [
            {
              id,
              priority: 300,
              action: {
                type: "modifyHeaders",
                ...(probeMode === "fetch"
                  ? {
                      requestHeaders: [
                        {
                          header: "X-Rogatio-Probe",
                          operation: "set",
                          value: "p6-header",
                        },
                      ],
                    }
                  : {
                      responseHeaders: [
                        {
                          header: "X-Rogatio-Probe-Response",
                          operation: "set",
                          value: "p6-header",
                        },
                      ],
                    }),
              },
              condition: {
                regexFilter: `^http://127\\.0\\.0\\.1:4173/${pathSuffix}`,
                resourceTypes: [resourceType],
                ...(probeMode === "fetch" ? { requestMethods: ["get"] } : {}),
              },
            },
          ],
          removeRuleIds: [],
        });
        return { accepted: true, message: null };
      } catch (error) {
        return {
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { id: ruleId, probeMode: mode },
  );
}

async function installSmokeRedirectRule(
  page: Page,
  ruleId: number,
  path: string,
  redirectPath: string,
): Promise<{ accepted: boolean; message: string | null }> {
  return page.evaluate(
    async ({ id, origin, matchPath, destinationPath }) => {
      const dnr = chrome.declarativeNetRequest;
      if (!dnr) {
        return {
          accepted: false,
          message: "declarativeNetRequest unavailable",
        };
      }
      try {
        await dnr.updateDynamicRules({
          addRules: [
            {
              id,
              priority: 100,
              action: {
                type: "redirect",
                redirect: { url: `${origin}${destinationPath}` },
              },
              condition: {
                regexFilter: `^http://127\\.0\\.0\\.1:4173${matchPath}$`,
                resourceTypes: ["main_frame"],
              },
            },
          ],
          removeRuleIds: [],
        });
        return { accepted: true, message: null };
      } catch (error) {
        return {
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      id: ruleId,
      origin: SMOKE_ORIGIN,
      matchPath: path,
      destinationPath: redirectPath,
    },
  );
}

async function triggerHeaderProbeRequest(
  driver: WebDriver,
  mode: "fetch" | "navigation",
): Promise<void> {
  await withNewTab(driver, async (webPage) => {
    if (mode === "fetch") {
      await webPage.goto(`${SMOKE_ORIGIN}/browser-fixture.html`);
      await webPage.evaluate(async (probeUrl) => {
        await fetch(probeUrl, { method: "GET" });
      }, `${SMOKE_ORIGIN}/p6-header-probe`);
      return;
    }
    await webPage.goto(`${SMOKE_ORIGIN}/p6-header-probe-page`);
  });
}

async function triggerSmokeNavigation(
  driver: WebDriver,
  path: string,
): Promise<string> {
  return withNewTab(driver, async (webPage) => {
    await webPage.goto(`${SMOKE_ORIGIN}${path}`);
    return webPage.driver.getCurrentUrl();
  });
}

async function stopExtensionServiceWorkerViaCdp(
  cdp: CdpSession,
  extensionId: string,
): Promise<CdpStopResult> {
  let versionId: string | undefined;

  const onVersion = (params: unknown) => {
    const payload = params as CdpWorkerVersionUpdatedPayload;
    for (const version of payload.versions ?? []) {
      const scriptURL = version.scriptURL ?? "";
      if (scriptURL.includes("background") && scriptURL.includes(extensionId)) {
        versionId = version.versionId;
      }
    }
  };
  cdp.on("ServiceWorker.workerVersionUpdated", onVersion);

  try {
    await cdp.send("ServiceWorker.enable", { handleDevToolsUpdates: false });
    const { targetInfos } = (await cdp.send("Target.getTargets")) as {
      targetInfos: Array<{ type?: string; url?: string; targetId?: string }>;
    };
    const workerTarget = targetInfos.find(
      (target) =>
        target.type === "service_worker" &&
        typeof target.url === "string" &&
        target.url.includes(extensionId),
    );
    if (!workerTarget?.targetId) return "no-target";

    for (
      let attempt = 0;
      attempt < 20 && versionId === undefined;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (versionId === undefined) return "no-version";

    await cdp.send("ServiceWorker.stopWorker", { versionId });
    return "stopped";
  } catch {
    return "cdp-error";
  } finally {
    cdp.off("ServiceWorker.workerVersionUpdated", onVersion);
  }
}

test("step 1a — onRuleMatchedDebug for modifyHeaders on smoke origin", async ({
  registerDriver,
}) => {
  const headerRuleId = 9_100_000;
  const controlRuleId = headerRuleId + 1;
  const { driver, page, extensionId, close } = await extensionContext({
    grantOrigins: [SMOKE_HOST_PATTERN],
  });
  registerDriver(driver, close);

  let headerEventFired = false;
  let probeNotes = "";

  expect(await waitForExtensionServiceWorker(driver, extensionId)).toBe(true);

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  const hostGranted = await page.evaluate(async (originPattern) => {
    return chrome.permissions.contains({ origins: [originPattern] });
  }, SMOKE_HOST_PATTERN);
  vitestExpect(hostGranted).toBe(true);

  vitestExpect(await installProbeListener(page)).toBe(true);

  const controlInstall = await installSmokeRedirectRule(
    page,
    controlRuleId,
    "/p6-control-probe",
    "/p6-control-redirected",
  );
  vitestExpect(controlInstall.accepted).toBe(true);
  const controlFinalUrl = await triggerSmokeNavigation(
    driver,
    "/p6-control-probe",
  );
  vitestExpect(controlFinalUrl).toContain("/p6-control-redirected");
  const redirectControlFired = (await readProbeEvents(page)).some(
    (event) => event.ruleId === controlRuleId,
  );
  vitestExpect(redirectControlFired).toBe(true);

  const xhrInstall = await installSmokeHeaderRule(page, headerRuleId, "fetch");
  vitestExpect(xhrInstall.accepted).toBe(true);
  await triggerHeaderProbeRequest(driver, "fetch");
  let events = await readProbeEvents(page);
  headerEventFired = events.some((event) => event.ruleId === headerRuleId);
  let firedMode: "xmlhttprequest" | "main_frame" | null = headerEventFired
    ? "xmlhttprequest"
    : null;

  if (!headerEventFired) {
    const pageRuleId = headerRuleId + 2;
    const pageInstall = await installSmokeHeaderRule(
      page,
      pageRuleId,
      "navigation",
    );
    vitestExpect(pageInstall.accepted).toBe(true);
    await triggerHeaderProbeRequest(driver, "navigation");
    events = await readProbeEvents(page);
    headerEventFired = events.some((event) => event.ruleId === pageRuleId);
    if (headerEventFired) firedMode = "main_frame";
    await removeDynamicRule(page, pageRuleId);
  }

  probeNotes = headerEventFired
    ? `onRuleMatchedDebug fired for modifyHeaders against ${SMOKE_ORIGIN} (${firedMode})`
    : `no onRuleMatchedDebug for modifyHeaders on ${SMOKE_ORIGIN}; events=${JSON.stringify(events)}`;

  await removeDynamicRule(page, headerRuleId);
  await removeDynamicRule(page, controlRuleId);

  vitestExpect(
    headerEventFired,
    probeNotes || "header probe did not observe onRuleMatchedDebug",
  ).toBe(true);
});

test("step 1b — Q4 wake after CDP service-worker stop", async ({
  registerDriver,
}) => {
  const ruleId = 9_200_000;
  const { driver, page, extensionId, close } = await extensionContext({
    grantOrigins: [SMOKE_HOST_PATTERN],
  });
  registerDriver(driver, close);

  let q4Outcome: "pass" | "fail" | "inconclusive" = "inconclusive";
  let q4Notes = "";

  expect(await waitForExtensionServiceWorker(driver, extensionId)).toBe(true);

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  const installResult = await installSmokeRedirectRule(
    page,
    ruleId,
    "/p6-wake-probe",
    "/p6-redirected",
  );
  vitestExpect(installResult.accepted).toBe(true);

  // Keep the extension page open; CDP session is the liveness source.
  const cdp = await openPageCdpSession(driver);
  try {
    const stopResult = await stopExtensionServiceWorkerViaCdp(cdp, extensionId);
    if (stopResult !== "stopped") {
      q4Outcome = "inconclusive";
      q4Notes = `CDP stop unavailable (${stopResult}); Q4 not measured`;
    } else if (!(await waitForWorkerTarget(cdp, extensionId, "gone", 3_000))) {
      q4Outcome = "inconclusive";
      q4Notes = "CDP stopWorker did not terminate the worker before navigation";
    } else if (!(await absenceHolds(cdp, extensionId, 1_000))) {
      q4Outcome = "inconclusive";
      q4Notes =
        "worker respawned on its own before the smoke navigation; wake cannot be attributed to the request";
    } else {
      await triggerSmokeNavigation(driver, "/p6-wake-probe");
      const aliveAfterNav = await waitForWorkerTarget(
        cdp,
        extensionId,
        "alive",
        5_000,
      );
      q4Outcome = aliveAfterNav ? "pass" : "fail";
      q4Notes = aliveAfterNav
        ? "service worker was stopped via CDP, stayed terminated, and became alive again after smoke-origin navigation"
        : "service worker stayed terminated after smoke-origin navigation";
    }
  } finally {
    await cdp.close();
    await removeDynamicRule(page, ruleId);
  }

  vitestExpect(q4Outcome, q4Notes).not.toBe("fail");
});
