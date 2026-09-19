/**
 * P4 / AC6–AC7: activate samples/basic → CDP SW stop → reopen Workspace →
 * DNR rules stay `active`; body rules stay `needs runtime`; Chrome still holds
 * the pre-stop dynamic rule ids.
 */
import type { WebDriver } from "selenium-webdriver";
import { expect as vitestExpect } from "vitest";
import { type CdpSession, openPageCdpSession } from "./cdp-session.js";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";
import type { Page } from "./page.js";
import {
  getExtensionState,
  importAndEnableSample,
  loadShippedSample,
  rewriteSampleToValidateOrigin,
  SAMPLE_GROUP_ID,
  statusFor,
  VALIDATE_HOST_PATTERN,
} from "./sample-basic-helpers.js";

const DNR_RULE_IDS = [
  "rule-redirect",
  "rule-query",
  "rule-header-set",
  "rule-header-remove",
] as const;

const BODY_RULE_IDS = ["rule-response-body", "rule-request-body"] as const;

type CdpStopResult = "stopped" | "no-target" | "no-version" | "cdp-error";

type CdpWorkerVersionUpdatedPayload = {
  versions: Array<{
    versionId: string;
    scriptURL: string;
    runningStatus?: string;
  }>;
};

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

/** Copied from header-match-probe — CDP stop must be conclusive for this journey. */
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

async function getDynamicRuleIds(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr) {
      throw new Error("chrome.declarativeNetRequest is unavailable");
    }
    const rules = await dnr.getDynamicRules();
    return rules.map((rule) => rule.id).sort((a, b) => a - b);
  });
}

type MatchIndexMap = Record<string, { ruleId?: string } | undefined>;

async function readMatchIndex(page: Page): Promise<MatchIndexMap> {
  return page.evaluate(async () => {
    const stored = (await chrome.storage.local.get(
      "rogatio.matchLogging.index",
    )) as Record<string, unknown>;
    const index = stored["rogatio.matchLogging.index"];
    return index !== null && typeof index === "object" && !Array.isArray(index)
      ? (index as MatchIndexMap)
      : {};
  });
}

function numericIdForRule(
  index: MatchIndexMap,
  ruleId: string,
): number | undefined {
  for (const [key, entry] of Object.entries(index)) {
    if (entry?.ruleId !== ruleId) continue;
    const id = Number(key);
    if (Number.isInteger(id)) return id;
  }
  return undefined;
}

function statusLine(ruleId: string, status: string): string {
  return `${SAMPLE_GROUP_ID}/${ruleId}: ${status}`;
}

function assertNamedStatuses(
  statuses: Parameters<typeof statusFor>[0],
  label: string,
): void {
  for (const ruleId of DNR_RULE_IDS) {
    vitestExpect(statusFor(statuses, ruleId), `${ruleId} ${label}`).toBe(
      "active",
    );
  }
  for (const ruleId of BODY_RULE_IDS) {
    vitestExpect(statusFor(statuses, ruleId), `${ruleId} ${label}`).toBe(
      "needs runtime",
    );
  }
}

/** AC6 + AC7: Chrome live set is exactly the four DNR sample ids; body never indexed. */
async function assertChromeDnrIdentity(
  page: Page,
  heldIds: readonly number[],
  label: string,
): Promise<void> {
  const index = await readMatchIndex(page);
  const expected: number[] = [];
  for (const ruleId of DNR_RULE_IDS) {
    const id = numericIdForRule(index, ruleId);
    vitestExpect(
      id,
      `${ruleId} ${label}: must have a Chrome/index numeric id`,
    ).toEqual(vitestExpect.any(Number));
    expected.push(id as number);
  }
  for (const ruleId of BODY_RULE_IDS) {
    vitestExpect(
      numericIdForRule(index, ruleId),
      `${ruleId} ${label}: must not be DNR-indexed`,
    ).toBeUndefined();
  }
  vitestExpect(
    [...heldIds].sort((a, b) => a - b),
    `${label}: Chrome live set must be exactly the four DNR sample ids`,
  ).toEqual([...expected].sort((a, b) => a - b));
}

test("samples/basic DNR rules stay active after proven CDP service-worker restart", async ({
  registerDriver,
}) => {
  const { driver, page, extensionId, close } = await extensionContext({
    grantOrigins: [VALIDATE_HOST_PATTERN],
  });
  registerDriver(driver, close);

  const shipped = await loadShippedSample();
  const project = rewriteSampleToValidateOrigin(shipped);

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

  vitestExpect(await waitForExtensionServiceWorker(driver, extensionId)).toBe(
    true,
  );

  const granted = await page.evaluate(async (pattern) => {
    return chrome.permissions.contains({ origins: [pattern] });
  }, VALIDATE_HOST_PATTERN);
  vitestExpect(granted).toBe(true);

  await importAndEnableSample(page, project);
  const baseline = await getExtensionState(page);
  assertNamedStatuses(baseline.ruleStatuses ?? [], "baseline");

  const snapshottedIds = await getDynamicRuleIds(page);
  await assertChromeDnrIdentity(page, snapshottedIds, "baseline");

  const cdp = await openPageCdpSession(driver);
  try {
    const stopResult = await stopExtensionServiceWorkerViaCdp(cdp, extensionId);
    vitestExpect(
      stopResult,
      `CDP SW stop must be conclusive; got ${stopResult}`,
    ).toBe("stopped");

    vitestExpect(
      await waitForWorkerTarget(cdp, extensionId, "gone", 5_000),
      "service worker target must be gone after CDP stop",
    ).toBe(true);
  } finally {
    await cdp.close();
  }

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  vitestExpect(
    await waitForExtensionServiceWorker(driver, extensionId, 10_000),
    "service worker must be alive after Workspace reopen",
  ).toBe(true);

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(statusLine("rule-redirect", "active"), { exact: true }),
  ).toBeVisible();

  const after = await getExtensionState(page);
  assertNamedStatuses(after.ruleStatuses ?? [], "after restart");

  const statusLines = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-rule-statuses] li")).map(
      (el) => (el.textContent ?? "").trim(),
    );
  });
  for (const ruleId of DNR_RULE_IDS) {
    vitestExpect(statusLines, `Workspace status line for ${ruleId}`).toContain(
      statusLine(ruleId, "active"),
    );
  }
  for (const ruleId of BODY_RULE_IDS) {
    vitestExpect(statusLines, `Workspace status line for ${ruleId}`).toContain(
      statusLine(ruleId, "needs runtime"),
    );
  }
  for (const line of statusLines) {
    vitestExpect(
      line.toLowerCase().includes("not installed"),
      `Workspace status line must not say "not installed": ${line}`,
    ).toBe(false);
  }
  const attention = await page.evaluate(() => {
    return (
      document.querySelector(".rogatio-attention-note")?.textContent ?? ""
    ).toLowerCase();
  });
  vitestExpect(
    attention.includes("not installed"),
    "attention note must not claim rules are not installed",
  ).toBe(false);

  const heldIds = await getDynamicRuleIds(page);
  await assertChromeDnrIdentity(page, heldIds, "after restart");
  vitestExpect(
    heldIds,
    "Chrome must still hold the pre-stop dynamic rule ids",
  ).toEqual(snapshottedIds);
}, 120_000);
