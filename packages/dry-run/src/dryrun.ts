import type { MatcherOperation } from "@rogatio/compiler";
import type { HttpMethod, ResourceType } from "@rogatio/schema";
import { compileUrlRegex, HTTP_METHODS, RESOURCE_TYPES } from "@rogatio/schema";
import type {
  ActionPreview,
  DryRunError,
  DryRunOptions,
  DryRunResult,
  DryRunTestCase,
  MatchDimension,
  MatchState,
  PreviewActionFn,
  RuleMatchResult,
  UrlDryRunResult,
} from "./types.js";
import { parseTestUrl } from "./url.js";

const DEFAULT_MAX_CASES = 256;

function invalidCase(
  index?: number,
  message = "Test case is invalid",
): DryRunError {
  return {
    code: "dryrun.invalid-case",
    message,
    ...(index === undefined ? {} : { index }),
  };
}

function invalidUrl(
  index: number,
  message = "Test case URL is invalid",
): DryRunError {
  return { code: "dryrun.invalid-url", message, index };
}

function invalidOptions(): DryRunError {
  return invalidCase(undefined, "Dry-run options are invalid");
}

function ownPropertyNames(value: object): string[] | null {
  try {
    const names = Object.getOwnPropertyNames(value);
    const symbols = Object.getOwnPropertySymbols(value);
    return symbols.length === 0 ? names : null;
  } catch {
    return null;
  }
}

function dataProperty(
  value: object,
  key: string,
): { present: boolean; value?: unknown; valid: boolean } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { present: false, valid: true };
    if (!("value" in descriptor) || descriptor.enumerable === false) {
      return { present: true, valid: false };
    }
    return { present: true, value: descriptor.value, valid: true };
  } catch {
    return { present: true, valid: false };
  }
}

function validateCase(
  raw: unknown,
  index: number,
): { ok: true; value: DryRunTestCase } | { ok: false; error: DryRunError } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: invalidCase(index) };
  }

  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, error: invalidCase(index) };
    }
  } catch {
    return { ok: false, error: invalidCase(index) };
  }

  const names = ownPropertyNames(raw);
  if (names === null) return { ok: false, error: invalidCase(index) };
  const allowed = new Set(["url", "method", "resourceType"]);
  if (names.some((name) => !allowed.has(name))) {
    return { ok: false, error: invalidCase(index) };
  }

  const urlProperty = dataProperty(raw, "url");
  if (!urlProperty.valid) return { ok: false, error: invalidCase(index) };
  if (!urlProperty.present) {
    return { ok: false, error: invalidCase(index) };
  }
  if (typeof urlProperty.value !== "string") {
    return { ok: false, error: invalidUrl(index) };
  }
  const url = urlProperty.value;
  if (url.length === 0) return { ok: false, error: invalidUrl(index) };

  const methodProperty = dataProperty(raw, "method");
  const resourceTypeProperty = dataProperty(raw, "resourceType");
  if (!methodProperty.valid || !resourceTypeProperty.valid) {
    return { ok: false, error: invalidCase(index) };
  }
  const method = methodProperty.value;
  if (
    methodProperty.present &&
    (typeof method !== "string" ||
      !(HTTP_METHODS as readonly string[]).includes(method))
  ) {
    return { ok: false, error: invalidCase(index) };
  }
  const resourceType = resourceTypeProperty.value;
  if (
    resourceTypeProperty.present &&
    (typeof resourceType !== "string" ||
      !(RESOURCE_TYPES as readonly string[]).includes(resourceType))
  ) {
    return { ok: false, error: invalidCase(index) };
  }
  return {
    ok: true,
    value: {
      url,
      method: method as HttpMethod | undefined,
      resourceType: resourceType as ResourceType | undefined,
    },
  };
}

function safePreview(
  fn: PreviewActionFn,
  operation: MatcherOperation,
  url: string,
  testCase: DryRunTestCase,
): ActionPreview | null {
  try {
    return fn(operation, url, testCase);
  } catch {
    return null;
  }
}

function buildDimension(state: MatchState, detail: string): MatchDimension {
  return {
    state,
    matched: state === "not-applicable" ? null : state === "matched",
    detail,
  };
}

function emptySummary(): DryRunResult["summary"] {
  return {
    caseCount: 0,
    urlCount: 0,
    matchedUrlCount: 0,
    matchedRuleTotal: 0,
  };
}

function normalizeOptions(
  raw: unknown,
):
  | { ok: true; maxCases: number; previewAction?: PreviewActionFn }
  | { ok: false } {
  if (raw === undefined) {
    return { ok: true, maxCases: DEFAULT_MAX_CASES };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false };
  }
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false };
  } catch {
    return { ok: false };
  }
  const names = ownPropertyNames(raw);
  if (
    names === null ||
    names.some((name) => !["maxCases", "previewAction"].includes(name))
  ) {
    return { ok: false };
  }
  const maxCasesProperty = dataProperty(raw, "maxCases");
  const previewProperty = dataProperty(raw, "previewAction");
  if (!maxCasesProperty.valid || !previewProperty.valid) return { ok: false };

  let maxCases = DEFAULT_MAX_CASES;
  if (maxCasesProperty.present) {
    if (
      typeof maxCasesProperty.value !== "number" ||
      !Number.isSafeInteger(maxCasesProperty.value) ||
      maxCasesProperty.value <= 0
    ) {
      return { ok: false };
    }
    maxCases = maxCasesProperty.value;
  }
  let previewAction: PreviewActionFn | undefined;
  if (previewProperty.present) {
    if (
      previewProperty.value !== undefined &&
      typeof previewProperty.value !== "function"
    ) {
      return { ok: false };
    }
    previewAction = previewProperty.value as PreviewActionFn | undefined;
  }
  return { ok: true, maxCases, previewAction };
}

