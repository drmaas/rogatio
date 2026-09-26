/**
 * Live AI journeys in the real extension (opt-in, real provider usage).
 *
 * AI_LIVE=1 runs the three AI features end to end in Chrome against the
 * provider configured by `rogatio ai setup` (the native host reads the
 * platform config file):
 *   1. Dashboard "Create using AI" creates and saves a project.
 *   2. Workspace AI Assist generates a new rule that saves cleanly and works.
 *   3. Workspace AI Assist fixes a deliberately broken rule in place; after
 *      Apply + Save the project validates and the fixed redirect works live.
 *
 * Prerequisites (the run fails with the exact fix command otherwise):
 *   - `rogatio ai setup` has configured a provider (`rogatio ai test` helps)
 *   - the native-messaging host is installed for this extension build:
 *     `sudo rogatio runtime install --extension-id <id>` (the suite attempts
 *     the install itself only when passwordless sudo is available). The
 *     registered manifest is mirrored into the test profile because Chrome
 *     for Testing resolves user-level hosts under its own profile directory.
 *
 * Every journey calls the live provider, so expect latency and LLM-shaped
 * variance; prompts pin exact rule payloads and assertions stay structural
 * plus behavioral checks against a local validate server. Model-facing URLs
 * use `localhost`, never IP literals: this OpenRouter account's guardrail
 * masks IP addresses in completions ("127.0.0.1" comes back as
 * "[IP_ADDRESS]"), which fails project validation downstream. Failed
 * requests are retried a bounded number of times to absorb model variance.
 */
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { it, expect as vitestExpect } from "vitest";
import {
  extensionContext,
  seedNativeHostManifest,
} from "./extension-context.js";
import { expect, testStandalone } from "./fixtures.js";
import type { Locator, Page } from "./page.js";
import {
  extensionSend,
  getExtensionState,
  importAndEnableSample,
  loadShippedSample,
  type RogatioProject,
  SAMPLE_GROUP_ID,
  spawnRuntimeInstall,
  startValidateServer,
  waitForChild,
  withNewTab,
} from "./sample-basic-helpers.js";

const AI_LIVE = process.env.AI_LIVE === "1";
const SUDO_OK =
  spawnSync("sudo", ["-n", "true"], { encoding: "utf8" }).status === 0;
/** Live provider round-trips are slow; keep waits generous but bounded. */
const AI_WAIT_MS = 120_000;
/**
 * Validate-server origin used in model-facing prompts. `localhost` passes the
 * provider's output guardrail unmasked and still reaches the local server.
 */
const AI_ORIGIN = "http://localhost:8080";
/** Live model variance: retry a failed request before failing the journey. */
const AI_ATTEMPTS = 3;

type StartResult = {
  ok?: boolean;
  diagnostic?: { code?: string };
  value?: unknown;
};

function totalRules(project: RogatioProject): number {
  return project.groups.reduce(
    (sum, group) => sum + (group.rules?.length ?? 0),
    0,
  );
}

/**
 * Rewrite the shipped sample's example.com URLs (origins, destinations, and
 * regex hosts) to the localhost validate origin for model-facing prompts.
 * Works on rule fields directly: JSON text would escape the regex dots.
 */
function withLocalhostOrigin(project: RogatioProject): RogatioProject {
  const clone = structuredClone(project);
  for (const group of clone.groups) {
    for (const rule of group.rules) {
      rule.source.value = rule.source.value
        .split("https://example\\.com")
        .join(AI_ORIGIN);
      if (typeof rule.redirect === "object" && rule.redirect !== null) {
        const redirect = rule.redirect as { destination?: string };
        if (typeof redirect.destination === "string") {
          redirect.destination = redirect.destination.replaceAll(
            "https://example.com",
            AI_ORIGIN,
          );
        }
      }
    }
  }
  return clone;
}

