import type { RogatioOperation } from "@rogatio/compiler";
import type { ChromeApi } from "./chrome.js";
import {
  dropBodyMarkerBandFromMatchIndex,
  mergeBodyMarkerIndexEntries,
} from "./match-index.js";
import {
  type BodyMarkerOperation,
  bodyMarkerIdForIndex,
  createBodyMarkerSessionHelper,
} from "./session-body-markers.js";

/** Both shapes passed §1 probe (Chrome 153). Flip for gated rollback tests. */
export const DEFAULT_BODY_MARKER_PROBE_GATES = {
  "request-body": true,
  "response-body": true,
} as const;

export type BodyMarkerProbeGates = {
  readonly "request-body": boolean;
  readonly "response-body": boolean;
};

function isBodyMarkerOperation(
  operation: RogatioOperation,
): operation is BodyMarkerOperation {
  return (
    operation.kind === "request-body" || operation.kind === "response-body"
  );
}

export function filterBodyOpsForMarkers(
  operations: readonly RogatioOperation[],
  gates: BodyMarkerProbeGates = DEFAULT_BODY_MARKER_PROBE_GATES,
): BodyMarkerOperation[] {
  return operations.filter(
    (operation): operation is BodyMarkerOperation =>
      isBodyMarkerOperation(operation) && gates[operation.kind] === true,
  );
}

/**
 * Install set-only session body markers and merge ids into the match index.
 * Fail-closed: no strip path → clear any owned markers/index and skip install
 * (silence; avoids stale markers if the gate flips true→false without stop).
 * Does not mint capability tokens / pending-auth / PAC.
 */
export async function installSessionBodyMarkers(options: {
  readonly api: ChromeApi;
  readonly operations: readonly RogatioOperation[];
  readonly runtimeStripPathAvailable: boolean;
  readonly probeGates?: BodyMarkerProbeGates;
}): Promise<{ readonly installedIds: readonly number[] }> {
  if (!options.runtimeStripPathAvailable) {
    await removeSessionBodyMarkers(options.api);
    return { installedIds: [] };
  }

  const bodyOps = filterBodyOpsForMarkers(
    options.operations,
    options.probeGates ?? DEFAULT_BODY_MARKER_PROBE_GATES,
  );
  if (bodyOps.length === 0) {
    // Strip available but no gated body ops: clear stale session markers/index.
    await removeSessionBodyMarkers(options.api);
    return { installedIds: [] };
  }

  const helper = createBodyMarkerSessionHelper(options.api);
  const result = await helper.install(bodyOps);
  if (!result.ok) {
    await helper.removeOwned();
    await dropBodyMarkerBandFromMatchIndex(options.api);
    return { installedIds: [] };
  }

  await mergeBodyMarkerIndexEntries(options.api, bodyOps);
  return {
    installedIds: bodyOps.map((_, index) => bodyMarkerIdForIndex(index)),
  };
}

/** Remove owned session body markers and drop their match-index ids. */
export async function removeSessionBodyMarkers(api: ChromeApi): Promise<void> {
  const helper = createBodyMarkerSessionHelper(api);
  await helper.removeOwned();
  await dropBodyMarkerBandFromMatchIndex(api);
}
