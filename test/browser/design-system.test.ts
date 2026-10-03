import { expect, test } from "./fixtures.js";
import type { Page } from "./page.js";

type MockProject = {
  id: string;
  name: string;
  data: {
    version: number;
    name: string;
    groups: Array<{
      id: string;
      name: string;
      origins: string[];
      rules: Array<{
        id: string;
        name: string;
        urlRegex: string;
        origins: string[];
        resourceTypes: string[];
        priority: number;
      }>;
    }>;
  };
  revision: number;
  enabledGroupIds: string[];
  grantedOrigins: string[];
};

type MockEnvelope = {
  version: number;
  projects: Record<string, MockProject>;
  activeProjectId: string | null;
  ruleStatuses?: Array<{
    groupId: string;
    ruleId: string;
    status: string;
  }>;
  badge?: { text: string; attention: boolean };
  nativeRuntimeState?: { phase: string };
};

type MockRule = MockProject["data"]["groups"][number]["rules"][number];
type MockGroup = MockProject["data"]["groups"][number];

function makeRule(overrides: Partial<MockRule> = {}): MockRule {
  return {
    id: "rule-one",
    name: "First rule",
    urlRegex: "^https://one\\.example/first$",
    origins: [],
    resourceTypes: ["main_frame"],
    priority: 100,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<MockGroup> = {}): MockGroup {
  return {
    id: "group-one",
    name: "One",
    origins: ["https://one.example"],
    rules: [makeRule()],
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<MockProject> & Pick<MockProject, "id" | "name">,
): MockProject {
  const { id, name, data: dataOverrides, ...rest } = overrides;
  return {
    id,
    name,
    data: {
      version: 1,
      name,
      groups: [],
      ...dataOverrides,
    },
    revision: 1,
    enabledGroupIds: [],
    grantedOrigins: [],
    ...rest,
  };
}

const projectA: MockProject = makeProject({
  id: "project-a",
  name: "Project A",
  data: {
    version: 1,
    name: "Project A",
    groups: [makeGroup()],
  },
  enabledGroupIds: ["group-one"],
  grantedOrigins: ["https://one.example"],
});

const projectB: MockProject = makeProject({
  id: "project-b",
  name: "Project B",
});

const emptyGroupsProject: MockProject = makeProject({
  id: "project-empty",
  name: "Empty Project",
});

function emptyEnvelope(): MockEnvelope {
  return { version: 1, projects: {}, activeProjectId: null };
}

function oneProjectEnvelope(project: MockProject = projectA): MockEnvelope {
  return {
    version: 1,
    projects: { [project.id]: project },
    activeProjectId: project.id,
  };
}

function defaultEnvelope(): MockEnvelope {
  return {
    version: 1,
    projects: {
      "project-a": projectA,
      "project-b": projectB,
    },
    activeProjectId: "project-a",
  };
}

/** Seed is serialized by addInitScript; always pass a module-level envelope. */
function installChromeMock(seed: MockEnvelope): void {
  // Note: this function is serialized by addInitScript, so it must not close
  // over module bindings — only the passed seed is available in-page.
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
          if (message.command === "refresh" || message.command === "get-state")
            callback({ ok: true, value: state });
          else if (message.command === "switch-project") {
            state.activeProjectId = message.projectId ?? null;
            callback({ ok: true, value: state });
          } else if (message.command === "set-group-enabled") {
            const projectId = message.projectId;
            const groupId = message.groupId;
            const project =
              projectId !== undefined ? state.projects[projectId] : undefined;
            if (
              project &&
              typeof groupId === "string" &&
              typeof message.enabled === "boolean"
            ) {
              const enabled = new Set(project.enabledGroupIds);
              if (message.enabled) enabled.add(groupId);
              else enabled.delete(groupId);
              project.enabledGroupIds = [...enabled];
              const activeCount = project.enabledGroupIds.length;
              state.badge = {
                text: String(activeCount),
                attention: activeCount === 0,
              };
              state.ruleStatuses = project.data.groups.flatMap((group) =>
                group.rules.map((rule) => ({
                  groupId: group.id,
                  ruleId: rule.id,
                  status: enabled.has(group.id) ? "active" : "disabled",
                })),
              );
            }
            callback({ ok: true, value: project ?? state });
          } else if (message.command === "export-project") {
            const projectId = message.projectId;
            const project =
              typeof projectId === "string"
                ? state.projects[projectId]
                : undefined;
            callback(
              project
                ? { ok: true, value: project }
                : {
                    ok: false,
                    diagnostic: { code: "extension.missing-project" },
                  },
            );
          } else callback({ ok: true, value: state });
        },
      },
    },
  });
}

