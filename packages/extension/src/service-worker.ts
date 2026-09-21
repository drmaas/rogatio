import {
  computeBadge,
  computeRuleStatuses,
  type NativeRuntimePhase,
  ProjectRepository,
  type RuleInstallerAdapter,
  type StorageAdapter,
} from "@rogatio/browser-core";
import { compileProject, type RogatioOperation } from "@rogatio/compiler";
import { normalizeSiteOrigin } from "@rogatio/schema";
import {
  buildAssistSystemPrompt,
  MAX_AI_ASSIST_ENVELOPE_BYTES,
  mergeProposalIntoProject,
  parseAIProposal,
} from "./ai-assist.js";
import { validateProjectDetailed } from "./browser-schema.js";
import type { ChromeApi } from "./chrome.js";
import {
  type ExtensionDiagnostic,
  extensionDiagnostic,
} from "./diagnostics.js";
import type { DnrInstallError, DnrInstallerWithMatchIndex } from "./dnr.js";

import type { NativeEnvelope, NativeEnvelopeInput } from "./native-session.js";
import {
  checkAISupport,
  type NativeRuntimeConfig,
  requestAIComplete,
  startNativeSession,
  stopNativeSession,
} from "./native-session.js";
import { declaredPermissionOrigins } from "./permissions.js";
import { type ExtensionRequest, parseRequest } from "./protocol.js";

type PermissionAdapter = {
  contains(origins: readonly string[]): Promise<boolean>;
  request(origins: readonly string[]): Promise<boolean>;
  remove(origins: readonly string[]): Promise<boolean>;
};

function installerWithMatchIndex(
  installer: RuleInstallerAdapter,
): DnrInstallerWithMatchIndex | undefined {
  const candidate = installer as DnrInstallerWithMatchIndex;
  return typeof candidate.hydrateInstalled === "function"
    ? candidate
    : undefined;
}

function takeDnrInstallErrors(
  installer: RuleInstallerAdapter,
): readonly DnrInstallError[] {
  const candidate = installer as DnrInstallerWithMatchIndex;
  return typeof candidate.takeInstallErrors === "function"
    ? candidate.takeInstallErrors()
    : [];
}

export interface ExtensionApplicationOptions {
  readonly storage: StorageAdapter;
  readonly permissions: PermissionAdapter;
  readonly installer: RuleInstallerAdapter;
  readonly badge?: (value: {
    readonly text: string;
    readonly attention: boolean;
  }) => Promise<void>;
  readonly generateId?: () => string;
  readonly now?: () => number;
  readonly extensionId?: string;
  /**
   * Chrome adapter for session body-marker install (match logging).
   * When set, native-session start/stop owns markers + index merge.
   * Strip path is available only when session traffic reaches
   * `stripReservedMarkers` (fail-closed; no F17 capability mint / PAC).
   */
  readonly chromeApi?: ChromeApi;
  /**
   * Opt-in: must be explicitly `true` to install markers.
   * Default / omit → no install (fail-closed until live strip routing exists).
   */
  readonly runtimeStripPathAvailable?: boolean;
  readonly nativeRuntime?: {
    start(config: NativeRuntimeConfig): Promise<{
      readonly state: NativeRuntimePhase | "unsupported";
      readonly message?: string;
    }>;
    stop(): Promise<{ readonly state: NativeRuntimePhase | "unsupported" }>;
    status(): Promise<{ readonly state: NativeRuntimePhase | "unsupported" }>;
    sendPolicy(frames: Uint8Array[]): Promise<void>;
    /** Envelope protocol to the consolidated native host (spec REQ-001). */
    send?(envelope: NativeEnvelopeInput): Promise<NativeEnvelope>;
    /** Chrome's last connectNative error message, if any. */
    lastConnectError?(): string | null;
  };
}

type StateProjection = {
  readonly statuses: readonly Record<string, unknown>[];
  readonly badge: { readonly text: string; readonly attention: boolean };
};

type Success = { readonly ok: true; readonly value?: unknown };
type Failure = {
  readonly ok: false;
  readonly diagnostic: ExtensionDiagnostic;
  readonly kind?: "conflict";
  readonly current?: unknown;
};
export type ApplicationResponse = Success | Failure;

