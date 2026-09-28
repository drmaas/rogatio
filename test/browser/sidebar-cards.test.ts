/**
 * Sidebar card layout and rule deep links for the management page.
 *
 * Covers the acceptance checks for issue #242: the runtime, AI, and rules
 * cards, the inert project card, and rule entries that are real deep links.
 */
import { expect, test } from "./fixtures.js";

type MockProject = {
  id: string;
  name: string;
  revision: number;
  enabledGroupIds: string[];
  data: Record<string, unknown>;
};

type MockEnvelope = {
  version: number;
  projects: Record<string, MockProject>;
  activeProjectId: string | null;
  ruleStatuses?: Array<{
    groupId: string;
    ruleId: string;
    status: string;
    diagnostics?: Array<Record<string, unknown>>;
  }>;
  nativeRuntimeState?: { phase: string };
  nativeRuntimeError?: string;
  aiCheck?: AiCheck;
};

/** The service worker's check-ai-support answer (issue #241 response shape). */
type AiCheck = {
  supported: boolean;
  reported: boolean;
  providerUrl?: string;
  model?: string;
  /**
   * Simulates a leaky transport. The real host never sends the key; the page
   * must never render it even if it arrives (AC-008).
   */
  apiKey?: string;
};

const sidebarProject: MockProject = {
  id: "project-sidebar",
  name: "Sidebar Project",
  revision: 1,
  enabledGroupIds: ["group-one"],
  // Version 2 shape: groups carry only id/name/rules, and every rule carries a
  // source condition. A v1-shaped rule inside a v2 envelope is rejected by the
  // editor and no rule card ever renders.
  data: {
    version: 2,
    name: "Sidebar Project",
    groups: [
      {
        id: "group-one",
        name: "One",
        rules: [
          {
            id: "rule-one",
            name: "First rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://one\\.example/first$",
            },
            resourceTypes: ["main_frame"],
            priority: 100,
          },
        ],
      },
      {
        id: "group-two",
        name: "Two",
        rules: [
          {
            id: "rule-two",
            name: "Second rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://two\\.example/second$",
            },
            resourceTypes: ["main_frame"],
            priority: 100,
          },
        ],
      },
    ],
  },
};

function sidebarEnvelope(overrides: Partial<MockEnvelope> = {}): MockEnvelope {
  return {
    version: 1,
    projects: { [sidebarProject.id]: sidebarProject },
    activeProjectId: sidebarProject.id,
    ruleStatuses: [
      { groupId: "group-one", ruleId: "rule-one", status: "active" },
      { groupId: "group-two", ruleId: "rule-two", status: "needs runtime" },
    ],
    ...overrides,
  };
}

/**
 * Serialized by addInitScript, so it must not close over module bindings.
 */
function installChromeMock(seed: MockEnvelope): void {
  const state = seed;
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: { get: async () => ({ rogatio: state }), set: async () => {} },
      },
      permissions: {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: {
        lastError: undefined,
        sendMessage(
          message: {
            command?: string;
            projectId?: string;
            groupId?: string;
            enabled?: boolean;
          },
          callback: (value: unknown) => void,
        ) {
          if (message.command === "set-group-enabled") {
            const project = state.projects[message.projectId ?? ""];
            if (project && message.groupId) {
              const enabled = new Set(project.enabledGroupIds ?? []);
              if (message.enabled === false) enabled.delete(message.groupId);
              else enabled.add(message.groupId);
              project.enabledGroupIds = [...enabled];
            }
          }
          if (
            message.command === "switch-project" ||
            message.command === "set-active-project"
          ) {
            const next = message.projectId;
            if (next && state.projects[next]) state.activeProjectId = next;
          }
          if (message.command === "check-ai-support") {
            callback({
              ok: true,
              value: state.aiCheck ?? { supported: false, reported: false },
            });
            return;
          }
          callback({ ok: true, value: state });
        },
        onMessage: { addListener() {} },
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    },
  });
}

async function openWorkspace(page: import("./page.js").Page) {
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
}

/**
 * Cards are addressed by their `data-card` hook rather than by heading text:
 * the heading is uppercased by CSS, and `filter({ hasText })` matches rendered
 * text.
 */
