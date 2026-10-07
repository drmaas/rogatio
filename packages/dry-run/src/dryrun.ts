import type { RogatioOperation } from "@rogatio/compiler";
import { invalidOptions, invalidUrl } from "./errors.js";
import { evaluateRule } from "./evaluate.js";
import { normalizeOptions, readCaseBatch } from "./input.js";
import type {
  DryRunOptions,
  DryRunResult,
  DryRunTestCase,
  RuleMatchResult,
  UrlDryRunResult,
} from "./types.js";
import { parseTestUrl } from "./url.js";

function emptySummary(): DryRunResult["summary"] {
  return {
    caseCount: 0,
    urlCount: 0,
    matchedUrlCount: 0,
    matchedRuleTotal: 0,
  };
}

export function dryRunProject(
  operations: readonly RogatioOperation[],
  cases: readonly DryRunTestCase[],
  options?: DryRunOptions,
): DryRunResult {
  const normalizedOptions = normalizeOptions(options);
  if (!normalizedOptions.ok) {
    return { results: [], errors: [invalidOptions()], summary: emptySummary() };
  }

  const batch = readCaseBatch(cases, normalizedOptions.maxCases);
  if (!batch.ok) {
    return {
      results: [],
      errors: [batch.error],
      summary: emptySummary(),
    };
  }

  const errors = [...batch.errors];
  const results: UrlDryRunResult[] = [];
  let matchedUrlCount = 0;
  let matchedRuleTotal = 0;

  for (const validCase of batch.valid) {
    const testCase = validCase.value;
    const parsed = parseTestUrl(testCase.url);
    if (!parsed.ok) {
      errors.push(invalidUrl(validCase.index));
      continue;
    }

    const rules: RuleMatchResult[] = [];
    for (const op of operations) {
      rules.push(evaluateRule(op, testCase, normalizedOptions.previewAction));
    }

    const matchedRuleCount = rules.filter((rule) => rule.matched).length;
    results.push({
      url: testCase.url,
      rules,
      matchedRuleCount,
    });
    if (matchedRuleCount > 0) {
      matchedUrlCount += 1;
    }
    matchedRuleTotal += matchedRuleCount;
  }

  return {
    results,
    errors,
    summary: {
      caseCount: batch.valid.length,
      urlCount: results.length,
      matchedUrlCount,
      matchedRuleTotal,
    },
  };
}