function failure(
  code: ExtensionDiagnostic["code"],
  params: Readonly<Record<string, unknown>> = {},
): Failure {
  return { ok: false, diagnostic: extensionDiagnostic(code, params) };
}

function conflict(current: unknown): Failure {
  return {
    ok: false,
    kind: "conflict",
    current,
    diagnostic: extensionDiagnostic("extension.conflict"),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const MAX_AI_PROMPT_LENGTH = 4000;
const AI_GENERATION_SYSTEM_PROMPT =
  "Return only one complete Rogatio version-1 JSON project. Use valid groups and rules; do not include markdown, commentary, credentials, or unknown properties.";

function arrayOfStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}

function operationStatuses(
  operations: readonly RogatioOperation[],
  installedRuleIds: readonly string[],
  enabledGroupIds: readonly string[],
  grantedOrigins: readonly string[],
  nativePhase: NativeRuntimePhase | "unsupported",
  dnrInstallErrors: readonly DnrInstallError[] = [],
): readonly Record<string, unknown>[] {
  const statuses = computeRuleStatuses({
    operations,
    enabledGroupIds,
    grantedOrigins,
    installedRuleIds,
  });
  return statuses.map((status): Record<string, unknown> => {
    const operation = operations.find(
      (candidate) =>
        candidate.ruleId === status.ruleId &&
        candidate.groupId === status.groupId,
    );
    const dnrInstallError = dnrInstallErrors.find(
      (error) => error.ruleId === status.ruleId,
    );
    if (dnrInstallError && status.status === "error") {
      return {
        ...status,
        diagnostics: [
          extensionDiagnostic("extension.dnr-error", {
            ruleId: dnrInstallError.ruleId,
            reason: dnrInstallError.message,
          }),
        ],
      };
    }
    if (operation?.kind === "matcher") {
      if (status.status === "active" || status.status === "error") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "unsupported",
          diagnostics: [extensionDiagnostic("extension.unsupported")],
        };
      }
      return { ...status };
    }
    if (
      operation?.kind === "request-body" ||
      operation?.kind === "response-body"
    ) {
      if (status.status !== "active" && status.status !== "error") {
        return { ...status };
      }
      if (nativePhase === "unsupported") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "unsupported",
          diagnostics: [extensionDiagnostic("extension.unsupported")],
        };
      }
      if (nativePhase !== "started") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "needs runtime",
        };
      }
      return {
        groupId: status.groupId,
        ruleId: status.ruleId,
        status: "active",
      };
    }
    // redirect, query, and header operations are browser-native and remain
    // active once their permissions and installation are satisfied.
    if (operation?.kind === "header") {
      if (status.status === "active") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "active",
        };
      }
      return { ...status };
    }
    // redirect and query: trust computeRuleStatuses (active only when installed).
    return { ...status };
  });
}

export interface ExtensionApplication {
  handle(value: unknown): Promise<ApplicationResponse>;
}

