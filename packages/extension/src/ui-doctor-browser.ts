/**
 * Chrome and dry-run facts for the extension doctor. Imported by the service
 * worker only. Popup and management-page bundles must not import this file.
 */

import type { ChromeApi } from "./chrome.js";
import { runExtensionDryRun } from "./dry-run-command.js";
import {
  buildExtensionDoctor,
  type CombinedDiagnostics,
  type ExtensionDoctorFacts,
  type NativeConnectCode,
  type ProxyLevel,
  type ProxyMode,
  type ProxySnapshot,
  type RuleStatusFact,
  type TabFacts,
  tabFactsFromDryRun,
} from "./ui-doctor.js";

const PROXY_LEVELS = new Set<ProxyLevel>([
  "not_controllable",
  "controlled_by_other_extensions",
  "controllable_by_this_extension",
  "controlled_by_this_extension",
]);

const PROXY_MODES = new Set<ProxyMode>([
  "pac_script",
  "direct",
  "auto_detect",
  "fixed_servers",
  "system",
]);

function finishOnce<T>(
  invoke: (finish: (value: T | null) => void) => unknown,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const result = invoke(finish);
      if (
        result !== undefined &&
        result !== null &&
        typeof (result as Promise<T>).then === "function"
      ) {
        void (result as Promise<T>).then(
          (value) => finish(value),
          () => finish(null),
        );
      }
    } catch {
      finish(null);
    }
  });
}

export async function readProxySnapshot(
  api: Pick<ChromeApi, "proxy" | "runtime"> | undefined,
): Promise<ProxySnapshot> {
  const settings = api?.proxy?.settings;
  if (!settings) return { available: false, levelOfControl: null, mode: null };
  const config = await finishOnce<{
    levelOfControl?: unknown;
    value?: unknown;
  } | null>((finish) => {
    settings.get({}, (value) => {
      if (api?.runtime?.lastError) {
        finish(null);
        return;
      }
      finish(value);
    });
  });
  if (config === null) {
    return { available: false, levelOfControl: null, mode: null };
  }
  const level = PROXY_LEVELS.has(config.levelOfControl as ProxyLevel)
    ? (config.levelOfControl as ProxyLevel)
    : null;
  const modeValue =
    config.value !== null &&
    typeof config.value === "object" &&
    !Array.isArray(config.value) &&
    typeof (config.value as { mode?: unknown }).mode === "string"
      ? (config.value as { mode: string }).mode
      : null;
  const mode = PROXY_MODES.has(modeValue as ProxyMode)
    ? (modeValue as ProxyMode)
    : null;
  if (level === null) {
    return { available: false, levelOfControl: null, mode: null };
  }
  return { available: true, levelOfControl: level, mode };
}

export async function readSiteAccess(
  api: ChromeApi | undefined,
): Promise<boolean | null> {
  const contains = api?.permissions?.contains;
  if (!contains) return null;
  const allowed = await finishOnce<boolean>((finish) =>
    contains({ origins: ["*://*/*"] }, (value) => {
      finish(typeof value === "boolean" ? value : null);
    }),
  );
  return allowed;
}

export async function readIncognito(
  api: ChromeApi | undefined,
): Promise<boolean | null> {
  const ask = api?.extension?.isAllowedIncognitoAccess;
  if (!ask) return null;
  const allowed = await finishOnce<boolean>((finish) =>
    ask((value) => {
      finish(typeof value === "boolean" ? value : null);
    }),
  );
  return allowed;
}

export function readExtensionVersion(
  api: ChromeApi | undefined,
): string | null {
  const version = api?.runtime?.getManifest?.().version;
  return typeof version === "string" ? version : null;
}

async function readActiveTabUrl(
  api: ChromeApi | undefined,
): Promise<string | null> {
  const query = api?.tabs?.query;
  if (!query) return null;
  const tabs = await finishOnce<{ url?: unknown }[] | null>((finish) =>
    query({ active: true, currentWindow: true }, (value) => {
      finish(Array.isArray(value) ? value : null);
    }),
  );
  const url = tabs?.[0]?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export async function collectExtensionDoctor(input: {
  readonly surface: "popup" | "page";
  readonly extensionId: string;
  readonly phase: string;
  readonly chrome: ChromeApi | undefined;
  readonly project: unknown | null;
  readonly enabledGroupIds: readonly string[];
  readonly statuses: readonly RuleStatusFact[];
  readonly rulesReadable: boolean;
  readonly activeProject: boolean;
  readonly native: NativeConnectCode;
  readonly cliVersion: string | null;
  readonly host: ExtensionDoctorFacts["host"];
}): Promise<CombinedDiagnostics> {
  let tab: TabFacts | null = null;
  if (input.surface === "popup") {
    const url = await readActiveTabUrl(input.chrome);
    if (url === null) {
      tab = { kind: "unavailable" };
    } else if (input.project === null) {
      tab = { kind: "unchecked" };
    } else {
      const outcome = runExtensionDryRun(
        input.project,
        [{ url, method: "GET", resourceType: "main_frame" }],
        undefined,
      );
      tab = outcome.ok
        ? tabFactsFromDryRun(
            outcome.result,
            input.enabledGroupIds,
            input.statuses,
          )
        : { kind: "unchecked" };
    }
  }
  const [proxy, siteAccess, incognito] = await Promise.all([
    readProxySnapshot(input.chrome),
    readSiteAccess(input.chrome),
    readIncognito(input.chrome),
  ]);
  return buildExtensionDoctor({
    workerReached: true,
    extensionId: input.extensionId,
    extensionVersion: readExtensionVersion(input.chrome),
    cliVersion: input.cliVersion,
    native: input.native,
    phase: input.phase,
    proxy,
    siteAccess,
    incognito,
    activeProject: input.activeProject,
    rulesReadable: input.rulesReadable,
    enabledGroupCount: input.enabledGroupIds.length,
    statuses: input.statuses,
    tab,
    host: input.host,
  });
}