function sidebarCard(page: import("./page.js").Page, name: string) {
  return page.locator(`.rogatio-sidebar-card[data-card="${name}"]`);
}
test("sidebar renders runtime, AI, and rules cards in order", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  const order = await page.evaluate(() => {
    const headings = [...document.querySelectorAll(".rogatio-sidebar-card")]
      .map((node) => node.querySelector(".rogatio-sidebar-card-heading"))
      .filter((node): node is Element => node !== null)
      .map((node) => node.textContent);
    const project = document.querySelector("[data-active-project-card]");
    const runtime = document.querySelector('[data-card="runtime"]');
    const ai = document.querySelector('[data-card="ai"]');
    const rules = document.querySelector('[data-card="rules"]');
    if (!project || !runtime || !ai || !rules) return null;
    return {
      headings,
      // Group enablement moved to the open group heading, so the sidebar must
      // not reintroduce a group switcher.
      activationFieldsets: document.querySelectorAll("[data-group-activation]")
        .length,
      runtimeFollowsProject:
        (project.compareDocumentPosition(runtime) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
      aiFollowsRuntime:
        (runtime.compareDocumentPosition(ai) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
      rulesFollowsAi:
        (ai.compareDocumentPosition(rules) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    };
  });

  expect(order).toEqual({
    headings: ["Runtime", "AI", "Rules"],
    activationFieldsets: 0,
    runtimeFollowsProject: true,
    aiFollowsRuntime: true,
    rulesFollowsAi: true,
  });
});

test("runtime card holds the session controls, status, and extension ID", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({ nativeRuntimeState: { phase: "started" } }),
  );
  await openWorkspace(page);

  const runtime = sidebarCard(page, "runtime");
  await expect(
    runtime.locator('[data-command="start-native-runtime"]'),
  ).toHaveCount(1);
  await expect(
    runtime.locator('[data-command="stop-native-runtime"]'),
  ).toHaveCount(1);
  await expect(runtime.locator("[data-native-runtime-state]")).toHaveCount(1);
  await expect(runtime.locator("[data-extension-id]")).toHaveCount(1);
  await expect(
    runtime.locator('[data-command="copy-extension-id"]'),
  ).toHaveCount(1);
  await expect(
    runtime.locator('[data-command="show-diagnostics"]'),
  ).toHaveCount(0);
});

test("runtime card surfaces diagnostics and the error when the host failed", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      nativeRuntimeState: { phase: "failed" },
      nativeRuntimeError: "Native host has exited.",
    }),
  );
  await openWorkspace(page);

  const runtime = sidebarCard(page, "runtime");
  await expect(
    runtime.locator('[data-command="show-diagnostics"]'),
  ).toHaveCount(1);
  await expect(runtime.locator("[data-runtime-error]")).toContainText(
    "Native host has exited.",
  );
});

test("AI card shows the reported provider and model (AC-007)", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      nativeRuntimeState: { phase: "started" },
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
        apiKey: "sk-mock-secret-123",
      },
    }),
  );
  await openWorkspace(page);

  const ai = sidebarCard(page, "ai");
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: Configured");
  await expect(ai.locator("[data-ai-provider]")).toHaveText(
    "Provider: https://api.example.com/v1",
  );
  await expect(ai.locator("[data-ai-model]")).toHaveText(
    "Model: example-model-1",
  );
  // AC-008: even a leaky transport cannot put the key in the DOM.
  await expect(page.locator("body")).not.toContainText("sk-mock-secret-123");
});

test("AI card shows Not configured without provider lines (AC-007)", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      nativeRuntimeState: { phase: "started" },
      aiCheck: { supported: false, reported: true },
    }),
  );
  await openWorkspace(page);

  const ai = sidebarCard(page, "ai");
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: Not configured");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(ai.locator("[data-ai-model]")).toHaveCount(0);
});

test("AI card degrades to not reported, not an error state (AC-005)", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      nativeRuntimeState: { phase: "started" },
      aiCheck: { supported: false, reported: false },
    }),
  );
  await openWorkspace(page);

  const ai = sidebarCard(page, "ai");
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: not reported");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(ai.locator("[data-ai-model]")).toHaveCount(0);
  // Not an error state: the sidebar keeps its other cards and shows no error.
  await expect(sidebarCard(page, "rules")).toBeVisible();
  await expect(page.locator("[data-runtime-error]")).toHaveCount(0);
});

test("AI card keeps needs runtime precedence over reported metadata (AC-010)", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
      },
    }),
  );
  await openWorkspace(page);

  const ai = sidebarCard(page, "ai");
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: needs runtime");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
});

test("rules card holds one link per rule plus the Match logging switch", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  const rules = sidebarCard(page, "rules");
  const links = rules.locator("[data-rule-link]");
  await expect(links).toHaveCount(2);
  await expect(
    rules.getByRole("checkbox", { name: "Match logging" }),
  ).toHaveCount(1);

  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('[data-card="rules"] .rogatio-rule-row')].map(
      (row) => {
        const link = row.querySelector("[data-rule-link]");
        return {
          tag: link?.tagName ?? null,
          href: link?.getAttribute("href") ?? null,
          status:
            row.querySelector("[data-rule-status]")?.textContent?.trim() ??
            null,
        };
      },
    ),
  );
  expect(entries).toEqual([
    { tag: "A", href: "?group=group-one&rule=rule-one", status: "active" },
    {
      tag: "A",
      href: "?group=group-two&rule=rule-two",
      status: "needs runtime",
    },
  ]);
});

