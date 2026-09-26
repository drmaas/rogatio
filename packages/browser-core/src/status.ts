import type { RogatioOperation } from "@rogatio/compiler";
import { coreDiagnostic } from "./diagnostics.js";
import type { BadgeState, RuleStatus, RuleStatusInput } from "./types.js";

export function computeDesiredRules(input: {
  readonly operations: readonly RogatioOperation[];
  readonly enabledGroupIds: readonly string[];
}): readonly RogatioOperation[] {
  const enabled = new Set(input.enabledGroupIds);
  return input.operations.filter((operation) => enabled.has(operation.groupId));
}

export function computeRuleStatuses(
  input: RuleStatusInput,
): readonly RuleStatus[] {
  const enabled = new Set(input.enabledGroupIds);
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
