import {
  createServer as createNetServer,
  type Server as NetServer,
} from "node:net";
import type { WebDriver } from "selenium-webdriver";
import { it } from "vitest";
import { extensionContext } from "./extension-context.js";
import { expect } from "./fixtures.js";
import type { Page } from "./page.js";

type Route = "proxy" | "direct" | "none";

type Hits = { proxy: number; direct: number };

function listen(server: NetServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("listener has no port"));
    });
  });
}

function closeServer(server: NetServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function installPac(page: Page, script: string): Promise<void> {
  await page.evaluate((pac: string) => {
    return new Promise<void>((resolve, reject) => {
      const proxy = chrome.proxy;
      if (!proxy?.settings) {
        reject(new Error("chrome.proxy.settings is unavailable"));
        return;
      }
      proxy.settings.set(
        {
          value: { mode: "pac_script", pacScript: { data: pac } },
          scope: "regular",
        },
        () => {
          const message = chrome.runtime.lastError?.message;
          if (message) reject(new Error(message));
          else resolve();
        },
      );
    });
  }, script);
}

async function clearPac(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const proxy = chrome.proxy;
      if (!proxy?.settings) {
        resolve();
        return;
      }
      proxy.settings.clear({ scope: "regular" }, () => resolve());
    });
  });
}

async function observe(
  driver: WebDriver,
  url: string,
  hits: Hits,
): Promise<Route> {
  const proxyBefore = hits.proxy;
  const directBefore = hits.direct;
  try {
    await driver.get(url);
  } catch {
    // A closed proxy socket or a load timeout is still a routing observation.
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (hits.proxy > proxyBefore) return "proxy";
    if (hits.direct > directBefore) return "direct";
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (hits.proxy > proxyBefore) return "proxy";
  if (hits.direct > directBefore) return "direct";
  return "direct";
}

function pac(body: string): string {
  return `function FindProxyForURL(url, host) {
  if (url.indexOf("http://example.com/") !== 0) return "DIRECT";
  ${body}
  return "DIRECT";
}`;
}

// T01 gate: RegExp-in-PAC unproven in CfT — skipped until spike passes (see workflow.md).
it.skip("Chrome PAC spike: RegExp, case, lastIndex, and URL", async () => {
  const registerDriver = (
    _driver: WebDriver,
    _closer?: () => Promise<void>,
  ) => {};
  const hits: Hits = { proxy: 0, direct: 0 };
  const proxyServer = createNetServer((socket) => {
    hits.proxy += 1;
    socket.end();
  });
  const proxyPort = await listen(proxyServer);
  const proxyTarget = `PROXY 127.0.0.1:${proxyPort}`;
  const { page, extensionId, driver, close } = await extensionContext({
    chromeArgs: ["--proxy-bypass-list=<-loopback>"],
  });
  registerDriver(driver, close);
  await driver.manage().setTimeouts({ pageLoad: 4_000 });

  const results: Record<string, boolean | Route> = {};
  try {
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await installPac(
      page,
      `function FindProxyForURL(url, host) {
  if (url.indexOf("http://example.com/") === 0) return "${proxyTarget}";
  return "DIRECT";
}`,
    );
    results.control = await observe(driver, "http://example.com/control", hits);

    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await installPac(
      page,
      pac(`if (typeof RegExp === "function") return "${proxyTarget}";`),
    );
    results.regexpIsFunction = await observe(
      driver,
      "http://example.com/regexp",
      hits,
    );

    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await installPac(
      page,
      pac(`var re = new RegExp("^Ex$");
  if (re.test("Ex") && !re.test("ex")) return "${proxyTarget}";`),
    );
    results.caseMatch = await observe(driver, "http://example.com/case", hits);

    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await installPac(
      page,
      pac(`var re = new RegExp("Ex", "g");
  if (re.test("Ex")) return "${proxyTarget}";`),
    );
    results.lastIndexInsideFirst = await observe(
      driver,
      "http://example.com/inside-a",
      hits,
    );
    results.lastIndexInsideSecond = await observe(
      driver,
      "http://example.com/inside-b",
      hits,
    );

    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await installPac(
      page,
      `var outside = new RegExp("Ex", "g");
function FindProxyForURL(url, host) {
  if (url.indexOf("http://example.com/") !== 0) return "DIRECT";
  if (outside.test("Ex")) return "${proxyTarget}";
  return "DIRECT";
}`,
    );
    results.lastIndexOutsideFirst = await observe(
      driver,
      "http://example.com/outside-a",
      hits,
    );
    results.lastIndexOutsideSecond = await observe(
      driver,
      "http://example.com/outside-b",
      hits,
    );

    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await installPac(
      page,
      pac(`if (typeof URL !== "function") return "DIRECT";
  var parsed = new URL(url);
  if (parsed && parsed.hostname && parsed.hostname.length > 0) return "${proxyTarget}";`),
    );
    results.newUrl = await observe(driver, "http://example.com/url", hits);

    console.log(`T01_SPIKE ${JSON.stringify(results)}`);

    expect(results.control).toBe("proxy");
    expect(results.regexpIsFunction).toBe("proxy");
    expect(results.caseMatch).toBe("proxy");
    expect(results.lastIndexInsideFirst).toBe("proxy");
    expect(results.lastIndexInsideSecond).toBe("proxy");
    expect(results.newUrl).toBe("proxy");
    expect(results.lastIndexOutsideFirst).not.toBe("none");
    expect(results.lastIndexOutsideSecond).not.toBe("none");
  } finally {
    try {
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      await clearPac(page);
    } catch {
      // Profile teardown drops proxy settings with the browser.
    }
    await closeServer(proxyServer);
  }
});