export function createExtensionApplication(
  options: ExtensionApplicationOptions,
): ExtensionApplication {
  const repository = new ProjectRepository({
    storage: options.storage,
    generateId: options.generateId,
    now: options.now,
  });
  let nativePhase: NativeRuntimePhase | "unsupported" = options.nativeRuntime
    ? "stopped"
    : "unsupported";
  let nativeRuntimeError: string | null = null;
  let pendingProjectId: string | null = null;

  async function grantedOriginsFor(
    origins: readonly string[],
  ): Promise<readonly string[]> {
    const result: string[] = [];
    for (const origin of origins) {
      if (await options.permissions.contains([origin])) result.push(origin);
    }
    return result;
  }

  /**
   * The DNR-managed operation set for the active project. Browser-side
   * redirect/query/header rules stay installed across start and stop.
   */
  function dnrManagedOps(
    operations: readonly RogatioOperation[],
    enabledGroupIds: readonly string[],
    granted: readonly string[],
  ): readonly RogatioOperation[] {
    const enabled = new Set(enabledGroupIds);
    const grantedSet = new Set(granted);
    return operations.filter((operation) => {
      if (
        operation.kind === "redirect" ||
        operation.kind === "query" ||
        operation.kind === "header"
      ) {
        return (
          enabled.has(operation.groupId) &&
          operation.matcher.origins.length > 0 &&
          operation.matcher.origins.every((origin) => grantedSet.has(origin))
        );
      }
      // Body rules stay on the native-runtime overlay (never DNR).
      return false;
    });
  }

  async function projectState(envelope: {
    readonly activeProjectId: string | null;
    readonly projects: Readonly<
      Record<
        string,
        {
          readonly data: unknown;
          readonly enabledGroupIds: readonly string[];
        }
      >
    >;
  }): Promise<StateProjection> {
    if (envelope.activeProjectId === null) {
      const badge = { text: "", attention: false };
      await options.badge?.(badge);
      return { statuses: [], badge };
    }
    const project = envelope.projects[envelope.activeProjectId];
    if (!project) {
      const badge = { text: "", attention: false };
      await options.badge?.(badge);
      return { statuses: [], badge };
    }
    const compiled = compileProject(project.data);
    if (!compiled.ok) {
      const badge = { text: "", attention: true };
      await options.badge?.(badge);
      return { statuses: [], badge };
    }
    const declared = declaredPermissionOrigins({
      operations: compiled.operations,
    });
    const granted = await grantedOriginsFor(declared);
    const matchIndexInstaller = installerWithMatchIndex(options.installer);
    if (matchIndexInstaller !== undefined) {
      // ADR 0008: warm cold tracked before reporting installed ids.
      await matchIndexInstaller.hydrateInstalled(compiled.operations);
    }
    let installedRuleIds: string[] = [];
    try {
      const installed = await options.installer.current();
      installedRuleIds = installed.map((operation) => operation.ruleId);
    } catch {
      installedRuleIds = [];
    }
    // Keep redirect/query/header DNR in sync on every state projection (not
    // only on set-group-enabled), so import+enable and permission seed races
    // still land. Body rules never enter this installer path.
    let dnrInstallErrors: readonly DnrInstallError[] = [];
    try {
      const desiredDnrOps = dnrManagedOps(
        compiled.operations,
        project.enabledGroupIds,
        granted,
      );
      const currentlyInstalled = await options.installer.current();
      const currentDnr = currentlyInstalled.filter(
        (operation) =>
          operation.kind === "redirect" ||
          operation.kind === "query" ||
          operation.kind === "header",
      );
      const desiredIds = new Set(
        desiredDnrOps.map((operation) => operation.ruleId),
      );
      const currentIds = new Set(
        currentDnr.map((operation) => operation.ruleId),
      );
      const sameSet =
        desiredIds.size === currentIds.size &&
        [...desiredIds].every((id) => currentIds.has(id));
      if (!sameSet) {
        await options.installer.install(desiredDnrOps);
        dnrInstallErrors = takeDnrInstallErrors(options.installer);
      }
      const installedAfter = await options.installer.current();
      installedRuleIds = [
        ...new Set([
          ...installedRuleIds,
          ...installedAfter.map((operation) => operation.ruleId),
        ]),
      ];
    } catch {
      // Install failure surfaces as rule-not-installed / error statuses below.
      dnrInstallErrors = takeDnrInstallErrors(options.installer);
    }
    const statuses = operationStatuses(
      compiled.operations,
      installedRuleIds,
      project.enabledGroupIds,
      granted,
      nativePhase,
      dnrInstallErrors,
    );
    const badgeStatuses = statuses.map((status) => ({
      groupId: String(status.groupId),
      ruleId: String(status.ruleId),
      status: status.status as
        | "active"
        | "disabled"
        | "needs permission"
        | "needs runtime"
        | "unsupported"
        | "error",
    }));
    const badge = computeBadge(badgeStatuses);
    await options.badge?.(badge);
    return { statuses, badge };
  }

  async function syncStoredGrants(
    projectId: string,
    declared: readonly string[],
    granted: readonly string[],
  ): Promise<void> {
    const current = await repository.getProject(projectId);
    if (!current.ok) return;
    const grantedSet = new Set(granted);
    const storedSet = new Set(current.value.grantedOrigins);
    for (const origin of declared) {
      if (grantedSet.has(origin) && !storedSet.has(origin)) {
        await repository.grantOrigin(projectId, origin);
      } else if (!grantedSet.has(origin) && storedSet.has(origin)) {
        await repository.revokeOrigin(projectId, origin);
      }
    }
  }

  async function state(): Promise<ApplicationResponse> {
    const result = await repository.state();
    if (!result.ok) return failure("extension.storage-failed");
    const projection = await projectState(result.value);
    return {
      ok: true,
      value: {
        ...result.value,
        ruleStatuses: projection.statuses,
        badge: projection.badge,
        nativeRuntimeState: { phase: nativePhase },
        nativeRuntimeError,
      },
    };
  }

  async function handleRequest(
    request: ExtensionRequest,
  ): Promise<ApplicationResponse> {
    const data = request as Record<string, unknown>;
    if (request.command === "get-state" || request.command === "refresh") {
      return state();
    }
    if (request.command === "check-ai-support") {
      if (
        !options.nativeRuntime ||
        !options.extensionId ||
        nativePhase !== "started" ||
        !options.nativeRuntime.send
      ) {
        return { ok: true, value: { supported: false } };
      }
      const supported = await checkAISupport({
        extensionId: options.extensionId,
        nativeRuntime: options.nativeRuntime,
        getProject: async () => null,
        getGrantedOrigins: async () => [],
      });
      return { ok: true, value: { supported } };
    }
    if (request.command === "generate-project") {
      const prompt = stringValue(data.prompt)?.trim();
      if (!prompt || prompt.length > MAX_AI_PROMPT_LENGTH) {
        return failure("extension.ai-invalid-prompt");
      }
      if (
        !options.nativeRuntime ||
        !options.extensionId ||
        nativePhase !== "started" ||
        !options.nativeRuntime.send
      ) {
        return failure("extension.ai-unavailable");
      }
      const aiResponse = await requestAIComplete(
        {
          extensionId: options.extensionId,
          nativeRuntime: options.nativeRuntime,
          getProject: async () => null,
          getGrantedOrigins: async () => [],
        },
        [
          { role: "system", content: AI_GENERATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        "",
        0.2,
        { type: "json_object" },
      );
      if (!aiResponse) return failure("extension.ai-generation-failed");
      let generated: unknown;
      try {
        generated = JSON.parse(aiResponse.metadata.content) as unknown;
      } catch {
        return failure("extension.ai-invalid-response");
      }
      const validation = validateProjectDetailed(generated);
      if (!validation.valid) return failure("extension.ai-invalid-project");
      const compiled = compileProject(validation.data);
      if (!compiled.ok) return failure("extension.ai-invalid-project");
      return { ok: true, value: structuredClone(validation.data) };
    }
    if (request.command === "ai-assist") {
      const kind = stringValue(data.kind);
      const prompt = stringValue(data.prompt)?.trim();
      if (
        (kind !== "generate" && kind !== "fix" && kind !== "explain") ||
        !prompt ||
        prompt.length > MAX_AI_PROMPT_LENGTH
      ) {
        return failure("extension.ai-invalid-prompt");
      }
      if (
        !options.nativeRuntime ||
        !options.extensionId ||
        nativePhase !== "started" ||
        !options.nativeRuntime.send
      ) {
        return failure("extension.ai-unavailable");
      }
      const context = data.context;
      if (
        typeof context !== "object" ||
        context === null ||
        Array.isArray(context) ||
        typeof (context as { project?: unknown }).project !== "object" ||
        (context as { project?: unknown }).project === null
      ) {
        return failure("extension.ai-invalid-prompt");
      }
      const project = (context as { project: Record<string, unknown> }).project;
      const systemPrompt = buildAssistSystemPrompt(project);
      const diagnostics = (context as { diagnostics?: unknown }).diagnostics;
      let userContent = prompt;
      if (kind === "fix" && Array.isArray(diagnostics)) {
        userContent = `Fix validation errors for this Assist request.\nPrompt: ${prompt}\nDiagnostics: ${JSON.stringify(diagnostics)}`;
      }
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userContent },
      ];
      const envelopeProbe = {
        protocol: "v1",
        type: "ai.complete",
        requestId: "size-probe",
        timestamp: Date.now(),
        metadata: {
          messages,
          model: "",
          temperature: 0.2,
          responseFormat: { type: "json_object" },
        },
      };
      const envelopeBytes = new TextEncoder().encode(
        JSON.stringify(envelopeProbe),
      ).length;
      if (envelopeBytes > MAX_AI_ASSIST_ENVELOPE_BYTES) {
        return failure("extension.ai-request-too-large");
      }
      const aiResponse = await requestAIComplete(
        {
          extensionId: options.extensionId,
          nativeRuntime: options.nativeRuntime,
          getProject: async () => null,
          getGrantedOrigins: async () => [],
        },
        messages,
        "",
        0.2,
        { type: "json_object" },
      );
      if (!aiResponse) return failure("extension.ai-assist-failed");
      let parsed: unknown;
      try {
        parsed = JSON.parse(aiResponse.metadata.content) as unknown;
      } catch {
        return failure("extension.ai-invalid-response");
      }
      const proposal = parseAIProposal(parsed);
      if (!proposal) return failure("extension.ai-invalid-response");
      const merged = mergeProposalIntoProject(project, proposal);
      const validation = validateProjectDetailed(merged);
      if (!validation.valid) return failure("extension.ai-invalid-proposal");
      return { ok: true, value: { proposal } };
    }
    if (request.command === "select-project") {
      const projectId = stringValue(data.projectId);
      if (!projectId) return failure("extension.invalid-message");
      const current = await repository.state();
      if (!current.ok || !Object.hasOwn(current.value.projects, projectId)) {
        return failure("extension.not-found");
      }
      pendingProjectId = projectId;
      return {
        ok: true,
        value: {
          pendingProjectId,
          activeProjectId: current.value.activeProjectId,
        },
      };
    }
    if (request.command === "switch-project") {
      const projectId = stringValue(data.projectId) ?? pendingProjectId;
      if (!projectId) return failure("extension.invalid-message");
      const result = await repository.switchProject(projectId);
      if (!result.ok) {
        return result.kind === "conflict"
          ? conflict(result.current)
          : failure("extension.not-found");
      }
      pendingProjectId = projectId;
      const projection = await projectState(result.value);
      return {
        ok: true,
        value: {
          ...result.value,
          ruleStatuses: projection.statuses,
          badge: projection.badge,
          nativeRuntimeState: { phase: nativePhase },
        },
      };
    }
    if (
      request.command === "create-project" ||
      request.command === "import-project"
    ) {
      const result =
        request.command === "create-project"
          ? await repository.createProject(data.data)
          : await repository.importProject(data.data, {
              id: stringValue(data.projectId),
              expectedRevision:
                typeof data.expectedRevision === "number"
                  ? data.expectedRevision
                  : undefined,
            });
      if (!result.ok) {
        return result.kind === "conflict"
          ? conflict(result.current)
          : failure("extension.storage-failed");
      }
      await state();
      return { ok: true, value: result.value };
    }
    if (request.command === "save-project") {
      const projectId = stringValue(data.projectId);
      const revision = data.expectedRevision;
      if (!projectId || typeof revision !== "number") {
        return failure("extension.invalid-message");
      }
      const result = await repository.saveProject(
        projectId,
        data.data,
        revision,
      );
      if (!result.ok) {
        return result.kind === "conflict"
          ? conflict(result.current)
          : failure("extension.storage-failed");
      }
      await state();
      return { ok: true, value: result.value };
    }
    if (request.command === "remove-project") {
      const projectId = stringValue(data.projectId);
      if (!projectId || data.confirm !== true) {
        return failure("extension.invalid-message");
      }
      const result = await repository.removeProject(projectId);
      if (!result.ok) return failure("extension.not-found");
      await state();
      return { ok: true, value: result.value };
    }
    if (request.command === "export-project") {
      const projectId = stringValue(data.projectId);
      if (!projectId) return failure("extension.invalid-message");
      const result = await repository.exportProject(projectId);
      return result.ok
        ? { ok: true, value: result.value }
        : failure("extension.not-found");
    }
    if (request.command === "set-group-enabled") {
      const projectId = stringValue(data.projectId);
      const groupId = stringValue(data.groupId);
      if (!projectId || !groupId || typeof data.enabled !== "boolean") {
        return failure("extension.invalid-message");
      }
      const result = await repository.setGroupEnabled(
        projectId,
        groupId,
        data.enabled,
      );
      if (!result.ok) return failure("extension.not-found");
      // Unified install() replaces both Rogatio DNR bands (ADR 0009). Do not
      // pass a redirect/query-only subset here — that treats live headers as
      // orphans. projectState via state() installs the full desired set.
      await state();
      return { ok: true, value: result.value };
    }
    if (
      request.command === "start-native-runtime" ||
      request.command === "stop-native-runtime" ||
      request.command === "get-native-runtime-status"
    ) {
      if (!options.nativeRuntime || !options.extensionId) {
        nativePhase = "unsupported";
        nativeRuntimeError = "The native runtime adapter is unavailable.";
        return request.command === "get-native-runtime-status"
          ? { ok: true, value: { nativeRuntimeState: { phase: nativePhase } } }
          : failure("extension.native-runtime-unavailable");
      }
      if (request.command === "start-native-runtime") {
        console.log("[rogatio] start-native-runtime invoked");
        const current = await repository.state();
        if (!current.ok) {
          console.log("[rogatio] storage failed");
          return failure("extension.storage-failed");
        }
        const projectId = current.value.activeProjectId;
        if (!projectId) {
          console.log("[rogatio] no active project");
          return failure("extension.not-found");
        }
        const project = current.value.projects[projectId];
        if (!project) {
          console.log("[rogatio] project not found:", projectId);
          return failure("extension.not-found");
        }

        console.log("[rogatio] compiling project:", project.data?.name);
        const compileResult = compileProject(project.data);
        if (!compileResult.ok) {
          console.log("[rogatio] compile failed");
          return failure("extension.storage-failed");
        }
        console.log(
          "[rogatio] starting native session, extensionId:",
          options.extensionId,
        );
        let sessionResult: Awaited<ReturnType<typeof startNativeSession>>;
        try {
          sessionResult = await startNativeSession({
            extensionId: options.extensionId,
            nativeRuntime: options.nativeRuntime,
            getProject: async () => ({
              data: project.data,
              enabledGroupIds: project.enabledGroupIds,
            }),
            getGrantedOrigins: async () => {
              return declaredPermissionOrigins({
                operations: compileResult.operations,
              });
            },
            bodyMarkers:
              options.chromeApi === undefined
                ? undefined
                : {
                    api: options.chromeApi,
                    runtimeStripPathAvailable:
                      options.runtimeStripPathAvailable === true,
                  },
          });
        } catch (error) {
          nativePhase = "failed";
          nativeRuntimeError =
            options.nativeRuntime.lastConnectError?.() ??
            (error instanceof Error
              ? error.message
              : "The native runtime failed before it could start.");
          return failure("extension.native-runtime-transition", {
            reason: nativeRuntimeError,
          });
        }

        console.log("[rogatio] session result:", JSON.stringify(sessionResult));
        if (!sessionResult.ok) {
          // Preserve the concrete adapter error for both the workspace and
          // diagnostics modal while keeping the public diagnostic code stable.
          nativePhase = "failed";
          nativeRuntimeError =
            options.nativeRuntime.lastConnectError?.() ?? sessionResult.reason;
          if (sessionResult.reason === "extension.native-host-missing")
            return failure("extension.native-host-missing", {
              reason: nativeRuntimeError,
            });
          if (sessionResult.reason === "extension.request-body-needs-trust")
            return failure("extension.request-body-needs-trust", {
              reason: nativeRuntimeError,
            });
          return failure("extension.native-runtime-transition", {
            reason: nativeRuntimeError,
          });
        }

        nativePhase = "started";
        nativeRuntimeError = null;
        // DNR reconcile runs inside state() → projectState (full desired set).
        return state();
      }
      if (request.command === "stop-native-runtime") {
        await stopNativeSession({
          extensionId: options.extensionId ?? "",
          nativeRuntime: options.nativeRuntime,
          getProject: async () => {
            const current = await repository.state();
            if (!current.ok) return null;
            const projectId = current.value.activeProjectId;
            if (!projectId) return null;
            const project = current.value.projects[projectId];
            if (!project) return null;
            return {
              data: project.data,
              enabledGroupIds: project.enabledGroupIds,
            };
          },
          getGrantedOrigins: async () => [],
          bodyMarkers:
            options.chromeApi === undefined
              ? undefined
              : {
                  api: options.chromeApi,
                  runtimeStripPathAvailable:
                    options.runtimeStripPathAvailable === true,
                },
        });
        nativePhase = "stopped";
        nativeRuntimeError = null;
        // DNR reconcile runs inside state() → projectState (full desired set).
        return state();
      }
      const result = await options.nativeRuntime.status();
      nativePhase = result.state;
      if (nativePhase === "started") nativeRuntimeError = null;
      return {
        ok: true,
        value: { nativeRuntimeState: { phase: nativePhase } },
      };
    }
    if (request.command === "diagnose-native-runtime") {
      const chromeError = options.nativeRuntime?.lastConnectError?.() ?? null;
      const connectNativeAvailable =
        typeof chrome !== "undefined" &&
        typeof chrome.runtime?.connectNative === "function";
      return {
        ok: true,
        value: {
          phase: nativePhase,
          extensionId: options.extensionId ?? null,
          hostName: "com.rogatio.runtime",
          chromeError,
          runtimeError: nativeRuntimeError,
          connectNativeAvailable,
          timestamp: Date.now(),
        },
      };
    }
    if (
      request.command === "review-permissions" ||
      request.command === "grant-permissions" ||
      request.command === "revoke-permission"
    ) {
      const projectId = stringValue(data.projectId);
      if (!projectId) return failure("extension.invalid-message");
      const exported = await repository.exportProject(projectId);
      if (!exported.ok) return failure("extension.not-found");
      const compiled = compileProject(exported.value);
      if (!compiled.ok) return failure("extension.storage-failed");
      let declared: readonly string[];
      try {
        declared = declaredPermissionOrigins({
          operations: compiled.operations,
        });
      } catch {
        return failure("extension.invalid-origin");
      }
      const grantedOrigins = await grantedOriginsFor(declared);
      if (request.command === "review-permissions") {
        await syncStoredGrants(projectId, declared, grantedOrigins);
        const current = await repository.state();
        if (!current.ok) return failure("extension.storage-failed");
        const projection = await projectState(current.value);
        return {
          ok: true,
          value: {
            origins: declared,
            granted: grantedOrigins.length === declared.length,
            state: {
              ...current.value,
              ruleStatuses: projection.statuses,
              badge: projection.badge,
              nativeRuntimeState: { phase: nativePhase },
            },
          },
        };
      }
      const requested = arrayOfStrings(data.origins);
      if (!requested) return failure("extension.invalid-message");
      const normalized = requested.map((origin) => normalizeSiteOrigin(origin));
      if (normalized.some((origin) => origin === null))
        return failure("extension.invalid-origin");
      const exact = normalized as string[];
      if (exact.some((origin) => !declared.includes(origin)))
        return failure("extension.invalid-origin");
      const changed =
        request.command === "grant-permissions"
          ? data.granted === true || (await options.permissions.request(exact))
          : await options.permissions.remove(exact);
      if (!changed) return failure("extension.permission-failed");
      const currentGranted = await grantedOriginsFor(declared);
      await syncStoredGrants(projectId, declared, currentGranted);
      // Permission changes move installed rules via state() → projectState
      // (full desired set). That covers activate-then-grant and revoke.
      await state();
      return {
        ok: true,
        value: {
          origins: declared,
          granted: currentGranted.length === declared.length,
        },
      };
    }
    return failure("extension.invalid-message");
  }

  return {
    async handle(value) {
      const parsed = parseRequest(value);
      if (!parsed.ok) return { ok: false, diagnostic: parsed.diagnostic };
      try {
        return await handleRequest(parsed.value);
      } catch {
        return failure("extension.storage-failed");
      }
    },
  };
}

export type { PermissionAdapter };
