import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";

async function extensionContext() {
  const profile = await mkdtemp(join(tmpdir(), "rogatio-browser-"));
  const extensionPath = join(process.cwd(), "packages/extension/dist");
  const digest = createHash("sha256").update(extensionPath).digest();
  let extensionId = "";
  for (let i = 0; i < 16; i += 1) {
    extensionId += String.fromCharCode(97 + (digest[i] >> 4));
    extensionId += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  return { context, profile, extensionId };
}

type ProbeKind = "rule-header-set" | "rule-header-remove";

type ProbeOutcome = {
  rule: ProbeKind;
  accepted: boolean;
  message: string | null;
};

// The rule literals below mirror what `toDnrRule` currently emits for the
// `rule-header-set` and `rule-header-remove` rules of `samples/basic/.rogatio.json`,
// including `initiatorDomains` derived from the group origin and the `condition`
// keys emitted as present-with-`undefined`.
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
                responseHeaders: [],
              },
              condition: {
                regexFilter: "^https://example\\.com/api/",
                resourceTypes: ["xmlhttprequest"],
                initiatorDomains: ["example.com"],
                excludedInitiatorDomains: undefined,
                requestMethods: ["get"],
              },
            }
          : {
              id: ruleId,
              priority: 310,
              action: {
                type: "modifyHeaders",
                requestHeaders: [],
                responseHeaders: [
                  { header: "X-Test-Header", operation: "remove" },
                ],
              },
              condition: {
                regexFilter: "^https://example\\.com/api/",
                resourceTypes: ["main_frame"],
                initiatorDomains: ["example.com"],
                excludedInitiatorDomains: undefined,
                requestMethods: undefined,
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

test("records accept/reject for current toDnrRule sample header shapes", async () => {
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

    // Evidence only: the accept/reject outcome is recorded, never asserted, so
    // this spec never depends on Chrome's wording.
    expect(outcomes.map((outcome) => outcome.rule)).toEqual([
      "rule-header-set",
      "rule-header-remove",
    ]);

    testInfo.annotations.push({
      type: "header-dnr-probe",
      description: JSON.stringify(outcomes),
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
