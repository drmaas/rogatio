/**
 * Shared runtime/AI card state mapping for the Workspace sidebar and the
 * Dashboard system-status surface (dashboard-runtime-ai §1).
 *
 * Pure resolvers only: no DOM, no commands, no storage. The sidebar body
 * builders in `extension-page-entry.ts` and the Dashboard builders in
 * `dashboard-status.ts` share these so both surfaces render one truth. The
 * API key never appears here — `AiCardInput.aiProvider` carries only the
 * two display strings.
 */

export interface AiProviderDisplay {
  readonly url: string;
  readonly model: string;
}

export interface AiCardInput {
  readonly phase: string | undefined;
  readonly aiSupported: boolean;
  readonly aiStatusChecked: boolean;
  readonly aiReported: boolean;
  readonly aiProvider: AiProviderDisplay | null;
}

export interface AiCardView {
  readonly statusText: string;
  readonly tone: "ok" | "warn" | "muted";
  readonly statusClass: string;
  readonly showProviderLines: boolean;
  readonly providerUrl: string | null;
  readonly model: string | null;
}

/**
 * Human-readable runtime phase. Mirrors the sidebar status line verbatim so
 * both surfaces share one mapping.
 */
export function resolveRuntimeStatusText(phase: string | undefined): string {
  const current = phase ?? "stopped";
  switch (current) {
    case "starting":
      return "starting";
    case "started":
      return "running";
    case "failed":
      return "failed to start";
    case "unsupported":
      return "unavailable on this platform";
    case "error":
      return "error";
    default:
      return "stopped";
  }
}

/** Card-heading tone for a runtime phase. Mirrors the sidebar mapping. */
export function resolveRuntimeTone(
  phase: string | undefined,
): "ok" | "error" | "warn" | "muted" {
  const current = phase ?? "stopped";
  if (current === "started") return "ok";
  if (current === "failed" || current === "error") return "error";
  if (current === "starting") return "warn";
  return "muted";
}

/**
 * Status-dot class for a runtime phase. Mirrors the sidebar status line so
 * both surfaces share one mapping.
 */
export function resolveRuntimeStatusClass(phase: string | undefined): string {
  const current = phase ?? "stopped";
  if (current === "started") return "rogatio-runtime-running";
  if (current === "failed" || current === "error")
    return "rogatio-runtime-failed";
  if (current === "starting") return "rogatio-runtime-starting";
  return "rogatio-runtime-idle";
}

/**
 * Fix hint for a failed/unsupported runtime. Pure so the sidebar guidance and
 * the Dashboard system-status card share one mapping; both render it with
 * `textContent` only.
 */
export function resolveRuntimeRecoveryText(
  phase: string | undefined,
  runtimeError: string | null,
): string {
  const error = (runtimeError ?? "").toLowerCase();
  if (error.includes("runtime.root-invalid")) {
    return "The mock files folder must be a full path to a folder that exists. Set it under Project details.";
  }
  if (error.includes("allowed_origins") || error.includes("origin-forbidden")) {
    return "This extension ID is not in the host manifest allowed_origins. Re-pin the host with the command below, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (error.includes("native-host-missing")) {
    return "Install the host using the command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (error.includes("host")) {
    return "Re-run the install command below once, reload Rogatio from chrome://extensions, then click Start runtime again.";
  }
  if (
    error.includes("trust") ||
    error.includes("certificate") ||
    error.includes("ca")
  ) {
    return "Run the install command below to register the host and trust the device-local CA, then restart Chrome and click Start runtime again.";
  }
  if ((phase ?? "stopped") === "unsupported") {
    return "This device cannot provide the capabilities required by the selected runtime rules. You can still edit and verify the project.";
  }
  return "Open Show diagnostics for the concrete host error. After correcting it, click Start runtime again.";
}

/** Diagnostics entry shows only on failed/unsupported. */
export function shouldShowRuntimeDiagnostics(
  phase: string | undefined,
): boolean {
  const current = phase ?? "stopped";
  return current === "failed" || current === "unsupported";
}

/** AI card heading tone. Mirrors the sidebar mapping. */
export function resolveAiTone(input: AiCardInput): "ok" | "warn" | "muted" {
  if (input.aiSupported) return "ok";
  if (input.aiStatusChecked && input.aiReported) return "warn";
  return "muted";
}

/**
 * AI status with needs-runtime > Configured > not-reported > Not-configured
 * precedence. Provider lines show only when supported with metadata; partial
 * metadata arrives as supported=false, reported=false, provider=null (the
 * `checkNativeAISupport` non-conforming path) and renders not reported.
 * Only the supported provider's url/model leave this function — never a key.
 */
export function resolveAiCard(input: AiCardInput): AiCardView {
  const tone = resolveAiTone(input);
  const providerInfo = input.aiSupported ? input.aiProvider : null;
  if ((input.phase ?? "stopped") !== "started") {
    return {
      statusText: "AI: needs runtime",
      tone,
      statusClass: "rogatio-ai-needs-runtime",
      showProviderLines: false,
      providerUrl: null,
      model: null,
    };
  }
  if (providerInfo !== null) {
    return {
      statusText: "AI: Configured",
      tone,
      statusClass: "rogatio-ai-ready",
      showProviderLines: true,
      providerUrl: providerInfo.url,
      model: providerInfo.model,
    };
  }
  if (input.aiStatusChecked && !input.aiReported) {
    return {
      statusText: "AI: not reported",
      tone,
      statusClass: "rogatio-ai-not-reported",
      showProviderLines: false,
      providerUrl: null,
      model: null,
    };
  }
  return {
    statusText: "AI: Not configured",
    tone,
    statusClass: "rogatio-ai-not-configured",
    showProviderLines: false,
    providerUrl: null,
    model: null,
  };
}
