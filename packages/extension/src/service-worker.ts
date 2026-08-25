import {
  computeBadge,
  computeRuleStatuses,
  type MockRuntimePhase,
  type NativeRuntimePhase,
  ProjectRepository,
  type RuleInstallerAdapter,
  RuntimeStateController,
  type StorageAdapter,
} from "@rogatio/browser-core";
import {
  compileProject,
  type HeaderOperation,
  type MatcherOperation,
  type MockOperation,
  type RogatioOperation,
} from "@rogatio/compiler";
import { normalizeSiteOrigin } from "@rogatio/schema";
import {
  type ExtensionDiagnostic,
  extensionDiagnostic,
} from "./diagnostics.js";
import { installHeaderRules } from "./installer.js";
import {
  DEFAULT_MOCK_PORT,
  type MockRuntimeConnection,
} from "./mock-runtime.js";
import { declaredPermissionOrigins } from "./permissions.js";
import { projectHeaders } from "./projection.js";
import { type ExtensionRequest, parseRequest } from "./protocol.js";

type PermissionAdapter = {
  contains(origins: readonly string[]): Promise<boolean>;
  request(origins: readonly string[]): Promise<boolean>;
  remove(origins: readonly string[]): Promise<boolean>;
};

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
  readonly nativeRuntime?: {
    start(): Promise<{
      readonly state: NativeRuntimePhase | "unsupported";
      readonly message?: string;
    }>;
    stop(): Promise<{ readonly state: NativeRuntimePhase | "unsupported" }>;
    status(): Promise<{ readonly state: NativeRuntimePhase | "unsupported" }>;
  };
  readonly mockRuntime?: {
    readonly fetchConnection: (
      port: number,
    ) => Promise<MockRuntimeConnection | null>;
    readonly setConnection?: (connection: MockRuntimeConnection | null) => void;
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

function arrayOfStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}