test("rule link navigates to the rule and the URL reflects it", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
  const url = await page.url();
  expect(url).toContain("group=group-two");
  expect(url).toContain("rule=rule-two");
});

test("browser Back returns from a rule to the previous group", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
  await page.goBack();
  expect(await page.url()).not.toContain("rule=rule-two");
});

test("a deep link opens the workspace directly on the rule", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await page.goto("/extension/index.html?group=group-two&rule=rule-two");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
});

test("rule navigation keeps unsaved editor work", async ({ page }) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  await page.locator('[data-rule-link][data-rule-id="rule-one"]').click();
  const nameField = page
    .locator('[data-rule-card][data-rule-id="rule-one"]')
    .getByLabel("Rule name", { exact: true });
  await nameField.fill("Unsaved draft name");
  await expect(page.locator("[data-dirty-state]")).toHaveText(
    "Unsaved changes",
  );

  // Navigating by rule link must not remount the editor.
  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
  await page.locator('[data-rule-link][data-rule-id="rule-one"]').click();
  await expect(
    page
      .locator('[data-rule-card][data-rule-id="rule-one"]')
      .getByLabel("Rule name", { exact: true }),
  ).toHaveValue("Unsaved draft name");
  await expect(page.locator("[data-dirty-state]")).toHaveText(
    "Unsaved changes",
  );
});

test("a rule that is no longer in the draft still links, and lands on its group", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      ruleStatuses: [
        { groupId: "group-one", ruleId: "rule-one", status: "active" },
        { groupId: "group-two", ruleId: "rule-gone", status: "active" },
      ],
    }),
  );
  await openWorkspace(page);

  // The status projection can outlive a rule. The link stays a real link —
  // refusing to navigate would also hide the install reason for an errored rule.
  const orphan = page.locator('[data-rule-link][data-rule-id="rule-gone"]');
  await expect(orphan).toHaveAttribute(
    "href",
    "?group=group-two&rule=rule-gone",
  );
  await orphan.click();
  // The owning group is a real destination even though the rule is gone.
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
});

test("every rule link names its status for assistive technology", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  const described = await page.evaluate(() =>
    [...document.querySelectorAll("[data-rule-link]")].map((link) => {
      const id = link.getAttribute("aria-describedby");
      const status = id ? document.getElementById(id) : null;
      return {
        described: id !== null,
        text: status?.textContent ?? null,
        visible: status?.getAttribute("data-rule-status") === "true",
      };
    }),
  );
  expect(described).toEqual([
    { described: true, text: "active", visible: true },
    { described: true, text: "needs runtime", visible: true },
  ]);
});

test("a rule that fails still selects it and shows the error card", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      ruleStatuses: [
        {
          groupId: "group-one",
          ruleId: "rule-one",
          status: "error",
          diagnostics: [
            {
              code: "extension.dnr-error",
              message: "Rule could not be installed.",
              params: { reason: "Empty condition list" },
            },
          ],
        },
      ],
    }),
  );
  await openWorkspace(page);

  const failing = page
    .locator(".rogatio-rule-row")
    .filter({ has: page.locator('[data-rule-id="rule-one"]') });
  await expect(failing.locator("[data-rule-status]")).toHaveText("error");
  await failing.locator("[data-rule-link]").click();
  await expect(page.locator("[data-rule-error-card]")).toHaveCount(1);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-one/rule-one",
  );
});

test("the project card is inert while dashboard cards stay clickable", async ({
  page,
}) => {
  await page.addInitScript(
    installChromeMock,
    sidebarEnvelope({
      projects: {
        "project-sidebar": sidebarProject,
        "project-other": {
          ...sidebarProject,
          id: "project-other",
          name: "Other",
          // The sidebar card names `data.name`, not the record name.
          data: { ...sidebarProject.data, name: "Other" },
        },
      },
    }),
  );
  await openWorkspace(page);

  const projectCard = page.locator("[data-active-project-card]");
  await expect(projectCard).toBeVisible();
  expect(
    await projectCard.evaluate((node) => getComputedStyle(node).cursor),
  ).not.toBe("pointer");
  expect(await projectCard.evaluate((node) => node.className)).not.toMatch(
    /\brogatio-project-card\b/,
  );
  await expect(page.locator("[data-active-project-card] button")).toHaveCount(
    0,
  );
  await expect(page.locator("[data-active-project-card] a")).toHaveCount(0);

  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator("[data-project-card]")).toHaveCount(2);
  await page
    .locator('[data-project-card][data-project-id="project-other"]')
    .click();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator("[data-active-project-card]")).toContainText(
    "Other",
  );
});

