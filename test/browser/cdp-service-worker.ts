/**
 * CDP helpers for extension service-worker liveness and stop.
 * Fail-closed: stop returns a conclusive result code; callers decide how to treat
 * no-target / no-version / cdp-error.
 */
import type { WebDriver } from "selenium-webdriver";
import { type CdpSession, openPageCdpSession } from "./cdp-session.js";

export type CdpStopResult =
  | "stopped"
  | "no-target"
  | "no-version"
  | "cdp-error";

type CdpWorkerVersionUpdatedPayload = {
  versions: Array<{
    versionId: string;
    scriptURL: string;
    runningStatus?: string;
  }>;
};

export async function waitForExtensionServiceWorker(
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

export async function extensionWorkerTargetCount(
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

export async function waitForWorkerTarget(
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

export async function stopExtensionServiceWorkerViaCdp(
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
