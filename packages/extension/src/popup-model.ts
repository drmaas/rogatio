export type GroupStatus =
  | "active"
  | "disabled"
  | "needs permission"
  | "needs proxy"
  | "unsupported"
  | "error";

export interface PopupRuleStatus {
  readonly groupId: string;
  readonly ruleId: string;
  readonly status: string;
  readonly diagnostics?: readonly unknown[];
}

export interface PopupProjectGroup {
  readonly id: string;
  readonly name: string;
  readonly rules: readonly unknown[];
}

export interface PopupProject {
  readonly data: { readonly groups: readonly PopupProjectGroup[] };
  readonly enabledGroupIds: readonly string[];
  readonly name?: string;
}

export interface PopupEnvelope {
  readonly projects: Readonly<Record<string, PopupProject>>;
  readonly activeProjectId: string | null;
  readonly ruleStatuses?: readonly PopupRuleStatus[];
  readonly badge?: { readonly text: string; readonly attention: boolean };
}

export interface PopupRuleRow {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly status: GroupStatus;
  readonly enabled: boolean;
}

export interface ExtensionResponse {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly diagnostic?: { readonly code?: string };
}

export type PopupSend = (
  message: Record<string, unknown>,
) => Promise<ExtensionResponse>;

export const MANAGEMENT_PAGE = "index.html";

const STATUS_PRECEDENCE: readonly GroupStatus[] = [
  "error",
  "needs proxy",
  "needs permission",
  "unsupported",
  "active",
];

export function aggregateGroupStatus(
  enabled: boolean,
  ruleStatuses: readonly PopupRuleStatus[],
): GroupStatus {
  if (!enabled) return "disabled";
  if (ruleStatuses.length === 0) return "active";
  for (const status of STATUS_PRECEDENCE) {
    if (ruleStatuses.some((rule) => rule.status === status)) return status;
  }
  return "active";
}

export function groupUrl(groupId: string): string {
  return `${MANAGEMENT_PAGE}?group=${encodeURIComponent(groupId)}`;
}

export interface PopupModelOptions {
  readonly envelope: PopupEnvelope;
  readonly send: PopupSend;
}

export interface PopupModel {
  readonly activeProjectId: string | null;
  readonly activeProjectName: string | null;
  readonly rows: () => readonly PopupRuleRow[];
  readonly toggle: (groupId: string, enabled: boolean) => Promise<void>;
  readonly openAppUrl: () => string;
  readonly groupUrl: (groupId: string) => string;
}

export function createPopupModel(options: PopupModelOptions): PopupModel {
  const { envelope, send } = options;
  const activeProjectId = envelope.activeProjectId;
  const activeProject =
    activeProjectId !== null ? envelope.projects[activeProjectId] : undefined;
  const ruleStatuses = envelope.ruleStatuses ?? [];
  const enabledGroupIds = new Set(
    activeProject ? activeProject.enabledGroupIds : [],
  );

  return {
    activeProjectId,
    activeProjectName:
      activeProject && typeof activeProject.name === "string"
        ? activeProject.name
        : null,
    rows() {
      if (!activeProject) return [];
      const groups = Array.isArray(activeProject.data.groups)
        ? activeProject.data.groups
        : [];
      return groups.flatMap((group) => {
        const enabled = enabledGroupIds.has(group.id);
        const rules = Array.isArray(group.rules) ? group.rules : [];
        return rules.map((rule, index) => {
          const candidate = rule as {
            readonly id?: unknown;
            readonly name?: unknown;
          };
          const ruleId =
            typeof candidate.id === "string"
              ? candidate.id
              : `${group.id}-${index}`;
          const ruleStatus = ruleStatuses.find(
            (status) => status.groupId === group.id && status.ruleId === ruleId,
          );
          return {
            id: ruleId,
            groupId: group.id,
            name:
              typeof candidate.name === "string" && candidate.name.length > 0
                ? candidate.name
                : `Rule ${index + 1}`,
            status: aggregateGroupStatus(
              enabled,
              ruleStatus ? [ruleStatus] : [],
            ),
            enabled,
          };
        });
      });
    },
    async toggle(groupId, enabled) {
      if (!activeProjectId || !groupId) return;
      await send({
        version: 1,
        command: "set-group-enabled",
        projectId: activeProjectId,
        groupId,
        enabled,
      });
    },
    openAppUrl() {
      return MANAGEMENT_PAGE;
    },
    groupUrl(groupId) {
      return groupUrl(groupId);
    },
  };
}