test("a modifier click on a rule link keeps its native new-tab meaning", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  // The page must not swallow the modifier. If it did, ctrl+click would do
  // nothing at all and the entry would not be a link in any useful sense.
  const notPrevented = await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-rule-link][data-rule-id="rule-two"]',
    );
    if (!link) return null;
    const results: Record<string, boolean> = {};
    for (const [name, init] of [
      ["plain", {}],
      ["ctrl", { ctrlKey: true }],
      ["meta", { metaKey: true }],
      ["shift", { shiftKey: true }],
      ["middle", { button: 1 }],
    ] as const) {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      link.dispatchEvent(event);
      results[name] = event.defaultPrevented;
    }
    return results;
  });

  expect(notPrevented).toEqual({
    plain: true,
    ctrl: false,
    meta: false,
    shift: false,
    middle: false,
  });
});

/**
 * Flip the open group's Enable/Disable control without a real click, so focus
 * stays wherever the test put it while the sidebar is rebuilt underneath.
 * Asserted on the button label rather than the status prose, which is the direct
 * and stable signal.
 */
async function flipGroupEnablement(page: import("./page.js").Page) {
  const button = page.locator("[data-group-enable]").first();
  await expect(button).toBeVisible();
  const before = await button.textContent();
  await page.evaluate(() => {
    const element = document.querySelector<HTMLButtonElement>(
      "[data-group-enable]",
    );
    if (!element) throw new Error("no group enable button");
    element.click();
  });
  await expect(button).toHaveText(before === "Enable" ? "Disable" : "Enable");
}

test("a group enable change does not yank the view back to the deep-linked rule", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();
  await expect(page.locator("[data-rule-card]")).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
  // The reveal focuses the rule card. No later rebuild may run it again.
  const ruleCardSelector = '[data-rule-card][data-rule-id="rule-two"]';
  await expect(page.locator(ruleCardSelector)).toBeFocused();

  // Count reveal calls rather than sampling scroll: a rebuild that re-ran the
  // reveal would scroll the viewport back to the rule, and that is the yank.
  await page.evaluate(() => {
    (window as unknown as { __reveals: number }).__reveals = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(
      this: Element,
      ...args: unknown[]
    ) {
      if (this.matches('[data-rule-card][data-rule-id="rule-two"]')) {
        (window as unknown as { __reveals: number }).__reveals += 1;
      }
      return (original as (...rest: unknown[]) => void).apply(this, args);
    } as typeof Element.prototype.scrollIntoView;
  });

  await flipGroupEnablement(page);
  await expect(page.locator(ruleCardSelector)).toHaveAttribute(
    "data-rule-id",
    "rule-two",
  );
  const reveals = await page.evaluate(
    () => (window as unknown as { __reveals: number }).__reveals,
  );
  expect(reveals).toBe(0);
});

test("focus returns to the same rule link after a re-render", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  // Navigate first so the editor is on a group route and its Enable/Disable
  // control exists, then come back to the sidebar.
  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();
  const link = page.locator('[data-rule-link][data-rule-id="rule-two"]');
  await link.focus();
  await expect(link).toBeFocused();

  await flipGroupEnablement(page);
  await expect(link).toBeFocused();
});

test("focus survives a full shell refresh", async ({ page }) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  // Refresh is the one sidebar-adjacent control that rebuilds the whole shell,
  // so it is the case that proves `renderShell` restores focus too.
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await refresh.click();
  await expect(refresh).toBeFocused();
});

test("focus survives a sidebar-only re-render from the Match logging checkbox", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await openWorkspace(page);

  await page.locator('[data-rule-link][data-rule-id="rule-two"]').click();

  // The focusable node is the input, not the wrapping label, so the hook the
  // focus restore looks for has to be on the input.
  const box = page.locator("[data-match-logging-toggle] input");
  await box.focus();
  await expect(box).toBeFocused();

  await flipGroupEnablement(page);
  await expect(box).toBeFocused();
});

test("the sidebar stays usable at a 360px viewport", async ({ page }) => {
  await page.addInitScript(installChromeMock, sidebarEnvelope());
  await page.setViewportSize({ width: 360, height: 900 });
  await openWorkspace(page);

  const overflow = await page.evaluate(() => {
    const sidebar = document.querySelector(".rogatio-sidebar");
    if (!sidebar) return null;
    return {
      scrollWidth: sidebar.scrollWidth,
      clientWidth: sidebar.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });
  expect(overflow).not.toBeNull();
  if (overflow) {
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(
      overflow.docClientWidth + 1,
    );
  }
  await expect(page.locator("[data-rule-link]").first()).toBeVisible();
});
