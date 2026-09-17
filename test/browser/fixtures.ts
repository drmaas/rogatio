import { mkdirSync, writeFileSync } from "node:fs";
import type { WebDriver } from "selenium-webdriver";
import { afterEach, beforeEach, it, type TestContext } from "vitest";
import { createDriver } from "./driver.js";
import { expect, Page, request } from "./page.js";

export type { Page };
export { expect, request };

type TestFixtures = {
  page: Page;
  request: typeof request;
};

type TestFn = (fixtures: TestFixtures) => Promise<void> | void;

type BrowserTest = {
  (name: string, fn: TestFn): void;
  beforeEach: (fn: TestFn) => void;
  skip: (name: string, fn?: TestFn) => void;
  info: () => { parallelIndex: number };
};

let currentDriver: WebDriver | undefined;
let currentPage: Page | undefined;
/** Standalone tests register their driver so afterEach can always quit. */
let standaloneDriver: WebDriver | undefined;
let standaloneCloser: (() => Promise<void>) | undefined;

async function ensurePage(): Promise<Page> {
  if (currentPage) return currentPage;
  currentDriver = await createDriver();
  currentPage = new Page(currentDriver);
  return currentPage;
}

beforeEach(() => {
  currentDriver = undefined;
  currentPage = undefined;
  standaloneDriver = undefined;
  standaloneCloser = undefined;
});

afterEach(async (context: TestContext) => {
  const drivers: WebDriver[] = [];
  if (currentDriver) drivers.push(currentDriver);
  if (standaloneDriver) drivers.push(standaloneDriver);
  const closer = standaloneCloser;
  currentDriver = undefined;
  currentPage = undefined;
  standaloneDriver = undefined;
  standaloneCloser = undefined;

  try {
    if (context.task.result?.state === "fail") {
      for (const driver of drivers) {
        try {
          const png = await driver.takeScreenshot();
          mkdirSync("test/browser/artifacts", { recursive: true });
          const name = context.task.name.replace(/\W+/g, "_").slice(0, 80);
          writeFileSync(`test/browser/artifacts/${name}.png`, png, "base64");
        } catch {
          // Screenshot best-effort; still quit below.
        }
      }
    }
  } finally {
    if (closer) {
      await closer().catch(() => undefined);
    } else {
      for (const driver of drivers) {
        await driver.quit().catch(() => undefined);
      }
    }
  }
});

function wrap(fn: TestFn): () => Promise<void> {
  return async () => {
    const page = await ensurePage();
    await fn({ page, request });
  };
}

function skip(name: string, fn?: TestFn): void {
  if (fn) it.skip(name, wrap(fn));
  else it.skip(name, () => undefined);
}

export const test: BrowserTest = Object.assign(
  ((name: string, fn: TestFn) => {
    it(name, wrap(fn));
  }) as BrowserTest,
  {
    beforeEach: (fn: TestFn) => {
      beforeEach(wrap(fn));
    },
    skip,
    info: () => ({ parallelIndex: 0 }),
  },
);

/**
 * Run a test that owns its WebDriver (e.g. extension context).
 * Register the driver (and optional closer) so afterEach always cleans up.
 */
export function testStandalone(
  name: string,
  fn: (register: {
    registerDriver: (driver: WebDriver, closer?: () => Promise<void>) => void;
  }) => Promise<void>,
): void {
  it(name, async () => {
    await fn({
      registerDriver: (driver, closer) => {
        standaloneDriver = driver;
        standaloneCloser = closer;
      },
    });
  });
}