/** Toolbar: Open app under [data-project-actions] with New/Import; not in header. */
async function expectProjectActions(page: Page): Promise<void> {
  const actions = page.locator("[data-project-actions]");
  await expect(actions).toBeVisible();
  await expect(actions.locator("[data-create-project]")).toBeVisible();
  await expect(actions.locator("[data-import-project]")).toBeVisible();
  await expect(actions.locator("[data-open-app]")).toBeVisible();
  await expect(page.locator("header [data-open-app]")).toHaveCount(0);
}

async function expectPickerAbsent(page: Page): Promise<void> {
  await expect(page.locator("[data-project-picker]")).toHaveCount(0);
}

test("editor renders the dark design system with navigation at the top", async ({
  page,
}) => {
  await page.goto("/editor-fixture.html");
  const editor = page.locator("[data-rogatio-editor]");
  await expect(editor).toBeVisible();

  const surface = await editor.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      background: styles.backgroundColor,
      font: styles.fontFamily,
    };
  });
  expect(surface.background).toBe("rgb(22, 27, 34)");
  expect(surface.font).toContain("Hanken Grotesk");

  const pageBackground = await page.evaluate(() => {
    const styles = getComputedStyle(document.body);
    return { color: styles.backgroundColor, image: styles.backgroundImage };
  });
  expect(pageBackground.color).toBe("rgb(18, 20, 23)");
  expect(pageBackground.image).toContain("radial-gradient");

  const rail = page.locator("[data-desktop-route-rail]");
  const main = page.locator("[data-editor-main]");
  const railBox = await rail.boundingBox();
  const mainBox = await main.boundingBox();
  expect(railBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  if (!railBox || !mainBox) throw new Error("missing bounding boxes");
  expect(railBox.y < mainBox.y).toBe(true);
  expect(railBox.width > railBox.height).toBe(true);

  const placed = await page.evaluate(() => {
    const railEl = document.querySelector("[data-desktop-route-rail]");
    const searchEl = document.querySelector("[data-search-wrap]");
    const crumbEl = document.querySelector("[data-route-breadcrumb]");
    if (!railEl || !searchEl || !crumbEl) return null;
    const railRect = railEl.getBoundingClientRect();
    const searchRect = searchEl.getBoundingClientRect();
    const crumbRect = crumbEl.getBoundingClientRect();
    const padRight = Number.parseFloat(getComputedStyle(railEl).paddingRight);
    return {
      gapToRail: railRect.right - padRight - searchRect.right,
      afterCrumb: searchRect.left - crumbRect.right,
      searchWidth: searchRect.width,
      railWidth: railRect.width,
    };
  });
  expect(placed).not.toBeNull();
  if (!placed) throw new Error("missing search placement");
  expect(Math.abs(placed.gapToRail)).toBeLessThanOrEqual(1);
  expect(placed.afterCrumb).toBeGreaterThan(16);
  expect(placed.searchWidth).toBeLessThan(placed.railWidth / 2);

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(rail).toBeVisible();
  await expect(page.locator("[data-mobile-route-nav]")).toHaveCount(0);
  await expect(page.locator("[data-route-breadcrumb] li")).toHaveCount(2);
  // The CLI editor keeps its project-page group list. Workspace chrome is
  // extension-only.
  await expect(page.locator("[data-group-list]")).toBeVisible();
  await expect(page.locator("[data-group-list] li")).toHaveCount(2);
  await expect(page.locator("[data-workspace-breadcrumb]")).toHaveCount(0);
  await expect(page.locator("[data-group-menu]")).toHaveCount(0);
});

