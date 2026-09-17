/**
 * Thin BasePage for Selenium explicit waits (skill POM pattern).
 * Specs still use the Playwright-compat Page/Locator surface; shared wait
 * helpers live here for incremental page-object extraction.
 */
import {
  type Locator,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";

const DEFAULT_TIMEOUT_MS = 10_000;

export class BasePage {
  constructor(
    protected readonly driver: WebDriver,
    protected readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async findElement(locator: Locator): Promise<WebElement> {
    await this.driver.wait(until.elementLocated(locator), this.timeoutMs);
    return this.driver.findElement(locator);
  }

  async clickElement(locator: Locator): Promise<void> {
    const element = await this.findElement(locator);
    await this.driver.wait(until.elementIsVisible(element), this.timeoutMs);
    await this.driver.wait(until.elementIsEnabled(element), this.timeoutMs);
    await element.click();
  }

  async enterText(locator: Locator, text: string): Promise<void> {
    const element = await this.findElement(locator);
    await this.driver.wait(until.elementIsVisible(element), this.timeoutMs);
    await this.driver.wait(until.elementIsEnabled(element), this.timeoutMs);
    await element.clear();
    await element.sendKeys(text);
  }
}
