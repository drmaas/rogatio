import { describe, expect, it } from "vitest";
import {
  MATCH_LOGGING_ENABLED_KEY,
  readMatchLoggingEnabledFromStorageResult,
} from "../src/match-logging-enabled.js";

describe("readMatchLoggingEnabledFromStorageResult", () => {
  it("defaults on when the key is missing", () => {
    expect(readMatchLoggingEnabledFromStorageResult({})).toBe(true);
    expect(readMatchLoggingEnabledFromStorageResult(undefined)).toBe(true);
  });

  it("enables only for boolean true", () => {
    expect(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: true,
      }),
    ).toBe(true);
  });

  it("disables for boolean false and non-boolean values", () => {
    expect(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: false,
      }),
    ).toBe(false);
    expect(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: "true",
      }),
    ).toBe(false);
    expect(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: 1,
      }),
    ).toBe(false);
  });

  it("treats an own undefined value as on", () => {
    expect(
      readMatchLoggingEnabledFromStorageResult({
        [MATCH_LOGGING_ENABLED_KEY]: undefined,
      }),
    ).toBe(true);
  });
});