test("serves the editor stylesheet and bundled fonts over the test server", async ({
  request,
}) => {
  const cssResponse = await request.get("/editor/index.css");
  expect(cssResponse.ok()).toBe(true);
  expect(cssResponse.headers()["content-type"]).toContain("text/css");
  const css = await cssResponse.text();
  expect(css).toContain(".rogatio-editor");
  expect(css).toContain("@font-face");
  expect(css).toContain("Hanken Grotesk");

  const fontResponse = await request.get(
    "/editor/fonts/hanken-grotesk-400.woff2",
  );
  expect(fontResponse.ok()).toBe(true);
  expect(fontResponse.headers()["content-type"]).toContain("font/woff2");
  const monoResponse = await request.get(
    "/editor/fonts/jetbrains-mono-400.woff2",
  );
  expect(monoResponse.ok()).toBe(true);
});

test("extension shell renders the top bar, tabs, and project-card overview", async ({
  page,
  request,
}) => {
  const pageResponse = await request.get("/extension/index.html");
  expect(pageResponse.ok()).toBe(true);
  const pageMarkup = await pageResponse.text();
  expect(pageMarkup).toContain('href="editor.css"');
  expect(pageMarkup).toContain('href="extension-page.css"');

  const shellCssResponse = await request.get("/extension/extension-page.css");
  expect(shellCssResponse.ok()).toBe(true);
  expect(shellCssResponse.headers()["content-type"]).toContain("text/css");

  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/index.html");

  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace", exact: true }),
  ).toBeVisible();

  const overview = page.locator("[data-overview]");
  await expect(overview).toBeVisible();
  await expect(page.locator("[data-project-card]")).toHaveCount(2);
  const firstCard = page.locator("[data-project-card]").first();
  await expect(firstCard).toContainText("Project A");
  await expect(firstCard.locator("[data-project-status]")).toHaveText("Idle");
  await expect(firstCard.locator("[data-project-groups]")).toHaveText("1");
  await expect(firstCard.locator("[data-project-rules]")).toHaveText("1");
  await expect(firstCard.locator("[data-project-enabled]")).toHaveText(
    "1 of 1",
  );
  await expect(firstCard.locator("[data-project-id-label]")).toHaveText(
    "ID: project-a",
  );
  await expect(page.locator(".rogatio-sidebar")).toHaveCount(0);
  await expect(page.locator('[data-dashboard-section="create"]')).toBeVisible();
  await expect(
    page.locator('[data-dashboard-section="projects"]'),
  ).toBeVisible();
  await expect(page.locator(".rogatio-topbar-actions")).toHaveCount(0);
  const creationTiles = page.locator(
    ".rogatio-creation-grid .rogatio-create-project",
  );
  await expect(creationTiles).toHaveCount(3);
  const creationSectionBox = await page
    .locator('[data-dashboard-section="create"]')
    .boundingBox();
  const creationGridBox = await page
    .locator(".rogatio-creation-grid")
    .boundingBox();
  const projectsSectionBox = await page
    .locator('[data-dashboard-section="projects"]')
    .boundingBox();
  expect(creationSectionBox?.width ?? 0).toBeGreaterThan(0);
  expect(creationGridBox?.width ?? 0).toBeGreaterThan(
    (creationSectionBox?.width ?? 0) * 0.9,
  );
  expect(projectsSectionBox?.width).toBe(creationSectionBox?.width);
  const tileBoxes = await creationTiles.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const rect = tile.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width };
    }),
  );
  expect(tileBoxes[0]?.top).toBe(tileBoxes[1]?.top);
  expect(tileBoxes[1]?.top).toBe(tileBoxes[2]?.top);
  expect(tileBoxes[0]?.left).toBeLessThan(tileBoxes[1]?.left ?? 0);
  expect(tileBoxes[1]?.left).toBeLessThan(tileBoxes[2]?.left ?? 0);
  expect(tileBoxes[0]?.width ?? 0).toBeGreaterThan(0);
  expect(tileBoxes[0]?.width).toBeCloseTo(tileBoxes[1]?.width ?? 0, 1);
  expect(tileBoxes[1]?.width).toBeCloseTo(tileBoxes[2]?.width ?? 0, 1);
  await expect(page.locator('[data-command="create"]')).toBeVisible();
  await expect(page.locator('[data-command="import"]')).toBeVisible();
  await expect(page.locator('[data-command="ai-generate"]')).toBeVisible();

  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator(".rogatio-sidebar")).toBeVisible();
  await expect(page.locator("[data-project-selector]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Switch project" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import project" }),
  ).toHaveCount(0);

  const breadcrumb = page.locator("[data-route-breadcrumb]");
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.locator("[data-route='project']")).toHaveText(
    "Project A",
  );
  await expect(
    breadcrumb.locator("[data-command='open-group-picker']"),
  ).toHaveText("Groups");
  await expect(page.locator("[data-workspace-breadcrumb]")).toHaveCount(0);
  await expect(page.locator("[data-workspace-subheader]")).toHaveCount(0);
  await expect(page.locator("[data-group-menu]")).toHaveCount(0);
  await expect(
    page.locator(".rogatio-topbar [data-command='export']"),
  ).toHaveCount(0);

  const projectActions = page.locator("[data-project-actions]");
  await expect(
    projectActions.getByRole("button", { name: "Refresh" }),
  ).toBeVisible();
  await expect(
    projectActions.getByRole("button", { name: "Export project" }),
  ).toBeVisible();
  await expect(
    projectActions.getByRole("button", { name: "Remove project" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-card='rules'] [data-badge-state]"),
  ).toContainText("Active rules:");
  await expect(
    page.locator("[data-editor-command-bar] [data-route='test']"),
  ).toBeVisible();

  await breadcrumb.locator("[data-command='open-group-picker']").click();
  await page.locator("[data-group-picker] [data-group-id='group-one']").click();
  await expect(breadcrumb.locator("[data-route='project']")).toHaveText(
    "Project A",
  );
  await expect(
    breadcrumb.locator("[data-command='open-group-picker']"),
  ).toHaveText("One");
  await expect(page.locator("[data-group-heading]")).toBeVisible();

  await breadcrumb.locator("[data-route='project']").click();
  await expect(page.locator('[data-path="/name"]')).toBeVisible();
  await expect(
    breadcrumb.locator("[data-command='open-group-picker']"),
  ).toHaveText("Groups");

  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator("[data-workspace-breadcrumb]")).toHaveCount(0);
  await expect(page.locator("[data-workspace-subheader]")).toHaveCount(0);
  await expect(
    page
      .locator("[data-project-card]")
      .first()
      .locator("[data-project-status]"),
  ).toHaveText("Idle");
  await page.locator("[data-project-card]").nth(1).click();
  await expect(page.getByText("Opened Project B.")).toBeVisible();
  await expect(page.locator("[data-overview]")).toBeHidden();
  await expect(page.locator(".rogatio-sidebar")).toBeVisible();
  await expect(
    page.locator("[data-editor-root] [data-rogatio-editor]"),
  ).toBeVisible();
  await expect(
    page.locator("[data-route-breadcrumb] [data-route='project']"),
  ).toHaveText("Project B");
  await page.locator("[data-command='open-group-picker']").click();
  await expect(page.locator("[data-group-picker]")).toContainText(
    "No groups yet.",
  );
  await page.locator("[data-command='close-group-picker']").click();

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("[data-group-menu]")).toHaveCount(0);
  await expect(page.locator("[data-route-breadcrumb]")).toBeVisible();
  await expect(page.locator("[data-mobile-route-nav]")).toHaveCount(0);
});

