import type { MockOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { previewRuleAction } from "../src/preview.js";

function mockOperation(mock: MockOperation["mock"]): MockOperation {
  return {
    kind: "mock",
    groupId: "group-mock",
    ruleId: "rule-mock",
    name: "Mock",
    redactSensitiveInLogs: false,
    matcher: {
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame"],
      priority: 1,
    },
    mock,
  };
}

describe("mock preview contract", () => {
  it("pins inline, file, header, and delay summaries", () => {
    expect(
      previewRuleAction(
        mockOperation({ status: 201, body: "ok" }),
        "https://example.com/",
      ),
    ).toEqual({ kind: "mock", summary: "Mock 201 (inline body)" });
    expect(
      previewRuleAction(
        mockOperation({
          status: 200,
          file: "payload.bin",
          headers: [
            { name: "Content-Type", value: "text/plain" },
            { name: "X-Test", value: "1" },
          ],
          delayMs: 0,
        }),
        "https://example.com/",
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (file-backed body, 2 headers, 0 ms delay)",
    });
  });
});
