import { rm } from "node:fs/promises";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { extensionContext } from "./extension-context.js";

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

type CdpSession = Awaited<ReturnType<BrowserContext["newCDPSession"]>>;

async function waitForExtensionServiceWorker(
  context: BrowserContext,
  extensionId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workers = context
      .serviceWorkers()
      .filter((worker) => worker.url().includes(extensionId));
    if (workers.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// `context.serviceWorkers()` keeps a terminated extension worker in its cache,
// so worker liveness after a stop is read from live CDP targets instead.
async function extensionWorkerTargetCount(
  cdp: CdpSession,
  extensionId: string,
): Promise<number> {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter(
    (target: { type?: string; url?: string }) =>
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

// A worker that respawns on its own would make a later "alive" reading
// meaningless, so absence has to hold before the triggering navigation.
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
  context: BrowserContext,
  mode: "fetch" | "navigation",
): Promise<void> {
  const webPage = await context.newPage();
  try {
    if (mode === "fetch") {
      await webPage.goto(`${SMOKE_ORIGIN}/browser-fixture.html`);
      await webPage.evaluate(async (probeUrl) => {
        await fetch(probeUrl, { method: "GET" });
      }, `${SMOKE_ORIGIN}/p6-header-probe`);
      return;
    }
    await webPage.goto(`${SMOKE_ORIGIN}/p6-header-probe-page`, {
      waitUntil: "commit",
    });
  } finally {
    await webPage.close();
  }
}

async function triggerSmokeNavigation(
  context: BrowserContext,
  path: string,
): Promise<string> {
  const webPage = await context.newPage();
  try {
    await webPage.goto(`${SMOKE_ORIGIN}${path}`, { waitUntil: "commit" });
    return webPage.url();
  } finally {
    await webPage.close();
  }
}

async function stopExtensionServiceWorkerViaCdp(
  cdp: CdpSession,
  extensionId: string,
): Promise<CdpStopResult> {
  let versionId: string | undefined;

  // `ServiceWorker.workerVersionUpdated` carries a `versions` array; reading a
  // singular `version` field silently never resolves a versionId.
  const onVersion = (params: CdpWorkerVersionUpdatedPayload) => {
    for (const version of params.versions ?? []) {
      const scriptURL = version.scriptURL ?? "";
      if (scriptURL.includes("background") && scriptURL.includes(extensionId)) {
        versionId = version.versionId;
      }
    }
  };
  const onVersionForCdp = onVersion as (
    payload: CdpWorkerVersionUpdatedPayload,
  ) => void;
  cdp.on("ServiceWorker.workerVersionUpdated", onVersionForCdp);

  try {
    await cdp.send("ServiceWorker.enable", { handleDevToolsUpdates: false });
    const { targetInfos } = await cdp.send("Target.getTargets");
    const workerTarget = targetInfos.find(
      (target: { type?: string; url?: string }) =>
        target.type === "service_worker" &&
        typeof target.url === "string" &&
        target.url.includes(extensionId),
    );
    if (!workerTarget?.targetId) return "no-target";

    // Deliberately not attaching to the worker target: a debugger attachment
    // keeps the extension worker alive and defeats the stop.
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
    cdp.off("ServiceWorker.workerVersionUpdated", onVersionForCdp);
  }
}

test.describe("P6 header coverage probe (gate)", () => {
  test("step 1a — onRuleMatchedDebug for modifyHeaders on smoke origin", async () => {
    const testInfo = test.info();
    const headerRuleId = 9_100_000 + testInfo.parallelIndex;
    const controlRuleId = headerRuleId + 1;
    const { context, profile, extensionId } = await extensionContext({
      grantOrigins: [SMOKE_HOST_PATTERN],
    });

    let headerEventFired = false;
    let probeNotes = "";

    try {
      expect(await waitForExtensionServiceWorker(context, extensionId)).toBe(
        true,
      );

      const extPage = await context.newPage();
      await extPage.goto(`chrome-extension://${extensionId}/index.html`);
      await expect(
        extPage.getByRole("heading", { name: "Rogatio" }),
      ).toBeVisible();

      const hostGranted = await extPage.evaluate(async (originPattern) => {
        return chrome.permissions.contains({ origins: [originPattern] });
      }, SMOKE_HOST_PATTERN);
      expect(hostGranted).toBe(true);

      expect(await installProbeListener(extPage)).toBe(true);

      const controlInstall = await installSmokeRedirectRule(
        extPage,
        controlRuleId,
        "/p6-control-probe",
        "/p6-control-redirected",
      );
      expect(controlInstall.accepted).toBe(true);
      const controlFinalUrl = await triggerSmokeNavigation(
        context,
        "/p6-control-probe",
      );
      expect(controlFinalUrl).toContain("/p6-control-redirected");
      const redirectControlFired = (await readProbeEvents(extPage)).some(
        (event) => event.ruleId === controlRuleId,
      );
      expect(redirectControlFired).toBe(true);

      const xhrInstall = await installSmokeHeaderRule(
        extPage,
        headerRuleId,
        "fetch",
      );
      expect(xhrInstall.accepted).toBe(true);
      await triggerHeaderProbeRequest(context, "fetch");
      let events = await readProbeEvents(extPage);
      headerEventFired = events.some((event) => event.ruleId === headerRuleId);
      let firedMode: "xmlhttprequest" | "main_frame" | null = headerEventFired
        ? "xmlhttprequest"
        : null;

      if (!headerEventFired) {
        const pageRuleId = headerRuleId + 2;
        const pageInstall = await installSmokeHeaderRule(
          extPage,
          pageRuleId,
          "navigation",
        );
        expect(pageInstall.accepted).toBe(true);
        await triggerHeaderProbeRequest(context, "navigation");
        events = await readProbeEvents(extPage);
        headerEventFired = events.some((event) => event.ruleId === pageRuleId);
        if (headerEventFired) firedMode = "main_frame";
        await removeDynamicRule(extPage, pageRuleId);
      }

      probeNotes = headerEventFired
        ? `onRuleMatchedDebug fired for modifyHeaders against ${SMOKE_ORIGIN} (${firedMode})`
        : `no onRuleMatchedDebug for modifyHeaders on ${SMOKE_ORIGIN}; events=${JSON.stringify(events)}`;

      testInfo.annotations.push({
        type: "P6-step-1a",
        description: headerEventFired ? "pass" : "fail",
      });
      testInfo.annotations.push({
        type: "P6-step-1a-detail",
        description: probeNotes,
      });

      await extPage.close();
    } finally {
      const cleanupPage = context.pages()[0] ?? (await context.newPage());
      if (
        cleanupPage.url().startsWith(`chrome-extension://${extensionId}/`) ||
        cleanupPage.url() === "about:blank"
      ) {
        await removeDynamicRule(cleanupPage, headerRuleId);
        await removeDynamicRule(cleanupPage, controlRuleId);
      }
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }

    expect(
      headerEventFired,
      probeNotes || "header probe did not observe onRuleMatchedDebug",
    ).toBe(true);
  });

  test("step 1b — Q4 wake after CDP service-worker stop", async () => {
    const testInfo = test.info();
    const ruleId = 9_200_000 + testInfo.parallelIndex;
    const { context, profile, extensionId } = await extensionContext({
      grantOrigins: [SMOKE_HOST_PATTERN],
    });

    let q4Outcome: "pass" | "fail" | "inconclusive" = "inconclusive";
    let q4Notes = "";

    try {
      expect(await waitForExtensionServiceWorker(context, extensionId)).toBe(
        true,
      );

      const setupPage = await context.newPage();
      await setupPage.goto(`chrome-extension://${extensionId}/index.html`);
      await expect(
        setupPage.getByRole("heading", { name: "Rogatio" }),
      ).toBeVisible();

      const installResult = await installSmokeRedirectRule(
        setupPage,
        ruleId,
        "/p6-wake-probe",
        "/p6-redirected",
      );
      expect(installResult.accepted).toBe(true);
      await setupPage.close();

      // The CDP page stays open for the whole measurement: a blank page does
      // not wake the extension worker, and the session is the liveness source.
      const cdpPage = await context.newPage();
      const cdp = await context.newCDPSession(cdpPage);
      const stopResult = await stopExtensionServiceWorkerViaCdp(
        cdp,
        extensionId,
      );
      if (stopResult !== "stopped") {
        q4Outcome = "inconclusive";
        q4Notes = `CDP stop unavailable (${stopResult}); Q4 not measured`;
      } else if (
        !(await waitForWorkerTarget(cdp, extensionId, "gone", 3_000))
      ) {
        q4Outcome = "inconclusive";
        q4Notes =
          "CDP stopWorker did not terminate the worker before navigation";
      } else if (!(await absenceHolds(cdp, extensionId, 1_000))) {
        q4Outcome = "inconclusive";
        q4Notes =
          "worker respawned on its own before the smoke navigation; wake cannot be attributed to the request";
      } else {
        await triggerSmokeNavigation(context, "/p6-wake-probe");
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
      await cdpPage.close();

      testInfo.annotations.push({
        type: "P6-step-1b",
        description: q4Outcome,
      });
      testInfo.annotations.push({
        type: "P6-step-1b-detail",
        description: q4Notes,
      });
    } finally {
      const cleanupPage = context.pages()[0] ?? (await context.newPage());
      if (
        cleanupPage.url().startsWith(`chrome-extension://${extensionId}/`) ||
        cleanupPage.url() === "about:blank"
      ) {
        await removeDynamicRule(cleanupPage, ruleId);
      }
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }

    expect(q4Outcome, q4Notes).not.toBe("fail");
  });
});