test("popup renders the dark Rogatio card", async ({ page, request }) => {
  const popupResponse = await request.get("/extension/popup.html");
  expect(popupResponse.ok()).toBe(true);
  const popupMarkup = await popupResponse.text();
  expect(popupMarkup).toContain('href="popup.css"');
  expect(popupMarkup).toContain("Rogatio");

  const popupCssResponse = await request.get("/extension/popup.css");
  expect(popupCssResponse.ok()).toBe(true);
  expect(popupCssResponse.headers()["content-type"]).toContain("text/css");

  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/popup.html");

  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  // ≥2 projects: picker visible with the active option selected.
  const picker = page.locator("[data-project-picker]");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue("project-a");
  await expect(page.getByText("One")).toBeVisible();
  await expect(page.locator("[data-group-toggle]")).toHaveCount(1);

  // F25: the popup is a fixed, comfortable width and exposes project entry
  // actions next to the group list.
  const popupCard = page.locator(".rogatio-popup");
  const cardBox = await popupCard.boundingBox();
  expect(cardBox?.width ?? 0).toBeGreaterThan(400);

  await expectProjectActions(page);
  // Picker sits on its own row above the action row.
  const pickerBeforeActions = await page.evaluate(() => {
    const p = document.querySelector("[data-project-picker]");
    const a = document.querySelector("[data-project-actions]");
    if (!p || !a) return false;
    return Boolean(
      p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(pickerBeforeActions).toBe(true);
});

test("popup group card chrome", async ({ page }) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/popup.html");

  // Phase 2: muted project subtitle under group name; groups collapsed;
  // CSS chevron affordance; expand reveals rules.
  const groupCard = page.locator("details[data-group]");
  await expect(groupCard).toHaveCount(1);
  await expect(groupCard).not.toHaveAttribute("open");
  const activeProject = groupCard.locator("[data-active-project]");
  await expect(activeProject).toHaveText("Project A");
  await expect(groupCard.locator("[data-group-name]")).toHaveText("One");
  const subtitleUnderName = await groupCard.evaluate((details) => {
    const summary = details.querySelector("summary");
    if (!summary) return false;
    const nameSpan = summary.querySelector("[data-group-name]");
    const subtitle = summary.querySelector("[data-active-project]");
    if (!nameSpan || !subtitle) return false;
    const nameBox = nameSpan.getBoundingClientRect();
    const subBox = subtitle.getBoundingClientRect();
    return subBox.top >= nameBox.bottom - 1;
  });
  expect(subtitleUnderName).toBe(true);
  const chevron = await groupCard.locator("summary").evaluate((summary) => {
    const before = getComputedStyle(summary, "::before");
    const content = before.content;
    const hasContent =
      content !== "none" && content !== "normal" && content !== '""';
    const width = Number.parseFloat(before.width);
    const height = Number.parseFloat(before.height);
    const border =
      Number.parseFloat(before.borderRightWidth) +
      Number.parseFloat(before.borderBottomWidth);
    return {
      visible:
        before.display !== "none" &&
        before.visibility !== "hidden" &&
        (hasContent || width > 0 || height > 0 || border > 0),
      content,
    };
  });
  expect(chevron.visible).toBe(true);
  const chevronTransformClosed = await groupCard
    .locator("summary")
    .evaluate((summary) => getComputedStyle(summary, "::before").transform);
  await expect(page.getByText("First rule")).toBeHidden();
  await groupCard.locator("summary").click();
  await expect(groupCard).toHaveAttribute("open", "");
  await expect(page.getByText("First rule")).toBeVisible();
  // Poll: chevron transform animates 120ms; under parallel load a single
  // read can still see the closed matrix.
  await expect
    .poll(async () =>
      groupCard
        .locator("summary")
        .evaluate((summary) => getComputedStyle(summary, "::before").transform),
    )
    .not.toBe(chevronTransformClosed);
  await expect(
    page.getByRole("button", { name: "Disable group One" }),
  ).toBeVisible();
  await expect(groupCard.locator("[data-group-status]")).toHaveText("Active");
  // Button stopPropagation: sync click must not toggle details open/closed.
  const openAfterToggleClick = await groupCard.evaluate((el) => {
    const details = el as HTMLDetailsElement;
    const toggle = details.querySelector<HTMLButtonElement>(
      "[data-group-toggle]",
    );
    if (!toggle) return null;
    details.open = true;
    toggle.click();
    return details.open;
  });
  expect(openAfterToggleClick).toBe(true);
});

test("popup create and import projects", async ({ page }) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/popup.html");

  await page.locator("[data-create-project]").click();
  const createForm = page.locator("[data-create-form]");
  await expect(createForm).toBeVisible();
  await expect(page.locator("[data-create-project]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.locator("[data-project-name]").fill("Fresh project");
  await page.locator("[data-create-submit]").click();
  await expect(page.locator("[data-popup-status]")).toHaveText(
    "Project created.",
  );
  await expect(createForm).toBeHidden();

  await page.locator("[data-import-input]").setInputFiles({
    name: "imported.rogatio.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":2,"name":"Imported","groups":[]}'),
  });
  await expect(page.locator("[data-popup-status]")).toHaveText(
    "Project imported.",
  );
});

const validImportedProject = Buffer.from(
  '{"version":2,"name":"Imported","groups":[]}',
);

test("imports a project from any filename and rejects a non-project", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, emptyEnvelope());
  await page.goto("/extension/index.html");
  await expect(page.getByText("Any filename works.")).toBeVisible();
  const dashboardInput = page.locator("[data-import-input]");
  expect(
    await dashboardInput.evaluate((input) => input.getAttribute("accept")),
  ).toBeNull();

  await dashboardInput.setInputFiles({
    name: "package.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"name":"pkg","version":"1.0.0"}'),
  });
  await expect(page.locator(".rogatio-status")).toHaveText(
    /^not a Rogatio project:/,
  );

  await dashboardInput.setInputFiles({
    name: "anything.json",
    mimeType: "application/json",
    buffer: validImportedProject,
  });
  await expect(page.locator(".rogatio-status")).toHaveText("Project imported.");

  await dashboardInput.setInputFiles({
    name: "checkout-mocks",
    mimeType: "application/octet-stream",
    buffer: validImportedProject,
  });
  await expect(page.locator(".rogatio-status")).toHaveText("Project imported.");

  await page.goto("/extension/popup.html");
  const popupInput = page.locator("[data-import-input]");
  expect(
    await popupInput.evaluate((input) => input.getAttribute("accept")),
  ).toBeNull();
  await popupInput.setInputFiles({
    name: "notes",
    mimeType: "application/octet-stream",
    buffer: validImportedProject,
  });
  await expect(page.locator("[data-popup-status]")).toHaveText(
    "Project imported.",
  );
  await popupInput.setInputFiles({
    name: "not-a-project.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(page.locator("[data-popup-status]")).toHaveText(
    /^not a Rogatio project:/,
  );
});

test("exports with the default name and a custom name", async ({ page }) => {
  await page.addInitScript(installChromeMock, oneProjectEnvelope());
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  await page.evaluate(() => {
    const view = window as unknown as {
      __save: { suggestedName?: string; written?: string } | null;
      showSaveFilePicker: (options?: { suggestedName?: string }) => Promise<{
        name: string;
        createWritable: () => Promise<{
          write: (data: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };
    view.__save = null;
    view.showSaveFilePicker = async (options) => {
      let written = "";
      return {
        name: "checkout.json",
        createWritable: async () => ({
          write: async (data: string) => {
            written = String(data);
          },
          close: async () => {
            view.__save = {
              suggestedName: options?.suggestedName,
              written,
            };
          },
        }),
      };
    };
  });
  await page.getByRole("button", { name: "Export project" }).click();
  await expect(page.locator(".rogatio-status")).toHaveText("Project exported.");
  const saved = await page.evaluate(() => {
    return (
      window as unknown as {
        __save: { suggestedName?: string; written?: string } | null;
      }
    ).__save;
  });
  expect(saved?.suggestedName).toBe(".rogatio.json");
  expect(saved?.written ?? "").toContain("Project A");

  await page.evaluate(() => {
    const view = window as unknown as {
      showSaveFilePicker?: unknown;
      __downloads: string[];
      prompt: (message?: string, value?: string) => string | null;
    };
    // Own undefined shadows a prototype save dialog so the download fallback runs.
    view.showSaveFilePicker = undefined;
    view.__downloads = [];
    view.prompt = (_message, value) => {
      if (value !== ".rogatio.json") {
        throw new Error(`prompt default was ${String(value)}`);
      }
      return "staging.json";
    };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      view.__downloads.push(this.download);
    };
  });
  await page.getByRole("button", { name: "Export project" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          (window as unknown as { __downloads?: string[] }).__downloads ?? []
        ).join(","),
      ),
    )
    .toBe("staging.json");
  await expect(page.locator(".rogatio-status")).toHaveText("Project exported.");
});

test("workspace export follows the active project, not the dashboard selection", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/index.html");
  await page.locator("[data-project-selector]").selectOption("project-b");
  await expect(page.locator(".rogatio-status")).toContainText("Project B");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.evaluate(() => {
    const view = window as unknown as {
      __save: { written?: string } | null;
      showSaveFilePicker: () => Promise<{
        name: string;
        createWritable: () => Promise<{
          write: (data: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };
    view.__save = null;
    view.showSaveFilePicker = async () => {
      let written = "";
      return {
        name: "checkout.json",
        createWritable: async () => ({
          write: async (data: string) => {
            written = String(data);
          },
          close: async () => {
            view.__save = { written };
          },
        }),
      };
    };
  });
  await page.getByRole("button", { name: "Export project" }).click();
  await expect(page.locator(".rogatio-status")).toHaveText("Project exported.");
  const written = await page.evaluate(
    () =>
      (window as unknown as { __save: { written?: string } | null }).__save
        ?.written ?? "",
  );
  expect(written).toContain("Project A");
  expect(written).not.toContain("Project B");
});

test("popup hides project picker when there are zero projects", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, emptyEnvelope());
  await page.goto("/extension/popup.html");

  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await expectPickerAbsent(page);
  await expectProjectActions(page);
  await expect(page.getByText("No active project")).toBeVisible();
  // Empty-state rows must not invent a project subtitle.
  await expect(page.locator("[data-active-project]")).toHaveCount(0);
});

test("popup hides project picker when there is one project", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, oneProjectEnvelope());
  await page.goto("/extension/popup.html");

  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await expectPickerAbsent(page);
  await expectProjectActions(page);
  await expect(page.getByText("One")).toBeVisible();
  await expect(
    page.locator("details[data-group] [data-active-project]"),
  ).toHaveText("Project A");
  await expect(page.locator("details[data-group]")).not.toHaveAttribute("open");
});

