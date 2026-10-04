/**
 * Dashboard system-status surface (dashboard-runtime-ai §2).
 *
 * Builds the `System status` dashboard card from explicit inputs so unit
 * tests exercise the production path without importing the page entry (which
 * binds `document`/`chrome` and calls `refresh()` on load). Runtime/AI truth
 * shares the sidebar resolvers (`runtimeControlDisabled`,
 * `resolveRuntimeStatusText`, `resolveRuntimeStatusClass`,
 * `shouldShowRuntimeDiagnostics`, `resolveAiCard`) — only the outer section
 * scaffolding and the recovery line are dashboard-specific, because the
 * sidebar card has no recovery line. All strings render via `textContent`.
 */

import { runtimeInstallCommand } from "./extension-id.js";
import { runtimeControlDisabled } from "./runtime-controls.js";
import {
  type AiProviderDisplay,
  resolveAiCard,
  resolveRuntimeRecoveryText,
  resolveRuntimeStatusClass,
  resolveRuntimeStatusText,
  shouldShowRuntimeDiagnostics,
} from "./status-cards.js";

export type DashboardAiProvider = AiProviderDisplay;

export interface DashboardStatusInput {
  readonly phase: string | undefined;
  readonly runtimeError: string | null;
  readonly extensionId: string;
  readonly aiSupported: boolean;
  readonly aiStatusChecked: boolean;
  readonly aiReported: boolean;
  readonly aiProvider: DashboardAiProvider | null;
}

function dashboardButton(label: string, command: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  result.dataset.command = command;
  return result;
}

function appendDashboardRuntimeBlock(
  block: HTMLElement,
  input: DashboardStatusInput,
): void {
  const actions = document.createElement("div");
  actions.className = "rogatio-system-status-actions";
  const controlsDisabled = runtimeControlDisabled(input.phase);
  const startRuntime = dashboardButton("Start runtime", "start-native-runtime");
  startRuntime.disabled = controlsDisabled.start;
  const stopRuntime = dashboardButton("Stop runtime", "stop-native-runtime");
  stopRuntime.disabled = controlsDisabled.stop;
  actions.append(startRuntime, stopRuntime);
  block.append(actions);

  const nativeRuntime = document.createElement("p");
  nativeRuntime.dataset.nativeRuntimeState = "true";
  nativeRuntime.className = `rogatio-runtime-status ${resolveRuntimeStatusClass(input.phase)}`;
  nativeRuntime.textContent = `Runtime status: ${resolveRuntimeStatusText(input.phase)}`;
  nativeRuntime.setAttribute("aria-live", "polite");
  nativeRuntime.setAttribute("role", "status");
  block.append(nativeRuntime);

  const extensionIdRow = document.createElement("div");
  extensionIdRow.className = "rogatio-extension-id-row";
  const extensionIdLine = document.createElement("p");
  extensionIdLine.dataset.extensionId = "true";
  extensionIdLine.className = "rogatio-extension-id";
  extensionIdLine.textContent = `Extension ID: ${input.extensionId || "unknown"}`;
  const copyId = dashboardButton("⧉", "copy-extension-id");
  copyId.className = "rogatio-copy-icon";
  copyId.setAttribute("aria-label", "Copy extension ID");
  copyId.title = "Copy extension ID";
  extensionIdRow.append(extensionIdLine, copyId);
  block.append(extensionIdRow);

  if (shouldShowRuntimeDiagnostics(input.phase)) {
    block.append(dashboardButton("Show diagnostics", "show-diagnostics"));
    if (input.runtimeError) {
      const runtimeErrorLine = document.createElement("p");
      runtimeErrorLine.dataset.runtimeError = "true";
      runtimeErrorLine.className = "rogatio-runtime-error";
      runtimeErrorLine.textContent = `Runtime error: ${input.runtimeError}`;
      block.append(runtimeErrorLine);
      if (input.runtimeError.includes("allowed_origins")) {
        const mismatchCommand = document.createElement("p");
        mismatchCommand.dataset.runtimeOriginMismatch = "true";
        mismatchCommand.className = "rogatio-runtime-error";
        mismatchCommand.textContent = `Re-pin the host: ${runtimeInstallCommand(input.extensionId)}`;
        block.append(mismatchCommand);
      }
    }
    const recovery = document.createElement("p");
    recovery.dataset.runtimeRecovery = "true";
    recovery.className = "rogatio-system-status-recovery";
    recovery.textContent = resolveRuntimeRecoveryText(
      input.phase,
      input.runtimeError,
    );
    block.append(recovery);
  }
}

function appendDashboardAiBlock(
  block: HTMLElement,
  input: DashboardStatusInput,
): void {
  const view = resolveAiCard({
    phase: input.phase,
    aiSupported: input.aiSupported,
    aiStatusChecked: input.aiStatusChecked,
    aiReported: input.aiReported,
    aiProvider: input.aiProvider,
  });
  const aiStatus = document.createElement("p");
  aiStatus.dataset.aiStatus = "true";
  aiStatus.className = `rogatio-ai-status ${view.statusClass}`;
  aiStatus.textContent = view.statusText;
  aiStatus.setAttribute("aria-live", "polite");
  aiStatus.setAttribute("role", "status");
  block.append(aiStatus);
  if (
    view.showProviderLines &&
    view.providerUrl !== null &&
    view.model !== null
  ) {
    const aiProviderLine = document.createElement("p");
    aiProviderLine.dataset.aiProvider = "true";
    aiProviderLine.className = "rogatio-ai-provider";
    aiProviderLine.textContent = `Provider: ${view.providerUrl}`;
    const aiModelLine = document.createElement("p");
    aiModelLine.dataset.aiModel = "true";
    aiModelLine.className = "rogatio-ai-model";
    aiModelLine.textContent = `Model: ${view.model}`;
    block.append(aiProviderLine, aiModelLine);
  }
}

/**
 * The `System status` dashboard card. Carries
 * `data-dashboard-section="system-status"` (never `data-card`, which is
 * sidebar-only) and lives inside the shell delegated-handler subtree, so the
 * existing `start-native-runtime` / `stop-native-runtime` / `show-diagnostics`
 * / `copy-extension-id` dispatch handles its controls with the shared
 * disabled logic.
 */
export function createDashboardSystemStatus(
  input: DashboardStatusInput,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "rogatio-dashboard-card rogatio-system-status";
  section.dataset.dashboardSection = "system-status";

  const heading = document.createElement("div");
  heading.className = "rogatio-dashboard-section-heading";
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "System status";
  const hint = document.createElement("p");
  hint.textContent = "Runtime and AI readiness for generation.";
  copy.append(title, hint);
  heading.append(copy);
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "rogatio-system-status-grid";

  const runtimeBlock = document.createElement("div");
  runtimeBlock.className = "rogatio-system-status-block";
  runtimeBlock.dataset.dashboardBlock = "runtime";
  const runtimeTitle = document.createElement("h4");
  runtimeTitle.className = "rogatio-system-status-title";
  runtimeTitle.textContent = "Runtime";
  runtimeBlock.append(runtimeTitle);
  appendDashboardRuntimeBlock(runtimeBlock, input);
  grid.append(runtimeBlock);

  const aiBlock = document.createElement("div");
  aiBlock.className = "rogatio-system-status-block";
  aiBlock.dataset.dashboardBlock = "ai";
  const aiTitle = document.createElement("h4");
  aiTitle.className = "rogatio-system-status-title";
  aiTitle.textContent = "AI";
  aiBlock.append(aiTitle);
  appendDashboardAiBlock(aiBlock, input);
  grid.append(aiBlock);

  section.append(grid);
  return section;
}
