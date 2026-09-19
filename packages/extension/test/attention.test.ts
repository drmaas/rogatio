import { describe, expect, it } from "vitest";
import { attentionFromRuleStatuses } from "../src/attention.js";

const REACTIVATE_OR_RESTART =
  "Re-activate the group, or restart the native runtime";
const RELOAD_EXTENSION = "reload the extension";

describe("P3b attentionFromRuleStatuses", () => {
  it("does not primary-push re-activate/restart for install-error class", () => {
    const attention = attentionFromRuleStatuses({
      attention: true,
      statuses: [
        {
          status: "error",
          diagnostics: [
            {
              code: "core.rule-not-installed",
              message:
                "The rule is enabled with granted site access but is not installed.",
            },
          ],
        },
      ],
    });
    expect(attention).toEqual({
      blocking: "rules failed to install: see the rule error",
      explanation: "some rules failed to install.",
      fix: "Click the error status for the failed rule.",
    });
    expect(JSON.stringify(attention)).not.toContain(REACTIVATE_OR_RESTART);
    expect(JSON.stringify(attention).toLowerCase()).not.toContain(
      RELOAD_EXTENSION,
    );
  });

  it("does not primary-push re-activate/restart for extension.dnr-error", () => {
    const attention = attentionFromRuleStatuses({
      attention: true,
      statuses: [
        {
          status: "error",
          diagnostics: [
            {
              code: "extension.dnr-error",
              params: { reason: "Rule with id 1: invalid regexFilter" },
            },
          ],
        },
      ],
    });
    expect(attention).toEqual({
      blocking: "rules failed to install: see the rule error",
      explanation: "some rules failed to install.",
      fix: "Click the error status for the failed rule.",
    });
    expect(JSON.stringify(attention)).not.toContain(REACTIVATE_OR_RESTART);
    expect(JSON.stringify(attention).toLowerCase()).not.toContain(
      RELOAD_EXTENSION,
    );
  });

  it("still explains needs permission with grant guidance", () => {
    const attention = attentionFromRuleStatuses({
      attention: true,
      statuses: [{ status: "needs permission" }],
    });
    expect(attention).toEqual({
      blocking: "needs permission: grant declared access",
      explanation: "some rules need permission.",
      fix: "Click 'Grant declared access' after reviewing origins.",
    });
  });

  it("returns null when badge attention is false", () => {
    expect(
      attentionFromRuleStatuses({
        attention: false,
        statuses: [{ status: "error" }],
      }),
    ).toBeNull();
  });
});
