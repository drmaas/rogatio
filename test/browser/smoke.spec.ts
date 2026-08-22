import { expect, test } from "@playwright/test";

test("loads the browser smoke artifact", async ({ page }) => {
  await page.goto("/browser-fixture.html");
  await expect(page.locator("#result")).toHaveText("sanity -> smoke");
});