function operationStatuses(
  operations: readonly RogatioOperation[],
  installedRuleIds: readonly string[],
  enabledGroupIds: readonly string[],
  grantedOrigins: readonly string[],
  mockPhase: MockRuntimePhase,
  mockTokens: ReadonlyMap<string, string>,
  nativePhase: NativeRuntimePhase | "unsupported",
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
    if (operation?.kind === "response-body") {
      if (nativePhase === "unsupported" || nativePhase !== "started") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "needs proxy",
        };
      }
      if (status.status === "active" || status.status === "error")
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "active",
        };
      return { ...status };
    }
    if (operation?.kind === "mock") {
      if (mockPhase !== "connected") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "needs proxy",
        };
      }
      if (!mockTokens.has(operation.ruleId)) {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "error",
          diagnostics: [
            extensionDiagnostic("extension.mock-token-missing", {
              ruleId: operation.ruleId,
            }),
          ],
        };
      }
      if (status.status === "active") {
        return {
          groupId: status.groupId,
          ruleId: status.ruleId,
          status: "active",
        };
      }
      return { ...status };
    }
    // redirect and query operations are installable; pass through status
    if (status.status === "active") {
      return {
        groupId: status.groupId,
        ruleId: status.ruleId,
        status: "active",
      };
    }
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
  const mockRuntimeState = new RuntimeStateController(undefined, options.now);
  let mockTokens = new Map<string, string>();
  let nativePhase: NativeRuntimePhase | "unsupported" = options.nativeRuntime
    ? "stopped"
    : "unsupported";
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

  async function projectState(
    envelope: {
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
    },
    mockPhase: MockRuntimePhase,
    mockTokens: ReadonlyMap<string, string>,
  ): Promise<StateProjection> {
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
    const _matcherOps = compiled.operations.filter(
      (op): op is MatcherOperation => op.kind === "matcher",
    );
    const headerOps = compiled.operations.filter(
      (op): op is HeaderOperation => op.kind === "header",
    );
    const declared = declaredPermissionOrigins({
      operations: compiled.operations,
    });
    const granted = await grantedOriginsFor(declared);
    let installedRuleIds: string[] = [];
    try {
      const installed = await options.installer.current();
      installedRuleIds = installed.map((operation) => operation.ruleId);
    } catch {
      installedRuleIds = [];
    }
    if (headerOps.length > 0) {
      const headerProjections = projectHeaders(headerOps);
      const result = await installHeaderRules(headerProjections);
      installedRuleIds.push(...result.installed.map(String));
    }
    const statuses = operationStatuses(
      compiled.operations,
      installedRuleIds,
      project.enabledGroupIds,
      granted,
      mockPhase,
      mockTokens,
      nativePhase,
    );
    const badgeStatuses = statuses.map((status) => ({
      groupId: String(status.groupId),
      ruleId: String(status.ruleId),
      status: status.status as
        | "active"
        | "disabled"
        | "needs permission"
        | "needs proxy"
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
    const mock = mockRuntimeState.snapshot().mock;
    const projection = await projectState(result.value, mock.phase, mockTokens);
    return {
      ok: true,
      value: {
        ...result.value,
        ruleStatuses: projection.statuses,
        badge: projection.badge,
        mockRuntimeState: mockRuntimeState.snapshot().mock,
        nativeRuntimeState: { phase: nativePhase },
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
      const mock = mockRuntimeState.snapshot().mock;
      const projection = await projectState(
        result.value,
        mock.phase,
        mockTokens,
      );
      return {
        ok: true,
        value: {
          ...result.value,
          ruleStatuses: projection.statuses,
          badge: projection.badge,
          mockRuntimeState: mockRuntimeState.snapshot().mock,
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
      await state();
      return { ok: true, value: result.value };
    }
    if (
      request.command === "start-native-runtime" ||
      request.command === "stop-native-runtime" ||
      request.command === "get-native-runtime-status"
    ) {
      if (!options.nativeRuntime) {
        nativePhase = "unsupported";
        return request.command === "get-native-runtime-status"
          ? { ok: true, value: { nativeRuntimeState: { phase: nativePhase } } }
          : failure("extension.native-runtime-unavailable");
      }
      if (request.command === "start-native-runtime") {
        const result = await options.nativeRuntime.start();
        nativePhase = result.state;
        return result.state === "started"
          ? state()
          : {
              ok: true,
              value: {
                nativeRuntimeState: { phase: nativePhase },
                message: result.message,
              },
            };
      }
      if (request.command === "stop-native-runtime") {
        const result = await options.nativeRuntime.stop();
        nativePhase = result.state;
        return state();
      }
      const result = await options.nativeRuntime.status();
      nativePhase = result.state;
      return {
        ok: true,
        value: { nativeRuntimeState: { phase: nativePhase } },
      };
    }
    if (request.command === "check-mock-runtime") {
      const port =
        typeof data.port === "number" ? data.port : DEFAULT_MOCK_PORT;
      const current = await repository.state();
      if (!current.ok) return failure("extension.storage-failed");
      const activeProjectId = current.value.activeProjectId;
      if (activeProjectId === null) return failure("extension.not-found");
      const project = current.value.projects[activeProjectId];
      if (!project) return failure("extension.not-found");
      const compiled = compileProject(project.data);
      if (!compiled.ok) return failure("extension.storage-failed");
      const enabledGroupIds = new Set(project.enabledGroupIds);
      const enabledMockOps = compiled.operations.filter(
        (op): op is MockOperation =>
          op.kind === "mock" && enabledGroupIds.has(op.groupId),
      );

      const begin = mockRuntimeState.beginMockCheck();
      if (!begin.ok) return failure("extension.mock-check-in-progress");

      const connection = options.mockRuntime
        ? await options.mockRuntime.fetchConnection(port)
        : null;
      if (connection === null) {
        mockRuntimeState.completeMockCheck(false, "Mock runtime not reachable");
        mockTokens = new Map();
        options.mockRuntime?.setConnection?.(null);
      } else {
        mockTokens = new Map(
          connection.mocks.map((mock) => [mock.ruleId, mock.token]),
        );
        mockRuntimeState.completeMockCheck(true);
        options.mockRuntime?.setConnection?.(connection);
        const declared = declaredPermissionOrigins({
          operations: compiled.operations,
        });
        const granted = await grantedOriginsFor(declared);
        const grantedSet = new Set(granted);
        const installOps = enabledMockOps.filter(
          (op) =>
            op.matcher.origins.every((origin) => grantedSet.has(origin)) &&
            mockTokens.has(op.ruleId),
        );
        if (installOps.length > 0) {
          await options.installer.install(installOps);
        }
      }
      return state();
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
        const mock = mockRuntimeState.snapshot().mock;
        const projection = await projectState(
          current.value,
          mock.phase,
          mockTokens,
        );
        return {
          ok: true,
          value: {
            origins: declared,
            granted: grantedOrigins.length === declared.length,
            state: {
              ...current.value,
              ruleStatuses: projection.statuses,
              badge: projection.badge,
              mockRuntimeState: mockRuntimeState.snapshot().mock,
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
          ? await options.permissions.request(exact)
          : await options.permissions.remove(exact);
      if (!changed) return failure("extension.permission-failed");
      const currentGranted = await grantedOriginsFor(declared);
      await syncStoredGrants(projectId, declared, currentGranted);
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
