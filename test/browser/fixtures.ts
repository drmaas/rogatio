import type { WebDriver } from "selenium-webdriver";
import { afterEach, beforeEach, it } from "vitest";
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
let driverBorrowed = false;

async function ensurePage(): Promise<Page> {
  if (currentPage) return currentPage;
  currentDriver = await createDriver({ headless: true });
  currentPage = new Page(currentDriver);
  return currentPage;
}

beforeEach(() => {
  driverBorrowed = false;
  currentDriver = undefined;
  currentPage = undefined;
});

afterEach(async () => {
  const driver = currentDriver;
  currentDriver = undefined;
  currentPage = undefined;
  if (driver && !driverBorrowed) {
    await driver.quit().catch(() => undefined);
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

/** Run a test without the shared page fixture (owns its own WebDriver). */
export function testStandalone(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    driverBorrowed = true;
    await fn();
  });
}
