import type { RedirectOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { translateRedirectToDnr } from "../src/dnr.js";

function operation(destination: string): RedirectOperation {
  return {
    kind: "redirect",
    groupId: "group",
    ruleId: "rule",
    name: "Redirect",
    redactSensitiveInLogs: false,
    matcher: {
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/(.*)$",
      },
      resourceTypes: ["main_frame"],
      priority: 1,
    },
    redirect: { destination },
  };
}

describe("DNR URL capture projection", () => {
  it("normalizes canonical $N captures to Chrome backreferences", () => {
    expect(
      translateRedirectToDnr(operation("https://new.example/$1/$$5"), 1).action
        .redirect.url,
    ).toBe("https://new.example/\\1/$5");
  });

  it("preserves legacy Chrome backreferences", () => {
    expect(
      translateRedirectToDnr(operation("https://new.example/\\1"), 1).action
        .redirect.url,
    ).toBe("https://new.example/\\1");
  });
});
