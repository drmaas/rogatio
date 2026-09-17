import {
  By,
  Key,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";
import { type Assertion, expect as vitestExpect } from "vitest";
import { resolveUrl } from "./driver.js";

const DEFAULT_TIMEOUT_MS = 10_000;

async function cdp(
  driver: WebDriver,
  command: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const chromium = driver as WebDriver & {
    sendDevToolsCommand(
      cmd: string,
      parameters: Record<string, unknown>,
    ): Promise<unknown>;
  };
  return chromium.sendDevToolsCommand(command, params);
}

type RoleOptions = {
  name?: string | RegExp;
  exact?: boolean;
};

type FilterOptions = {
  hasText?: string | RegExp;
  has?: Locator;
};

function nameMatches(
  text: string,
  name: string | RegExp | undefined,
  exact: boolean | undefined,
): boolean {
  if (name === undefined) return true;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (typeof name === "string") {
    const expected = name.replace(/\s+/g, " ").trim();
    return exact === false
      ? normalized.includes(expected)
      : normalized === expected;
  }
  return name.test(normalized);
}

function serializeInitScript(
  script: string | ((...args: never[]) => unknown),
  arg?: unknown,
): string {
  if (typeof script === "string") {
    return script;
  }
  if (arg === undefined) {
    return `(${script.toString()})();`;
  }
  return `(${script.toString()})(${JSON.stringify(arg)});`;
}

export class Locator {
  constructor(
    readonly driver: WebDriver,
    private readonly resolveAll: () => Promise<WebElement[]>,
    private readonly description: string,
    /** When set, `filter({ has })` can query descendants by CSS. */
    readonly cssSelector?: string,
  ) {}

  locator(selector: string): Locator {
    return new Locator(
      this.driver,
      async () => {
        const parents = await this.resolveAll();
        const found: WebElement[] = [];
        for (const parent of parents) {
          const children = await parent.findElements(By.css(selector));
          found.push(...children);
        }
        return found;
      },
      `${this.description} >> ${selector}`,
      selector,
    );
  }

  getByRole(role: string, options: RoleOptions = {}): Locator {
    return new Locator(
      this.driver,
      async () => {
        const parents = await this.resolveAll();
        const found: WebElement[] = [];
        for (const parent of parents) {
          const candidates = await parent.findElements(
            By.css(roleSelector(role)),
          );
          for (const el of candidates) {
            const accessible = await accessibleName(el);
            if (nameMatches(accessible, options.name, options.exact)) {
              found.push(el);
            }
          }
        }
        return found;
      },
      `${this.description} >> role=${role}`,
    );
  }

  getByLabel(label: string, options: { exact?: boolean } = {}): Locator {
    return new Locator(
      this.driver,
      async () => {
        const parents = await this.resolveAll();
        const found: WebElement[] = [];
        for (const parent of parents) {
          const matches = await findByLabel(
            parent,
            label,
            options.exact !== false,
          );
          found.push(...matches);
        }
        return found;
      },
      `${this.description} >> label=${label}`,
    );
  }

  getByText(text: string | RegExp, options: { exact?: boolean } = {}): Locator {
    const exact = options.exact === true;
    return new Locator(
      this.driver,
      async () => {
        const parents = await this.resolveAll();
        const found: WebElement[] = [];
        for (const parent of parents) {
          const matches = await findTextMatches(parent, text, exact);
          found.push(...matches);
        }
        return found;
      },
      `${this.description} >> text=${String(text)}`,
    );
  }

  filter(options: FilterOptions): Locator {
    const hasCss = options.has?.cssSelector;
    return new Locator(
      this.driver,
      async () => {
        const elements = await this.resolveAll();
        const out: WebElement[] = [];
        for (const el of elements) {
          if (options.hasText !== undefined) {
            const text = await el.getText();
            if (!nameMatches(text, options.hasText, false)) continue;
          }
          if (options.has) {
            let nested: WebElement[];
            if (hasCss) {
              nested = await el.findElements(By.css(hasCss));
            } else {
              nested = await options.has.resolveAllWithin(el);
            }
            if (nested.length === 0) continue;
          }
          out.push(el);
        }
        return out;
      },
      `${this.description} >> filter`,
    );
  }

  /** Resolve this locator relative to a parent element (for `filter({ has })`). */
  async resolveAllWithin(parent: WebElement): Promise<WebElement[]> {
    if (this.cssSelector) {
      return parent.findElements(By.css(this.cssSelector));
    }
    // Fall back: run resolveAll and keep elements that are descendants of parent.
    const all = await this.resolveAll();
    const out: WebElement[] = [];
    for (const el of all) {
      const inside = await this.driver.executeScript<boolean>(
        "return arguments[0].contains(arguments[1]);",
        parent,
        el,
      );
      if (inside) out.push(el);
    }
    return out;
  }

  first(): Locator {
    return new Locator(
      this.driver,
      async () => {
        const all = await this.resolveAll();
        return all.slice(0, 1);
      },
      `${this.description} >> first`,
      this.cssSelector,
    );
  }

  nth(index: number): Locator {
    return new Locator(
      this.driver,
      async () => {
        const all = await this.resolveAll();
        return all[index] ? [all[index]] : [];
      },
      `${this.description} >> nth=${index}`,
      this.cssSelector,
    );
  }

  async element(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WebElement> {
    try {
      const found = await this.driver.wait(
        async (): Promise<WebElement | null> => {
          try {
            const all = await this.resolveAll();
            return all[0] ?? null;
          } catch {
            return null;
          }
        },
        timeoutMs,
      );
      if (!found) {
        throw new Error(`Locator not found: ${this.description}`);
      }
      return found;
    } catch {
      throw new Error(`Locator not found: ${this.description}`);
    }
  }

  async elements(): Promise<WebElement[]> {
    try {
      return await this.resolveAll();
    } catch {
      return [];
    }
  }

  async visibleElements(): Promise<WebElement[]> {
    const all = await this.elements();
    const visible: WebElement[] = [];
    for (const el of all) {
      try {
        if (await el.isDisplayed()) visible.push(el);
      } catch {
        // stale
      }
    }
    return visible;
  }

  async count(): Promise<number> {
    return (await this.visibleElements()).length;
  }

  async fill(value: string): Promise<void> {
    await this.waitClickable();
    // Re-resolve after focus: editor re-renders on input and stales elements.
    const apply = async (next: string) => {
      const el = await this.element();
      await this.driver.executeScript(
        `const el = arguments[0];
         const value = arguments[1];
         el.focus();
         const proto = el instanceof HTMLTextAreaElement
           ? window.HTMLTextAreaElement.prototype
           : window.HTMLInputElement.prototype;
         const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
         if (descriptor?.set) descriptor.set.call(el, value);
         else el.value = value;
         el.dispatchEvent(new Event("input", { bubbles: true }));
         el.dispatchEvent(new Event("change", { bubbles: true }));`,
        el,
        next,
      );
    };
    await apply("");
    await apply(value);
  }

  async click(): Promise<void> {
    const el = await this.waitClickable();
    try {
      await this.driver.executeScript(
        "arguments[0].scrollIntoView({block:'center',inline:'nearest'})",
        el,
      );
      await el.click();
    } catch {
      const fresh = await this.element();
      await this.driver.executeScript("arguments[0].click()", fresh);
    }
  }

  async check(): Promise<void> {
    await this.waitClickable();
    const el = await this.element();
    const checked = await this.driver.executeScript<boolean>(
      "return arguments[0].checked === true;",
      el,
    );
    if (!checked) {
      await this.driver.executeScript("arguments[0].click()", el);
    }
  }

  async focus(): Promise<void> {
    const el = await this.element();
    await this.driver.executeScript("arguments[0].focus()", el);
  }

  async selectOption(
    option: string | { label?: string; value?: string },
  ): Promise<void> {
    const el = await this.element();
    if (typeof option === "string") {
      const value = option;
      await this.driver.executeScript(
        `const el = arguments[0];
         el.value = arguments[1];
         el.dispatchEvent(new Event("input", { bubbles: true }));
         el.dispatchEvent(new Event("change", { bubbles: true }));`,
        el,
        value,
      );
      return;
    }
    if (option.value !== undefined) {
      await this.driver.executeScript(
        `const el = arguments[0];
         el.value = arguments[1];
         el.dispatchEvent(new Event("input", { bubbles: true }));
         el.dispatchEvent(new Event("change", { bubbles: true }));`,
        el,
        option.value,
      );
      return;
    }
    if (option.label !== undefined) {
      await this.driver.executeScript(
        `const el = arguments[0];
         const label = arguments[1];
         const match = Array.from(el.options).find((o) => o.text === label);
         if (!match) throw new Error("option not found: " + label);
         el.value = match.value;
         el.dispatchEvent(new Event("input", { bubbles: true }));
         el.dispatchEvent(new Event("change", { bubbles: true }));`,
        el,
        option.label,
      );
    }
  }

  async getAttribute(name: string): Promise<string | null> {
    const el = await this.element();
    // Prefer the raw DOM attribute (Selenium getAttribute resolves URLs / booleans).
    const raw = await this.driver.executeScript<string | null>(
      `return arguments[0].getAttribute(arguments[1]);`,
      el,
      name,
    );
    return raw;
  }

  async inputValue(): Promise<string> {
    const el = await this.element();
    return (await el.getAttribute("value")) ?? "";
  }

  async boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    const els = await this.elements();
    if (!els[0]) return null;
    const rect = await this.driver.executeScript<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(
      `const r = arguments[0].getBoundingClientRect();
       return { x: r.x, y: r.y, width: r.width, height: r.height };`,
      els[0],
    );
    return rect;
  }

  async evaluate<T>(
    fn: (element: Element, ...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ): Promise<T> {
    const el = await this.element();
    return executeAsync(this.driver, fn, el, ...args);
  }

  async evaluateAll<T>(
    fn: (elements: Element[], ...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ): Promise<T> {
    const els = await this.elements();
    if (args.length === 0) {
      return this.driver.executeScript(
        `return (${fn.toString()})(Array.prototype.slice.call(arguments));`,
        ...els,
      ) as Promise<T>;
    }
    return this.driver.executeScript(
      `const all = Array.prototype.slice.call(arguments);
       const extra = all.slice(${els.length});
       const elements = all.slice(0, ${els.length});
       return (${fn.toString()})(elements, ...extra);`,
      ...els,
      ...args,
    ) as Promise<T>;
  }

  async setInputFiles(
    files:
      | string
      | string[]
      | { name: string; mimeType: string; buffer: Buffer },
  ): Promise<void> {
    const el = await this.element();
    if (typeof files === "string") {
      await el.sendKeys(files);
      return;
    }
    if (Array.isArray(files)) {
      await el.sendKeys(files.join("\n"));
      return;
    }
    // Buffer upload: write temp file then send path.
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "rogatio-upload-"));
    const path = join(dir, files.name);
    await writeFile(path, files.buffer);
    await el.sendKeys(path);
  }

  async waitVisible(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WebElement> {
    try {
      const found = await this.driver.wait(
        async (): Promise<WebElement | null> => {
          const els = await this.elements();
          for (const el of els) {
            try {
              if (await el.isDisplayed()) return el;
            } catch {
              // stale
            }
          }
          return null;
        },
        timeoutMs,
      );
      if (!found) {
        throw new Error(`Not visible: ${this.description}`);
      }
      return found;
    } catch {
      throw new Error(`Not visible: ${this.description}`);
    }
  }

  async waitHidden(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    try {
      await this.driver.wait(async () => {
        const els = await this.elements();
        for (const el of els) {
          try {
            if (await el.isDisplayed()) return false;
          } catch {
            // Stale → treat as hidden.
          }
        }
        return true;
      }, timeoutMs);
    } catch {
      throw new Error(`Still visible: ${this.description}`);
    }
  }

  async waitClickable(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WebElement> {
    const el = await this.waitVisible(timeoutMs);
    await this.driver.wait(until.elementIsEnabled(el), timeoutMs);
    return el;
  }

  async textContent(): Promise<string> {
    const el = await this.element();
    return el.getText();
  }

  toString(): string {
    return this.description;
  }
}

function roleSelector(role: string): string {
  switch (role) {
    case "button":
      return 'button, [role="button"], input[type="button"], input[type="submit"]';
    case "heading":
      return 'h1, h2, h3, h4, h5, h6, [role="heading"]';
    case "main":
      return 'main, [role="main"]';
    case "alert":
      return '[role="alert"], [data-alert]';
    case "alertdialog":
      return '[role="alertdialog"], dialog[open]';
    case "textbox":
      return 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, [role="textbox"]';
    default:
      return `[role="${role}"]`;
  }
}

async function accessibleName(el: WebElement): Promise<string> {
  return el.getDriver().executeScript<string>(
    `const el = arguments[0];
     const aria = el.getAttribute("aria-label");
     if (aria) return aria;
     if (el.labels && el.labels.length) {
       return Array.from(el.labels).map(l => l.textContent || "").join(" ").trim();
     }
     return (el.innerText || el.textContent || el.value || "").trim();`,
    el,
  );
}

async function findByLabel(
  root: WebElement,
  label: string,
  exact: boolean,
): Promise<WebElement[]> {
  return root.getDriver().executeScript<WebElement[]>(
    `const root = arguments[0];
     const labelText = arguments[1];
     const exact = arguments[2];
     const normalize = (s) => (s || "").replace(/\\s+/g, " ").trim();
     const match = (s) => exact ? normalize(s) === labelText : normalize(s).includes(labelText);
     const labelName = (lab) => {
       const clone = lab.cloneNode(true);
       for (const control of clone.querySelectorAll("input, textarea, select, button")) {
         control.remove();
       }
       return normalize(clone.textContent);
     };
     const out = [];
     for (const lab of root.querySelectorAll("label")) {
       if (!match(labelName(lab))) continue;
       const forId = lab.getAttribute("for");
       if (forId) {
         const target = root.querySelector("#" + CSS.escape(forId));
         if (target) out.push(target);
       } else {
         const control = lab.querySelector("input, textarea, select");
         if (control) out.push(control);
       }
     }
     for (const el of root.querySelectorAll("[aria-label]")) {
       if (match(el.getAttribute("aria-label"))) out.push(el);
     }
     return out;`,
    root,
    label,
    exact,
  );
}

async function findTextMatches(
  root: WebElement,
  text: string | RegExp,
  exact: boolean,
): Promise<WebElement[]> {
  const isRegex = text instanceof RegExp;
  return root.getDriver().executeScript<WebElement[]>(
    `const root = arguments[0];
     const needle = arguments[1];
     const exact = arguments[2];
     const isRegex = arguments[3];
     const flags = arguments[4];
     const normalize = (s) => (s || "").replace(/\\s+/g, " ").trim();
     const matcher = isRegex ? new RegExp(needle, flags) : null;
     const matches = (own) => {
       if (!own) return false;
       if (matcher) return matcher.test(own);
       return exact ? own === needle : own.includes(needle);
     };
     const out = [];
     const scope = root.querySelectorAll ? root : document.body;
     for (const el of scope.querySelectorAll("*")) {
       const own = normalize(el.textContent);
       if (!matches(own)) continue;
       let childMatch = false;
       for (const child of el.querySelectorAll("*")) {
         if (matches(normalize(child.textContent))) {
           childMatch = true;
           break;
         }
       }
       if (!childMatch) out.push(el);
     }
     return out;`,
    root,
    isRegex ? text.source : text,
    exact,
    isRegex,
    isRegex ? text.flags : "",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeAsync<T>(
  driver: WebDriver,
  fn: (...args: never[]) => T | Promise<T>,
  ...args: unknown[]
): Promise<T> {
  const result = (await driver.executeAsyncScript(
    `
    const fn = ${fn.toString()};
    const callback = arguments[arguments.length - 1];
    const args = Array.prototype.slice.call(arguments, 0, -1);
    Promise.resolve(fn.apply(null, args)).then(
      (value) => callback({ ok: true, value }),
      (error) =>
        callback({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    `,
    ...args,
  )) as { ok: boolean; value?: T; message?: string };
  if (!result.ok) {
    throw new Error(result.message ?? "page.evaluate failed");
  }
  return result.value as T;
}

export class Page {
  readonly keyboard = {
    press: async (key: string): Promise<void> => {
      const mapped =
        key === "Enter"
          ? Key.ENTER
          : key === "Escape"
            ? Key.ESCAPE
            : key === "Tab"
              ? Key.TAB
              : key;
      await this.driver.switchTo().activeElement().sendKeys(mapped);
    },
  };

  private readonly pageErrors: string[] = [];
  private readonly initScripts: string[] = [];
  private errorListenerAttached = false;

  constructor(readonly driver: WebDriver) {}

  async on(event: "pageerror", handler: (error: Error) => void): Promise<void> {
    if (event !== "pageerror") return;
    await this.attachErrorListener(handler);
  }

  private async attachErrorListener(
    handler: (error: Error) => void,
  ): Promise<void> {
    if (this.errorListenerAttached) return;
    this.errorListenerAttached = true;
    await cdp(this.driver, "Runtime.enable", {});
    // Poll console exceptions via injected handler.
    await cdp(this.driver, "Page.addScriptToEvaluateOnNewDocument", {
      source: `window.addEventListener("error", (e) => {
        window.__rogatioPageErrors = window.__rogatioPageErrors || [];
        window.__rogatioPageErrors.push(String(e.message || e.error || e));
      });
      window.addEventListener("unhandledrejection", (e) => {
        window.__rogatioPageErrors = window.__rogatioPageErrors || [];
        window.__rogatioPageErrors.push(String(e.reason));
      });`,
    });
    // Sync collected errors into handler on demand via evaluate hooks.
    const originalPush = this.pageErrors.push.bind(this.pageErrors);
    this.pageErrors.push = (...items: string[]) => {
      for (const item of items) handler(new Error(item));
      return originalPush(...items);
    };
  }

  async drainPageErrors(): Promise<void> {
    const errors = (await this.driver.executeScript(
      `const e = window.__rogatioPageErrors || [];
       window.__rogatioPageErrors = [];
       return e;`,
    )) as string[];
    for (const message of errors) {
      this.pageErrors.push(message);
    }
  }

  context(): {
    grantPermissions: (permissions: string[]) => Promise<void>;
  } {
    return {
      grantPermissions: async (permissions: string[]) => {
        const origin = BASE_URL_FROM_DRIVER(this.driver);
        await cdp(this.driver, "Browser.grantPermissions", {
          origin: origin ?? "http://127.0.0.1:4173",
          permissions: permissions.map((p) =>
            p === "clipboard-read"
              ? "clipboardReadWrite"
              : p === "clipboard-write"
                ? "clipboardSanitizedWrite"
                : p,
          ),
        }).catch(async () => {
          // Fallback for Chrome versions that use different permission names.
          await cdp(this.driver, "Browser.grantPermissions", {
            origin: "http://127.0.0.1:4173",
            permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
          });
        });
      },
    };
  }

  async addInitScript(
    script: string | ((...args: never[]) => unknown),
    arg?: unknown,
  ): Promise<void> {
    const source = serializeInitScript(script, arg);
    this.initScripts.push(source);
    await cdp(this.driver, "Page.addScriptToEvaluateOnNewDocument", {
      source,
    });
  }

  async goto(path: string): Promise<void> {
    await this.driver.get(resolveUrl(path));
    await this.drainPageErrors();
  }

  locator(selector: string): Locator {
    return new Locator(
      this.driver,
      async () => this.driver.findElements(By.css(selector)),
      selector,
      selector,
    );
  }

  getByRole(role: string, options: RoleOptions = {}): Locator {
    return new Locator(
      this.driver,
      async () => {
        const candidates = await this.driver.findElements(
          By.css(roleSelector(role)),
        );
        const found: WebElement[] = [];
        for (const el of candidates) {
          const accessible = await accessibleName(el);
          if (nameMatches(accessible, options.name, options.exact)) {
            found.push(el);
          }
        }
        return found;
      },
      `role=${role} name=${String(options.name)}`,
    );
  }

  getByLabel(label: string, options: { exact?: boolean } = {}): Locator {
    return new Locator(
      this.driver,
      async () => {
        const body = await this.driver.findElement(By.css("body"));
        return findByLabel(body, label, options.exact !== false);
      },
      `label=${label}`,
    );
  }

  getByText(text: string | RegExp, options: { exact?: boolean } = {}): Locator {
    const exact = options.exact === true;
    return new Locator(
      this.driver,
      async () => {
        const body = await this.driver.findElement(By.css("body"));
        return findTextMatches(body, text, exact);
      },
      `text=${String(text)}`,
    );
  }

  async evaluate<T>(
    fn: (...args: never[]) => T | Promise<T>,
    ...args: unknown[]
  ): Promise<T> {
    await this.drainPageErrors();
    return executeAsync(this.driver, fn, ...args);
  }

  async setViewportSize(size: {
    width: number;
    height: number;
  }): Promise<void> {
    await this.driver.manage().window().setRect({
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
  }

  async emulateMedia(_options: {
    forcedColors?: string;
    reducedMotion?: string;
  }): Promise<void> {
    // Best-effort: apply CSS media emulation via CDP when available.
    try {
      await cdp(this.driver, "Emulation.setEmulatedMedia", {
        features: [
          { name: "forced-colors", value: "active" },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });
    } catch {
      // Optional for layout tests.
    }
  }

  async waitForCondition(
    predicate: () => Promise<boolean>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    await this.driver.wait(async () => {
      try {
        return await predicate();
      } catch {
        return false;
      }
    }, timeoutMs);
  }

  /** @deprecated Prefer waitForCondition / until — kept for rare live-gated stubs. */
  async waitForTimeout(ms: number): Promise<void> {
    await sleep(ms);
  }
}

function BASE_URL_FROM_DRIVER(_driver: WebDriver): string | undefined {
  return "http://127.0.0.1:4173";
}

class LocatorAssertion {
  constructor(
    private readonly locator: Locator,
    private readonly negated: boolean,
  ) {}

  get not(): LocatorAssertion {
    return new LocatorAssertion(this.locator, !this.negated);
  }

  async toBeVisible(): Promise<void> {
    if (this.negated) {
      await this.locator.waitHidden();
      return;
    }
    await this.locator.waitVisible();
  }

  async toBeHidden(): Promise<void> {
    if (this.negated) {
      await this.locator.waitVisible();
      return;
    }
    await this.locator.waitHidden();
  }

  async toHaveText(expected: string | string[] | RegExp): Promise<void> {
    await this.assertText(expected, true);
  }

  async toContainText(expected: string | RegExp): Promise<void> {
    await this.assertText(expected, false);
  }

  private async assertText(
    expected: string | string[] | RegExp,
    exact: boolean,
  ): Promise<void> {
    let last = "";
    try {
      await this.locator.driver.wait(async () => {
        try {
          const els = await this.locator.visibleElements();
          if (Array.isArray(expected)) {
            const texts = await Promise.all(els.map((el) => el.getText()));
            last = texts.join(" | ");
            const ok =
              texts.length === expected.length &&
              texts.every((t, i) => t.includes(expected[i] ?? ""));
            return ok === !this.negated;
          }
          const text = els[0] ? await els[0].getText() : "";
          last = text;
          const ok =
            typeof expected === "string"
              ? exact
                ? text === expected
                : text.includes(expected)
              : expected.test(text);
          return ok === !this.negated;
        } catch {
          return false;
        }
      }, DEFAULT_TIMEOUT_MS);
    } catch {
      throw new Error(
        `Expected ${this.negated ? "not " : ""}text ${String(expected)}, got ${JSON.stringify(last)} for ${this.locator}`,
      );
    }
  }

  async toHaveValue(expected: string): Promise<void> {
    let last = "";
    try {
      await this.locator.driver.wait(async () => {
        try {
          last = await this.locator.inputValue();
          return (last === expected) === !this.negated;
        } catch {
          return false;
        }
      }, DEFAULT_TIMEOUT_MS);
    } catch {
      throw new Error(
        `Expected value ${expected}, got ${JSON.stringify(last)} for ${this.locator}`,
      );
    }
  }

  async toHaveAttribute(name: string, value?: string): Promise<void> {
    let last: string | null = null;
    try {
      await this.locator.driver.wait(async () => {
        try {
          last = await this.locator.getAttribute(name);
          let ok: boolean;
          if (value === undefined) {
            ok = last !== null;
          } else if (value === "" && last !== null) {
            ok = last === "" || last === name || last === "true";
          } else {
            ok = last === value;
          }
          return ok === !this.negated;
        } catch {
          return false;
        }
      }, DEFAULT_TIMEOUT_MS);
    } catch {
      throw new Error(
        `Expected attribute ${name}=${value}, got ${last} for ${this.locator}`,
      );
    }
  }

  async toHaveCount(expected: number): Promise<void> {
    let last = -1;
    try {
      await this.locator.driver.wait(async () => {
        last = await this.locator.count();
        return (last === expected) === !this.negated;
      }, DEFAULT_TIMEOUT_MS);
    } catch {
      throw new Error(
        `Expected count ${expected}, got ${last} for ${this.locator}`,
      );
    }
  }

  async toBeDisabled(): Promise<void> {
    const el = await this.locator.element();
    const disabled = !(await el.isEnabled());
    vitestExpect(disabled).toBe(!this.negated);
  }

  async toBeEnabled(): Promise<void> {
    const el = await this.locator.element();
    const enabled = await el.isEnabled();
    vitestExpect(enabled).toBe(!this.negated);
  }

  async toBeFocused(): Promise<void> {
    const el = await this.locator.element();
    const focused = await this.locator.driver.executeScript(
      "return document.activeElement === arguments[0]",
      el,
    );
    vitestExpect(focused).toBe(!this.negated);
  }

  async toBeChecked(): Promise<void> {
    let last = false;
    try {
      await this.locator.driver.wait(async () => {
        try {
          const el = await this.locator.element();
          last = await this.locator.driver.executeScript<boolean>(
            "return arguments[0].checked === true;",
            el,
          );
          return last === !this.negated;
        } catch {
          return false;
        }
      }, DEFAULT_TIMEOUT_MS);
    } catch {
      vitestExpect(last).toBe(!this.negated);
    }
  }
}

type PollAssertion = {
  not: {
    toBe: (expected: unknown) => Promise<void>;
  };
  toBe: (expected: unknown) => Promise<void>;
};

function createPoll(fn: () => Promise<unknown>): PollAssertion {
  const run = async (expected: unknown, negated: boolean) => {
    let last: unknown;
    try {
      // Use a short-lived Chrome session wait via Promise race with clock —
      // polls are for CSS animation; driver.wait needs a driver. Use sleep
      // only here as animation timing aid.
      const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        last = await fn();
        if (Object.is(last, expected) === !negated) return;
        await sleep(50);
      }
    } catch {
      // fall through
    }
    throw new Error(
      `poll() expected ${negated ? "not " : ""}${String(expected)}, got ${String(last)}`,
    );
  };
  return {
    toBe: (expected) => run(expected, false),
    not: {
      toBe: (expected) => run(expected, true),
    },
  };
}

type ExpectFn = {
  (locator: Locator): LocatorAssertion;
  <T>(actual: T): Assertion<T>;
  poll: (fn: () => Promise<unknown>) => PollAssertion;
};

export const expect = Object.assign(
  (target: unknown) => {
    if (target instanceof Locator) {
      return new LocatorAssertion(target, false);
    }
    return vitestExpect(target);
  },
  {
    poll: (fn: () => Promise<unknown>): PollAssertion => createPoll(fn),
  },
) as ExpectFn;

export const request = {
  async get(path: string): Promise<{
    ok(): boolean;
    text(): Promise<string>;
    headers(): Record<string, string>;
  }> {
    const response = await fetch(resolveUrl(path));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = await response.text();
    return {
      ok: () => response.ok,
      text: async () => body,
      headers: () => headers,
    };
  },
};
