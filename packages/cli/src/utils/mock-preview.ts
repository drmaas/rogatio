import { basename } from "node:path";
import type {
  MatcherOperation,
  MockOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import type {
  ActionPreview,
  DryRunTestCase,
  PreviewActionFn,
} from "@rogatio/dry-run";

/**
 * Builds a dry-run `previewAction` that maps a matched matcher operation back to
 * its compiled `MockOperation` and emits a stable `{ kind: "mock", summary }`
 * preview, e.g. "Mock 200 (inline body, 42 bytes)" or
 * "Mock 200 (file snapshot: data.json)".
 */
export function createMockPreviewAction(
  operations: readonly RogatioOperation[],
): PreviewActionFn {
  const mockByRuleId = new Map<string, MockOperation>();
  for (const operation of operations) {
    if (operation.kind === "mock") {
      mockByRuleId.set(operation.ruleId, operation);
    }
  }
  return (
    operation: MatcherOperation,
    _url: string,
    _testCase: DryRunTestCase,
  ): ActionPreview | null => {
    const mock = mockByRuleId.get(operation.ruleId);
    if (mock === undefined) return null;
    if (mock.mock.body !== undefined) {
      return {
        kind: "mock",
        summary: `Mock ${mock.mock.status} (inline body, ${Buffer.byteLength(
          mock.mock.body,
          "utf8",
        )} bytes)`,
      };
    }
    return {
      kind: "mock",
      summary: `Mock ${mock.mock.status} (file snapshot: ${basename(
        mock.mock.file ?? "",
      )})`,
    };
  };
}
