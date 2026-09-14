import { rm } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { extensionContext } from "./extension-context.js";

type ProbeKind = "rule-header-set" | "rule-header-remove";

type ProbeOutcome = {
  rule: ProbeKind;
  accepted: boolean;
  message: string | null;
};

// Corrected rule literals mirror what `toDnrRule` emits after Phase 2: only the
// direction-matching header list is present, and condition keys with no value are
// omitted rather than set to `undefined`.
async function probeUpdateDynamicRules(
  page: Page,
  id: number,
  kind: ProbeKind,
): Promise<ProbeOutcome> {
  return page.evaluate(
    async ({ ruleId, ruleKind }) => {
      const dnr = chrome.declarativeNetRequest;
      if (!dnr) {
        throw new Error("chrome.declarativeNetRequest is unavailable");
      }
      const addRule =
        ruleKind === "rule-header-set"
          ? {
              id: ruleId,
              priority: 300,
              action: {
                type: "modifyHeaders",
                requestHeaders: [
                  {
                    header: "X-Rogatio-Sample",
                    operation: "set",
                    value: "enabled",
                  },
                ],
              },
              condition: {
                regexFilter: "^https://example\\.com/api/",
                resourceTypes: ["xmlhttprequest"],
                initiatorDomains: ["example.com"],
                requestMethods: ["get"],
              },
            }
          : {
              id: ruleId,
              priority: 310,
              action: {
                type: "modifyHeaders",
                responseHeaders: [
                  { header: "X-Test-Header", operation: "remove" },
                ],
              },
              condition: {
                regexFilter: "^https://example\\.com/api/",
                resourceTypes: ["main_frame"],
                initiatorDomains: ["example.com"],
              },
            };

      try {
        await dnr.updateDynamicRules({
          addRules: [addRule],
          removeRuleIds: [],
        });
        return {
          rule: ruleKind,
          accepted: true,
          message: null,
        };
      } catch (error) {
        return {
          rule: ruleKind,
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { ruleId: id, ruleKind: kind },
  );
}

async function removeProbeRule(page: Page, id: number): Promise<void> {
  await page.evaluate(async (ruleId) => {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr) {
      return;
    }
    try {
      await dnr.updateDynamicRules({
        addRules: [],
        removeRuleIds: [ruleId],
      });
    } catch {
      // Best-effort cleanup; probe rules must not leak across reruns.
    }
  }, id);
}

test("real Chromium accepts corrected toDnrRule sample header shapes", async () => {
  const testInfo = test.info();
  const baseId = 9_000_000 + testInfo.parallelIndex * 100;
  const setRuleId = baseId + 1;
  const removeRuleId = baseId + 2;
  const { context, profile, extensionId } = await extensionContext();
  const outcomes: ProbeOutcome[] = [];

  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();

    for (const [kind, ruleId] of [
      ["rule-header-set", setRuleId],
      ["rule-header-remove", removeRuleId],
    ] as const) {
      try {
        outcomes.push(await probeUpdateDynamicRules(page, ruleId, kind));
      } finally {
        await removeProbeRule(page, ruleId);
      }
    }

    expect(outcomes).toEqual([
      { rule: "rule-header-set", accepted: true, message: null },
      { rule: "rule-header-remove", accepted: true, message: null },
    ]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