test("popup empty-groups state omits project subtitle", async ({ page }) => {
  await page.addInitScript(
    installChromeMock,
    oneProjectEnvelope(emptyGroupsProject),
  );
  await page.goto("/extension/popup.html");

  await expect(
    page.getByText("This project has no saved groups."),
  ).toBeVisible();
  await expect(page.locator("details[data-group]")).toHaveCount(0);
  // Empty-state rows must not invent a project subtitle.
  await expect(page.locator("[data-active-project]")).toHaveCount(0);
});

test("popup project picker switches active project via switch-project", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/popup.html");

  const picker = page.locator("[data-project-picker]");
  await expect(picker).toBeVisible();
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue("project-a");
  await expect(page.getByText("One")).toBeVisible();
  await expect(
    page.locator("details[data-group] [data-active-project]"),
  ).toHaveText("Project A");

  await picker.selectOption("project-b");
  await expect(picker).toHaveValue("project-b");
  await expect(picker.locator("option:checked")).toHaveText("Project B");
  await expect(
    page.getByText("This project has no saved groups."),
  ).toBeVisible();
  await expect(page.locator("details[data-group]")).toHaveCount(0);
  // Empty-state list has no group-card subtitle; picker label tracks B.
  await expect(page.locator("[data-active-project]")).toHaveCount(0);

  await picker.selectOption("project-a");
  await expect(picker).toHaveValue("project-a");
  await expect(page.getByText("One")).toBeVisible();
  await expect(
    page.locator("details[data-group] [data-active-project]"),
  ).toHaveText("Project A");
});

