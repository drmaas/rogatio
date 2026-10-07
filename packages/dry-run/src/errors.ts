import type { DryRunError } from "./types.js";

export function invalidCase(
  index?: number,
  message = "Test case is invalid",
): DryRunError {
  return {
    code: "dryrun.invalid-case",
    message,
    ...(index === undefined ? {} : { index }),
  };
}

export function invalidUrl(
  index: number,
  message = "Test case URL is invalid",
): DryRunError {
  return { code: "dryrun.invalid-url", message, index };
}

export function invalidOptions(): DryRunError {
  return invalidCase(undefined, "Dry-run options are invalid");
}

export function batchLimit(maxCases: number): DryRunError {
  return {
    code: "dryrun.batch-limit",
    message: `Test batch exceeds maxCases (${maxCases})`,
  };
}
