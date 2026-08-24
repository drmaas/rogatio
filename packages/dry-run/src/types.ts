import type { MatcherOperation } from "@rogatio/compiler";
import type { HttpMethod, ResourceType } from "@rogatio/schema";

export type MatchState = "matched" | "unmatched" | "not-applicable";

export interface MatchDimension {
  state: MatchState;
  matched: boolean | null;
  detail: string;
}

export interface ActionPreview {
  kind: string;
  summary: string;
}

export interface RuleMatchResult {
  groupId: string;
  ruleId: string;
  matched: boolean;
  urlRegex: MatchDimension;
  effectiveOrigin: MatchDimension;
  method: MatchDimension;
  resourceType: MatchDimension;
  actionPreview: ActionPreview | null;
}

export interface UrlDryRunResult {
  url: string;
  rules: RuleMatchResult[];
  matchedRuleCount: number;
}

export interface DryRunError {
  code: "dryrun.invalid-url" | "dryrun.batch-limit" | "dryrun.invalid-case";
  message: string;
  index?: number;
}

export interface DryRunTestCase {
  readonly url: string;
  method?: HttpMethod;
  resourceType?: ResourceType;
}

export interface DryRunSummary {
  caseCount: number;
  urlCount: number;
  matchedUrlCount: number;
  matchedRuleTotal: number;
}

export type PreviewActionFn = (
  operation: MatcherOperation,
  url: string,
  testCase: DryRunTestCase,
) => ActionPreview | null;

export interface DryRunOptions {
  maxCases?: number;
  previewAction?: PreviewActionFn;
}

export interface DryRunResult {
  results: UrlDryRunResult[];
  errors: DryRunError[];
  summary: DryRunSummary;
}