test("popup Open app href stays management page after project switch", async ({
  page,
}) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/popup.html");

  const openApp = page.locator("[data-open-app]");
  await expect(openApp).toHaveAttribute("href", "index.html");

  await page.locator("[data-project-picker]").selectOption("project-b");
  await expect(page.locator("[data-project-picker]")).toHaveValue("project-b");
  await expect(openApp).toHaveAttribute("href", "index.html");
});

test("workspace enable button sits on the group heading", async ({ page }) => {
  await page.addInitScript(installChromeMock, defaultEnvelope());
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  const projectCard = page.locator("[data-active-project-card]");
  const startRuntime = page.getByRole("button", { name: "Start runtime" });
  await expect(projectCard).toBeVisible();
  await expect(startRuntime).toBeVisible();
  await expect(page.locator("[data-group-activation]")).toHaveCount(0);

  await page.locator("[data-command='open-group-picker']").click();
  await page.locator('[data-group-picker] [data-group-id="group-one"]').click();
  const enable = page.locator("[data-group-heading] [data-group-enable]");
  await expect(enable).toBeVisible();
  await expect(enable).toHaveText("Disable");
  await expect(enable).toHaveAttribute("aria-label", "Disable group One");
  await expect(page.locator("[data-group-toggle]")).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 280 });
  await page.evaluate(() => {
    document.querySelector("[data-editor-main]")?.scrollTo(0, 10_000);
  });
  const railClearsChrome = await page.evaluate(() => {
    const chrome = document.querySelector(".rogatio-chrome");
    const rail = document.querySelector("[data-desktop-route-rail]");
    const editorMain = document.querySelector("[data-editor-main]");
    if (!chrome || !rail || !editorMain || editorMain.scrollTop <= 0)
      return false;
    return (
      rail.getBoundingClientRect().top >=
      chrome.getBoundingClientRect().bottom - 1
    );
  });
  expect(railClearsChrome).toBe(true);
});

