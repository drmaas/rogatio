import type { NormalizedMatcher, RogatioOperation } from "@rogatio/compiler";
import { sourceMatches } from "@rogatio/compiler";
import type {
  ActionPreview,
  DryRunTestCase,
  MatchDimension,
  MatchState,
  PreviewActionFn,
  RuleMatchResult,
} from "./types.js";

export function buildDimension(
  state: MatchState,
  detail: string,
): MatchDimension {
  return {
    state,
    matched: state === "not-applicable" ? null : state === "matched",
    detail,
  };
}

function sourceDetail(
  source: { key: string; value: string },
  matched: boolean,
): string {
  const subject = source.key === "host" ? "hostname" : "url";
  return matched
    ? `${subject} matched /${source.value}/ (${source.key})`
    : `${subject} did not match /${source.value}/ (${source.key})`;
}

export function sourceDimension(
  matcher: NormalizedMatcher,
  url: string,
): MatchDimension {
  const sourceState: MatchState = sourceMatches(matcher.source, url)
    ? "matched"
    : "unmatched";
  return buildDimension(
    sourceState,
    sourceDetail(matcher.source, sourceState === "matched"),
  );
}

export function methodDimension(
  matcher: NormalizedMatcher,
  testCase: DryRunTestCase,
): MatchDimension {
  const methodState: MatchState =
    testCase.method === undefined
      ? "not-applicable"
      : matcher.method === undefined || matcher.method === testCase.method
        ? "matched"
        : "unmatched";
  return buildDimension(
    methodState,
    methodState === "not-applicable"
      ? "method not specified"
      : methodState === "matched"
        ? matcher.method === undefined
          ? "rule has no method constraint"
          : `method ${testCase.method} matches`
        : `rule method ${matcher.method} != ${testCase.method}`,
  );
}

export function resourceTypeDimension(
  matcher: NormalizedMatcher,
  testCase: DryRunTestCase,
): MatchDimension {
  const resourceState: MatchState =
    testCase.resourceType === undefined
      ? "not-applicable"
      : matcher.resourceTypes.length === 0 ||
          matcher.resourceTypes.includes(testCase.resourceType)
        ? "matched"
        : "unmatched";
  return buildDimension(
    resourceState,
    resourceState === "not-applicable"
      ? "resource type not specified"
      : resourceState === "matched"
        ? matcher.resourceTypes.length === 0
          ? "rule has no resource type constraint"
          : `resource type ${testCase.resourceType} matches`
        : `rule resource types [${matcher.resourceTypes.join(", ")}] exclude ${testCase.resourceType}`,
  );
}

export function safePreview(
  fn: PreviewActionFn,
  operation: RogatioOperation,
  url: string,
  testCase: DryRunTestCase,
): ActionPreview | null {
  try {
    return fn(operation, url, testCase);
  } catch {
    return null;
  }
}

export function evaluateRule(
  operation: RogatioOperation,
  testCase: DryRunTestCase,
  previewAction?: PreviewActionFn,
): RuleMatchResult {
  const matcher = operation.matcher;
  const source = sourceDimension(matcher, testCase.url);
  const method = methodDimension(matcher, testCase);
  const resourceType = resourceTypeDimension(matcher, testCase);

  const matched =
    source.state === "matched" &&
    method.state !== "unmatched" &&
    resourceType.state !== "unmatched";

  const actionPreview = previewAction
    ? safePreview(previewAction, operation, testCase.url, testCase)
    : null;

  return {
    groupId: operation.groupId,
    ruleId: operation.ruleId,
    matched,
    source,
    method,
    resourceType,
    actionPreview,
  };
}
