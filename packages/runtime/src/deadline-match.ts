import { sourceMatchText } from "@rogatio/compiler";
import { compileUrlRegex, type SourceCondition } from "@rogatio/schema";
import { RUNTIME_LIMITS } from "./limits.js";
import { runRegexExec, runRegexTest } from "./regex-replace.js";

/**
 * URL or host source match on the regex deadline worker.
 * An elapsed deadline or a worker failure is a non-match.
 */
export async function sourceMatchesWithinDeadline(
  source: SourceCondition,
  url: string,
): Promise<boolean> {
  if (compileUrlRegex(source.value) === null) return false;
  const text = sourceMatchText(source, url);
  if (text === null) return false;
  return runRegexTest(text, source.value, RUNTIME_LIMITS.maxRegexDeadlineMs);
}

/**
 * Flagless URL capture exec on the regex deadline worker.
 * An elapsed deadline or a worker failure is a non-match.
 */
export function matchUrlCapturesWithinDeadline(
  urlRegex: string,
  url: string,
): Promise<readonly (string | undefined)[] | null> {
  return runRegexExec(url, urlRegex, RUNTIME_LIMITS.maxRegexDeadlineMs);
}
