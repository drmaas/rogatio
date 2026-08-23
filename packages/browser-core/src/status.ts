import { compileProject, type MatcherOperation } from "@rogatio/compiler";
import { coreDiagnostic } from "./diagnostics.js";
import type {
  BadgeState,
  CoreResult,
  RuleStatus,
  RuleStatusInput,
} from "./types.js";

function originSets(
  enabledGroupIds: readonly string[],
  grantedOrigins: readonly string[],
): { enabled: Set<string>; granted: Set<string> } {
  return {
    enabled: new Set(enabledGroupIds),
    granted: new Set(grantedOrigins),
  };
}

export function computeDesiredRules(input: {
  readonly operations: readonly MatcherOperation[];
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
}): readonly MatcherOperation[] {
  const { enabled, granted } = originSets(
    input.enabledGroupIds,
    input.grantedOrigins,
  );
  return input.operations.filter(
    (operation) =>
      enabled.has(operation.groupId) &&
      operation.matcher.origins.every((origin) => granted.has(origin)),
  );
}

export function computeRuleStatuses(
  input: RuleStatusInput,
): readonly RuleStatus[] {
  const { enabled, granted } = originSets(
    input.enabledGroupIds,
    input.grantedOrigins,
  );
  const installed = new Set(input.installedRuleIds);
  const statuses: RuleStatus[] = [];
  for (const operation of input.operations) {
    if (!enabled.has(operation.groupId)) {
      statuses.push({
        groupId: operation.groupId,
        ruleId: operation.ruleId,
        status: "disabled",
      });
      continue;
    }
    if (!operation.matcher.origins.every((origin) => granted.has(origin))) {
      statuses.push({
        groupId: operation.groupId,
        ruleId: operation.ruleId,
        status: "needs permission",
      });
      continue;
    }
    if (!installed.has(operation.ruleId)) {
      statuses.push({
        groupId: operation.groupId,
        ruleId: operation.ruleId,
        status: "error",
        diagnostics: [
          coreDiagnostic("core.rule-not-installed", {
            ruleId: operation.ruleId,
            groupId: operation.groupId,
          }),
        ],
      });
      continue;
    }
    statuses.push({
      groupId: operation.groupId,
      ruleId: operation.ruleId,
      status: "active",
    });
  }
  return statuses;
}

export function computeBadge(statuses: readonly RuleStatus[]): BadgeState {
  let active = 0;
  let attention = false;
  for (const { status } of statuses) {
    if (status === "active") {
      active += 1;
    } else if (status !== "disabled") {
      attention = true;
    }
  }
  return { text: String(active), attention };
}

export function computeDeclaredOrigins(
  value: unknown,
): CoreResult<readonly string[]> {
  const compiled = compileProject(value);
  if (!compiled.ok) {
    return { ok: false, kind: "failure", diagnostics: compiled.diagnostics };
  }
  const origins = new Set<string>();
  for (const operation of compiled.operations) {
    for (const origin of operation.matcher.origins) {
      origins.add(origin);
    }
  }
  const sorted: string[] = [...origins].sort();
  return { ok: true, value: sorted };
}