export function dryRunProject(
  operations: readonly MatcherOperation[],
  cases: readonly DryRunTestCase[],
  options?: DryRunOptions,
): DryRunResult {
  const normalizedOptions = normalizeOptions(options);
  if (!normalizedOptions.ok) {
    return { results: [], errors: [invalidOptions()], summary: emptySummary() };
  }

  const errors: DryRunError[] = [];

  if (!Array.isArray(cases)) {
    return {
      results: [],
      errors: [invalidCase(undefined, "Test cases must be an array")],
      summary: emptySummary(),
    };
  }

  let caseCount: number;
  try {
    caseCount = cases.length;
    if (caseCount > normalizedOptions.maxCases) {
      return {
        results: [],
        errors: [
          {
            code: "dryrun.batch-limit",
            message: `Test batch exceeds maxCases (${normalizedOptions.maxCases})`,
          },
        ],
        summary: emptySummary(),
      };
    }
    for (let index = 0; index < caseCount; index += 1) {
      if (!Object.hasOwn(cases, index)) {
        return {
          results: [],
          errors: [invalidCase(index)],
          summary: emptySummary(),
        };
      }
    }
  } catch {
    return { results: [], errors: [invalidCase()], summary: emptySummary() };
  }

  const validCases: Array<{ value: DryRunTestCase; index: number }> = [];
  for (let index = 0; index < caseCount; index += 1) {
    let raw: unknown;
    try {
      raw = cases[index];
    } catch {
      errors.push(invalidCase(index));
      continue;
    }
    const result = validateCase(raw, index);
    if (result.ok) {
      validCases.push({ value: result.value, index });
    } else {
      errors.push(result.error);
    }
  }

  const regexCache = new Map<string, RegExp | null>();
  const getRegex = (source: string): RegExp | null => {
    let cached = regexCache.get(source);
    if (cached === undefined) {
      cached = compileUrlRegex(source);
      regexCache.set(source, cached);
    }
    return cached;
  };

  const results: UrlDryRunResult[] = [];
  let matchedUrlCount = 0;
  let matchedRuleTotal = 0;

  for (const validCase of validCases) {
    const testCase = validCase.value;
    const parsed = parseTestUrl(testCase.url);
    if (!parsed.ok) {
      errors.push(invalidUrl(validCase.index));
      continue;
    }

    const rules: RuleMatchResult[] = [];
    for (const op of operations) {
      const matcher = op.matcher;
      const regex = getRegex(matcher.urlRegex.source);
      const regexState: MatchState = regex
        ? regex.test(testCase.url)
          ? "matched"
          : "unmatched"
        : "unmatched";
      const originState: MatchState = matcher.origins.includes(
        parsed.value.origin,
      )
        ? "matched"
        : "unmatched";
      const methodState: MatchState =
        testCase.method === undefined
          ? "not-applicable"
          : matcher.method === undefined || matcher.method === testCase.method
            ? "matched"
            : "unmatched";
      const resourceState: MatchState =
        testCase.resourceType === undefined
          ? "not-applicable"
          : matcher.resourceTypes.length === 0 ||
              matcher.resourceTypes.includes(testCase.resourceType)
            ? "matched"
            : "unmatched";

      const matched =
        regexState === "matched" &&
        originState === "matched" &&
        methodState !== "unmatched" &&
        resourceState !== "unmatched";

      const urlRegexDim = buildDimension(
        regexState,
        regexState === "matched"
          ? `matches /${matcher.urlRegex.source}/`
          : `does not match /${matcher.urlRegex.source}/`,
      );
      const originDim = buildDimension(
        originState,
        originState === "matched"
          ? `origin ${parsed.value.origin} in [${matcher.origins.join(", ")}]`
          : `origin ${parsed.value.origin} not in [${matcher.origins.join(", ")}]`,
      );
      const methodDim = buildDimension(
        methodState,
        methodState === "not-applicable"
          ? "method not specified"
          : methodState === "matched"
            ? matcher.method === undefined
              ? "rule has no method constraint"
              : `method ${testCase.method} matches`
            : `rule method ${matcher.method} != ${testCase.method}`,
      );
      const resourceDim = buildDimension(
        resourceState,
        resourceState === "not-applicable"
          ? "resource type not specified"
          : resourceState === "matched"
            ? matcher.resourceTypes.length === 0
              ? "rule has no resource type constraint"
              : `resource type ${testCase.resourceType} matches`
            : `rule resource types [${matcher.resourceTypes.join(", ")}] exclude ${testCase.resourceType}`,
      );

      const actionPreview = normalizedOptions.previewAction
        ? safePreview(
            normalizedOptions.previewAction,
            op,
            testCase.url,
            testCase,
          )
        : null;

      rules.push({
        groupId: op.groupId,
        ruleId: op.ruleId,
        matched,
        urlRegex: urlRegexDim,
        effectiveOrigin: originDim,
        method: methodDim,
        resourceType: resourceDim,
        actionPreview,
      });
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
      caseCount: validCases.length,
      urlCount: results.length,
      matchedUrlCount,
      matchedRuleTotal,
    },
  };
}
