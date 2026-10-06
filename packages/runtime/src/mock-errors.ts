/** Oldest entry drops when a new rule exceeds this cap. */
export const MAX_MOCK_FILE_ERRORS = 64;

const FILE_ERROR_CODES: ReadonlySet<string> = new Set([
  "runtime.file-denied",
  "runtime.file-race-rejected",
  "runtime.size-limit",
  "runtime.platform-unsupported",
]);

export interface MockFileErrorEntry {
  readonly ruleId: string;
  readonly code: string;
}

export function isMockFileError(code: string): boolean {
  return FILE_ERROR_CODES.has(code);
}

/** Record a file-read failure. A repeat refreshes recency. Non-file codes are ignored. */
export function recordMockFileError(
  errors: Map<string, string>,
  ruleId: string,
  code: string,
): void {
  if (!isMockFileError(code)) return;
  if (errors.has(ruleId)) errors.delete(ruleId);
  errors.set(ruleId, code);
  while (errors.size > MAX_MOCK_FILE_ERRORS) {
    const oldest = errors.keys().next().value;
    if (oldest === undefined) break;
    errors.delete(oldest);
  }
}

export function clearMockFileError(
  errors: Map<string, string>,
  ruleId: string,
): void {
  errors.delete(ruleId);
}

/** Stable rule-id order. Codes only; callers must not add paths. */
export function listMockFileErrors(
  errors: ReadonlyMap<string, string>,
): MockFileErrorEntry[] {
  return [...errors.entries()]
    .map(([ruleId, code]) => ({ ruleId, code }))
    .sort((left, right) =>
      left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0,
    );
}
