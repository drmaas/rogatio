import { expect, test } from "@playwright/test";

function installChromeMock(): void {
  // Note: this function is serialized by addInitScript, so the envelope must be
  // defined here rather than captured from the module closure.
  type Envelope = {
    version: number;
    projects: Record<
      string,
      {
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
      }
    >;
    activeProjectId: string | null;
  };
  const state: Envelope = {
    version: 1,
    projects: {
      "project-a": {
        id: "project-a",
        name: "Project A",
        data: {
          version: 1,
          name: "Project A",
          groups: [
            {
              id: "group-one",
              name: "One",
              origins: ["https://one.example"],
              rules: [
                {
                  id: "rule-one",
                  name: "First rule",
                  urlRegex: "^https://one\\.example/first$",
                  origins: [],
                  resourceTypes: ["main_frame"],
                  priority: 100,
                },
              ],
            },
          ],
        },
        revision: 1,
        enabledGroupIds: ["group-one"],
        grantedOrigins: ["https://one.example"],
      },
      "project-b": {
        id: "project-b",
        name: "Project B",
        data: { version: 1, name: "Project B", groups: [] },
        revision: 1,
        enabledGroupIds: [],
        grantedOrigins: [],
      },
    },
    activeProjectId: "project-a",
  };
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
          message: { command?: string; projectId?: string },
          callback: (value: unknown) => void,
        ) {
          if (message.command === "refresh" || message.command === "get-state")
            callback({ ok: true, value: state });
          else if (message.command === "switch-project") {
            state.activeProjectId = message.projectId ?? null;
            callback({ ok: true, value: state });
          } else callback({ ok: true, value: state });
        },
      },
    },
  });
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

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(rail).toBeHidden();
  await expect(page.locator("[data-mobile-route-nav] select")).toBeVisible();
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

  await page.addInitScript(installChromeMock);
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
  await expect(firstCard.locator("[data-project-status]")).toHaveText(
    "Active Runtime",
  );
  await expect(firstCard.locator("[data-project-groups]")).toHaveText("1");
  await expect(firstCard.locator("[data-project-rules]")).toHaveText("1");
  await expect(firstCard.locator("[data-project-enabled]")).toHaveText(
    "1 of 1",
  );
  await expect(firstCard.locator("[data-project-id-label]")).toHaveText(
    "ID: project-a",
  );
  await expect(page.locator("[data-create-project]")).toBeVisible();

  await page.locator("[data-project-card]").nth(1).click();
  await expect(page.getByText("Opened Project B.")).toBeVisible();
  await expect(page.locator("[data-overview]")).toBeHidden();
  await expect(
    page.locator("[data-editor-root] [data-rogatio-editor]"),
  ).toBeVisible();
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

  await page.addInitScript(installChromeMock);
  await page.goto("/extension/popup.html");

  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await expect(page.getByText("Active project: Project A")).toBeVisible();
  await expect(page.getByText("One")).toBeVisible();
  await expect(page.locator("[data-open-app]")).toBeVisible();
  await expect(page.locator("[data-group-toggle]")).toHaveCount(1);

  // F25: the popup is a fixed, comfortable width and exposes project entry
  // actions next to the group list.
  const popupCard = page.locator(".rogatio-popup");
  const cardBox = await popupCard.boundingBox();
  expect(cardBox?.width ?? 0).toBeGreaterThan(400);
  await expect(page.locator("[data-project-actions]")).toBeVisible();
  await expect(page.locator("[data-create-project]")).toBeVisible();
  await expect(page.locator("[data-import-project]")).toBeVisible();

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
    buffer: Buffer.from('{"version":1,"name":"Imported","groups":[]}'),
  });
  await expect(page.locator("[data-popup-status]")).toHaveText(
    "Project imported.",
  );
});