test("workspace group toggle keeps dirty editor draft mounted", async ({
  page,
}) => {
  const startedEnvelope: MockEnvelope = {
    ...defaultEnvelope(),
    nativeRuntimeState: { phase: "started" },
    badge: { text: "1", attention: false },
    ruleStatuses: [
      { groupId: "group-one", ruleId: "rule-one", status: "active" },
    ],
  };
  await page.addInitScript(installChromeMock, startedEnvelope);
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();

  const nameInput = page.locator('[data-path="/name"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Draft rename");
  await expect(page.locator("[data-dirty-state]")).toHaveText(
    "Unsaved changes",
  );

  await page.locator("[data-command='open-group-picker']").click();
  await page.locator('[data-group-picker] [data-group-id="group-one"]').click();
  const toggle = page.locator("[data-group-heading] [data-group-enable]");
  await expect(toggle).toHaveText("Disable");
  await toggle.click();
  await expect(toggle).toHaveText("Enable");
  await expect(page.getByText("Group disabled.")).toBeVisible();
  await expect(page.locator("[data-dirty-state]")).toHaveText(
    "Unsaved changes",
  );
  await page
    .locator('[data-desktop-route-rail] [data-route="project"]')
    .click();
  await expect(nameInput).toHaveValue("Draft rename");
  await expect(page.locator("[data-badge-state]")).toContainText(
    "Active rules: 0",
  );
  // A rule row is a link carrying the name plus a sibling status token.
  await expect(
    page.locator("[data-rule-statuses] [data-rule-link]"),
  ).toHaveText("One / First rule");
  await expect(
    page.locator("[data-rule-statuses] [data-rule-status]"),
  ).toHaveText("disabled");
});