async function aiProviderConfigured(): Promise<boolean> {
  const cli = resolve(process.cwd(), "packages/cli/dist/node/index.js");
  const child = spawn(process.execPath, [cli, "ai", "ls"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { code, output } = await waitForChild(child, 30_000);
  return code === 0 && output.includes("Provider:");
}

/** Start the native runtime, installing the native host when needed. */
async function ensureRuntimeStarted(
  page: Page,
  extensionId: string,
  profile: string,
): Promise<void> {
  await seedNativeHostManifest(profile, [extensionId]);
  const start = () =>
    extensionSend<StartResult>(page, {
      version: 1,
      command: "start-native-runtime",
    });
  let result = await start();
  if (result?.ok !== true && SUDO_OK) {
    const install = spawnRuntimeInstall(extensionId);
    const { code: installCode, output: installOut } = await waitForChild(
      install,
      45_000,
    );
    if (installCode !== 0) {
      throw new Error(`runtime install failed: ${installOut}`);
    }
    result = await start();
  }
  if (result?.ok !== true) {
    throw new Error(
      `start-native-runtime failed: ${JSON.stringify(result)}. ` +
        `If the native host is missing or stale, run: sudo rogatio runtime install --extension-id ${extensionId}`,
    );
  }
  const state = await getExtensionState(page);
  vitestExpect(state.nativeRuntimeState?.phase).toBe("started");
}

/** Load the management page and wait until the AI surfaces are enabled. */
async function openWithAISupport(
  page: Page,
  extensionId: string,
  profile: string,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await ensureRuntimeStarted(page, extensionId, profile);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  // The extensionSend start bypasses the UI flow's trailing refresh, so
  // refresh the shell to make the AI status chip reflect the started runtime.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const status = page.locator("[data-ai-status]");
  await waitForOrFail(
    "AI-ready status",
    () => status.textContent(),
    async () => (await status.textContent()) === "AI: Ready",
  );
}

async function waitForOrFail(
  label: string,
  context: () => Promise<string>,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + AI_WAIT_MS;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${label} not reached within ${AI_WAIT_MS}ms; surface said: ${await context()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function startAI(): Promise<void> {
  const configured = await aiProviderConfigured();
  if (!configured) {
    throw new Error(
      "no AI provider configured — run 'rogatio ai setup' first, then re-run with AI_LIVE=1",
    );
  }
}

/**
 * Poll the persisted project until `accept` holds. Save is asynchronous and
 * the extension remounts the editor afterwards, so the transient "Saved"
 * editor status is not reliably observable; the persisted state is.
 */
async function waitForPersisted(
  page: Page,
  label: string,
  accept: (stored: RogatioProject | undefined) => boolean,
): Promise<void> {
  await waitForOrFail(
    label,
    async () => {
      const state = await getExtensionState(page);
      return String(state.projects[state.activeProjectId ?? ""]?.data?.name);
    },
    async () => {
      const state = await getExtensionState(page);
      return accept(state.projects[state.activeProjectId ?? ""]?.data);
    },
  );
}

/**
 * Re-activate the sample group after a save. Product behavior resets group
 * enablement on every save (see docs/architecture.md), so the journeys mirror
 * the real user flow of toggling the group back on before browsing.
 */
async function enableSampleGroup(page: Page): Promise<void> {
  const state = await getExtensionState(page);
  const enabled = await extensionSend<{ ok: boolean }>(page, {
    version: 1,
    command: "set-group-enabled",
    projectId: state.activeProjectId ?? "",
    groupId: SAMPLE_GROUP_ID,
    enabled: true,
  });
  vitestExpect(enabled?.ok, "set-group-enabled after save").toBe(true);
}

/**
 * Submit the Dashboard create prompt until a preview appears, retrying on the
 * terminal "could not generate" message (live model variance).
 */
async function generateWithRetry(page: Page, prompt: string): Promise<void> {
  const preview = page.locator(".rogatio-ai-preview");
  const composer = page.locator(".rogatio-ai-composer");
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    await page.locator("#rogatio-ai-prompt").fill(prompt);
    await page.locator('[data-ai-form] button[type="submit"]').click();
    const deadline = Date.now() + AI_WAIT_MS;
    for (;;) {
      if ((await preview.count()) > 0) return;
      const text = (await composer.textContent()) ?? "";
      if (text.includes("AI could not generate")) break;
      if (Date.now() > deadline) {
        throw new Error(
          `generated project preview not reached within ${AI_WAIT_MS}ms; surface said: ${text}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(
    `generated project preview not produced after ${AI_ATTEMPTS} attempts; surface said: ${await composer.textContent()}`,
  );
}

/**
 * Submit an AI Assist prompt until a proposal with Apply buttons appears,
 * retrying on terminal assistant errors (live model variance).
 */
async function sendAssistWithRetry(
  panel: Locator,
  prompt: string,
  label: string,
): Promise<void> {
  const applyButtons = panel.getByRole("button", { name: "Apply Rule" });
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    const before = (await panel.textContent()) ?? "";
    await panel.locator("textarea").fill(prompt);
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    const deadline = Date.now() + AI_WAIT_MS;
    for (;;) {
      if ((await applyButtons.count()) > 0) return;
      const current = (await panel.textContent()) ?? "";
      const added = current.slice(before.length);
      if (/AI Assist failed|returned no proposal/.test(added)) break;
      if (Date.now() > deadline) {
        throw new Error(
          `${label} not reached within ${AI_WAIT_MS}ms; surface said: ${current}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(
    `${label} not produced after ${AI_ATTEMPTS} attempts; surface said: ${await panel.textContent()}`,
  );
}

if (AI_LIVE) {
  testStandalone(
    "AI live: Dashboard create-project generates and saves a project (AC-005)",
    async ({ registerDriver }) => {
      await startAI();
      const { driver, page, extensionId, profile, close } =
        await extensionContext();
      registerDriver(driver, close);
      try {
        await openWithAISupport(page, extensionId, profile);
        await page
          .getByRole("button", { name: "Dashboard", exact: true })
          .click();

        const aiCard = page.locator('[data-command="ai-generate"]');
        await expect(aiCard).toBeEnabled();
        await aiCard.click();

        await generateWithRetry(
          page,
          "Return a Rogatio version-1 project as exactly one JSON object " +
            "with keys: version (number, 1), name (string), groups (array). " +
            "Each group: id (string), name (string), origins (array of origin " +
            "strings), rules (array). Each rule: id (string), name (string), " +
            "urlRegex (string), origins (array), resourceTypes (array; use " +
            'exactly ["main_frame"]), priority (number), type "redirect", and ' +
            "redirect (object with key destination, a string). No other keys " +
            'anywhere. Create a project named "Live AI demo" with one group ' +
            'with id "demo-group" and name "demo" whose origins are ' +
            '["http://localhost:8080"] containing exactly one redirect rule ' +
            'with id "demo-rule" that matches "^http://localhost:8080/old/" ' +
            'and redirects to "http://localhost:8080/new/".',
        );

        const preview = page.locator(".rogatio-ai-preview");
        const summary = (await preview.textContent()).replace(/\s+/g, " ");
        const counts = /(\d+)\s+groups?,\s+(\d+)\s+rules?/.exec(summary);
        vitestExpect(counts, `preview summary: ${summary}`).toBeTruthy();
        vitestExpect(Number(counts?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
        vitestExpect(Number(counts?.[2] ?? 0)).toBeGreaterThanOrEqual(1);

        await page.locator('[data-command="ai-create"]').click();
        await expect(page.locator(".rogatio-status")).toHaveText(
          "AI project created.",
        );

        const state = await getExtensionState(page);
        const saved = Object.values(state.projects);
        vitestExpect(saved).toHaveLength(1);
        vitestExpect(
          saved[0] ? totalRules(saved[0].data) : 0,
          "saved project rule count",
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    },
    300_000,
  );

  testStandalone(
    "AI live: Workspace AI Assist adds a new rule that saves and works (AC-006)",
    async ({ registerDriver }) => {
      await startAI();
      const server = await startValidateServer();
      const { driver, page, extensionId, profile, close } =
        await extensionContext({});
      registerDriver(driver, close);
      try {
        await page.goto(`chrome-extension://${extensionId}/index.html`);
        await expect(
          page.getByRole("heading", { name: "Rogatio" }),
        ).toBeVisible();

        const project = withLocalhostOrigin(await loadShippedSample());
        const before = totalRules(project);
        await importAndEnableSample(page, project);
        await openWithAISupport(page, extensionId, profile);

        await page
          .getByRole("button", { name: "AI Assist", exact: true })
          .click();
        const panel = page.locator(".ai-assist-panel");
        await sendAssistWithRetry(
          panel,
          'Add exactly one new rule to group "grp-sample". Return exactly ' +
            'this JSON shape: {"rules":[{"groupId":"grp-sample","kind":"redirect",' +
            '"name":"AI added redirect","urlRegex":"^http://localhost:8080/ai-added$",' +
            '"origins":[],"resourceTypes":["main_frame"],"priority":100,' +
            '"action":{"destination":"http://localhost:8080/new/"}}],' +
            '"explanation":"..."}. Every rule must include groupId. ' +
            "Change nothing else and add no other rules.",
          "AI Assist proposal",
        );

        const applyButtons = panel.getByRole("button", { name: "Apply Rule" });
        const applyCount = await applyButtons.count();
        await applyButtons.first().click();
        await expect(page.locator("[data-editor-status]")).toContainText(
          "Applied",
        );

        await page.getByRole("button", { name: "Save", exact: true }).click();
        await waitForPersisted(
          page,
          "saved project rule count",
          (stored) =>
            stored !== undefined && totalRules(stored) === before + applyCount,
        );

        const state = await getExtensionState(page);
        vitestExpect(state.activeProjectId).toBeTruthy();
        const stored = state.projects[state.activeProjectId ?? ""];
        vitestExpect(stored).toBeTruthy();
        vitestExpect(
          stored ? totalRules(stored.data) : 0,
          "rule count after AI add",
        ).toBe(before + applyCount);

        await enableSampleGroup(page);

        // The AI-added redirect works live in the browser.
        await withNewTab(driver, async (tab) => {
          await tab.goto(`${AI_ORIGIN}/ai-added`);
          vitestExpect(await driver.getCurrentUrl()).toBe(`${AI_ORIGIN}/new/`);
        });
      } finally {
        await server.close();
      }
    },
    300_000,
  );

  testStandalone(
    "AI live: Workspace AI Assist fixes a broken rule in place (AC-007)",
    async ({ registerDriver }) => {
      await startAI();
      const server = await startValidateServer();
      const { driver, page, extensionId, profile, close } =
        await extensionContext({});
      registerDriver(driver, close);
      try {
        await page.goto(`chrome-extension://${extensionId}/index.html`);
        await expect(
          page.getByRole("heading", { name: "Rogatio" }),
        ).toBeVisible();

        const project = withLocalhostOrigin(await loadShippedSample());
        const ruleCount = totalRules(project);
        const redirectRule = project.groups[0]?.rules[0];
        vitestExpect(redirectRule?.id).toBe("rule-redirect");
        await importAndEnableSample(page, project);
        await openWithAISupport(page, extensionId, profile);
        // The editor renders rule cards per route; open the sample group first.
        await page
          .locator("[data-desktop-route-rail]")
          .getByRole("button", {
            name: project.groups[0]?.name ?? "Unnamed group",
            exact: true,
          })
          .click();

        // Break the committed rule in the draft and surface the diagnostics.
        const ruleCard = page.locator(
          '[data-rule-card][data-rule-id="rule-redirect"]',
        );
        const urlRegexField = ruleCard.getByLabel("URL regular expression", {
          exact: true,
        });
        await urlRegexField.fill("([");
        await page
          .getByRole("button", { name: "Validate", exact: true })
          .click();
        await expect(urlRegexField).toHaveAttribute("aria-invalid", "true");

        await page
          .getByRole("button", { name: "AI Assist", exact: true })
          .click();
        const panel = page.locator(".ai-assist-panel");
        await sendAssistWithRetry(
          panel,
          'The rule "rule-redirect" in group "grp-sample" has an invalid ' +
            'urlRegex "([" and must be repaired. Return exactly one corrected ' +
            'rule for group "grp-sample", including its groupId, kind ' +
            '"redirect", name ' +
            `${JSON.stringify(redirectRule?.name ?? "Redirect to docs")}, ` +
            `urlRegex ${JSON.stringify(redirectRule?.urlRegex ?? "")}, ` +
            'origins [], resourceTypes ["main_frame"], priority 100, ' +
            `action ${JSON.stringify(redirectRule?.redirect ?? {})}. ` +
            "Fix only this rule and change nothing else.",
          "AI Assist fix proposal",
        );

        const applyButtons = panel.getByRole("button", { name: "Apply Rule" });
        await applyButtons.first().click();
        await expect(page.locator("[data-editor-status]")).toContainText(
          "Applied",
        );

        await page.getByRole("button", { name: "Save", exact: true }).click();
        await waitForPersisted(
          page,
          "repaired rule persisted",
          (stored) =>
            stored !== undefined &&
            stored.groups[0]?.rules[0]?.urlRegex !== "([",
        );

        // The offending rule is repaired in place: same id, valid regex.
        const state = await getExtensionState(page);
        const stored = state.projects[state.activeProjectId ?? ""];
        vitestExpect(stored).toBeTruthy();
        vitestExpect(
          stored ? totalRules(stored.data) : -1,
          "fix must not add or drop rules",
        ).toBe(ruleCount);
        const repaired = stored?.data.groups[0]?.rules[0];
        vitestExpect(repaired?.id).toBe("rule-redirect");
        vitestExpect(repaired?.urlRegex).not.toBe("([");
        const compiled = await page.evaluate(
          (value) => {
            try {
              return new RegExp(value) instanceof RegExp;
            } catch {
              return false;
            }
          },
          String(repaired?.urlRegex ?? ""),
        );
        vitestExpect(compiled, `repaired regex: ${repaired?.urlRegex}`).toBe(
          true,
        );

        await enableSampleGroup(page);

        // The repaired redirect works live in the browser.
        await withNewTab(driver, async (tab) => {
          await tab.goto(`${AI_ORIGIN}/old/anything`);
          vitestExpect(await driver.getCurrentUrl()).toBe(`${AI_ORIGIN}/new/`);
        });
      } finally {
        await server.close();
      }
    },
    300_000,
  );
} else {
  it.skip("AI live: Dashboard create-project generates and saves a project", () => {
    //
  });
  it.skip("AI live: Workspace AI Assist adds a new rule that saves and works", () => {
    //
  });
  it.skip("AI live: Workspace AI Assist fixes a broken rule in place", () => {
    //
  });
}
