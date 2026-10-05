import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import type { RuntimeMockConfig } from "./types.js";

/** Every compiled operation keeps a matcher so the preset can still select it. */
export function matchersFromOperations(
  operations: readonly RogatioOperation[],
): MatcherOperation[] {
  return operations.map((operation) => ({
    kind: "matcher",
    groupId: operation.groupId,
    ruleId: operation.ruleId,
    name: operation.name,
    redactSensitiveInLogs: operation.redactSensitiveInLogs,
    matcher: operation.matcher,
  }));
}

/** Mock configs for enabled groups. An omitted set includes every mock rule. */
export function mocksFromOperations(
  operations: readonly RogatioOperation[],
  enabledGroupIds: ReadonlySet<string> | undefined,
): RuntimeMockConfig[] {
  const mocks: RuntimeMockConfig[] = [];
  for (const operation of operations) {
    if (operation.kind !== "mock") continue;
    if (
      enabledGroupIds !== undefined &&
      !enabledGroupIds.has(operation.groupId)
    ) {
      continue;
    }
    const mock = operation.mock;
    mocks.push({
      ruleId: operation.ruleId,
      status: mock.status,
      ...(mock.headers === undefined ? {} : { headers: mock.headers }),
      ...(mock.delayMs === undefined ? {} : { delayMs: mock.delayMs }),
      ...(mock.body === undefined ? {} : { body: mock.body }),
      ...(mock.file === undefined ? {} : { file: mock.file }),
    });
  }
  return mocks;
}
