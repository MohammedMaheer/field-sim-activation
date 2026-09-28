import { test, expect } from "@playwright/test";
import { authenticate } from "./session";
import { previewBuild } from "./preview";

test("historical activation receipts remain clearly labelled in review", async ({ page }) => {
  await previewBuild(page);
  await authenticate(page);
  await page.goto("/kyc-capture");
  await page.getByLabel("Search reference", { exact: true }).fill("DEMO-REVIEW-1790601165337");
  await page.getByRole("button").filter({ hasText: "DEMO-REVIEW-1790601165337" }).click();
  await expect(page.getByRole("heading", { name: "Historical activation receipt" })).toBeVisible();
  await expect(page.getByText("Historical receipt details", { exact: true })).toBeVisible();
  await expect(page.getByText("Original image uploaded by the agent", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Historical activation receipt from/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payment successful" })).toHaveCount(0);
  await expect(page.getByLabel("Captured transaction summary")).toHaveCount(0);
  await page.screenshot({ path: "../output/qa/historical-review-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByLabel("Search reference", { exact: true }).fill("DEMO-REVIEW-1790601165337");
  await page.getByRole("button").filter({ hasText: "DEMO-REVIEW-1790601165337" }).click();
  await expect(page.getByRole("img", { name: /Historical activation receipt from/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historical receipt details" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "../output/qa/historical-review-390.png", fullPage: true });
});
