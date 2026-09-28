import { test, expect } from "@playwright/test";
import { authenticate } from "./session";

test("administrator manages plans and field selections stay in sync", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Subscriber plans" }).click();
  await expect(page.getByRole("heading", { name: "Subscriber plans" })).toBeVisible();
  await expect(page.locator(".managed-plan").first()).toBeVisible();
  expect(await page.locator(".managed-plan").count()).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../output/qa/plan-management-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const closeMenu = page.getByRole("button", { name: "Close menu" });
  if (await closeMenu.isVisible()) await closeMenu.evaluate((button) => (button as HTMLButtonElement).click());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../output/qa/plan-management-phone.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const card = page.locator(".managed-plan").filter({ hasText: "5G Unlimited Ultra" });
  await card.getByRole("button", { name: "Edit plan" }).click();
  await page.getByLabel("Price (AED)").fill("359");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.locator(".toast")).toContainText("available in the field app");
  await expect(card).toContainText("AED 359");

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card.getByText("removed", { exact: true })).toBeVisible();
  const active = await page.request.get("/api/public/plans");
  expect((await active.json()).some((p: { name: string }) => p.name === "5G Unlimited Ultra")).toBeFalsy();

  await card.getByRole("button", { name: "Restore" }).click();
  await expect(card.getByText("available", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Edit plan" }).click();
  await page.getByLabel("Price (AED)").fill("350");
  await page.getByRole("button", { name: "Save plan" }).click();

  await page.getByRole("button", { name: "Add plan" }).click();
  const temporaryName = `QA Temporary ${Date.now()}`;
  await page.getByLabel("Plan name").fill(temporaryName);
  await page.getByLabel("Price (AED)").fill("49");
  await page.getByLabel("Data allowance (GB)").fill("5");
  await page.getByRole("button", { name: "Save plan" }).click();
  const created = page.locator(".managed-plan").filter({ hasText: temporaryName });
  await expect(created).toContainText("AED 49");
  page.once("dialog", (dialog) => dialog.accept());
  await created.getByRole("button", { name: "Remove" }).click();
  await expect(created.getByText("removed", { exact: true })).toBeVisible();

  await page.goto("/agents");
  await page.getByRole("button", { name: "Add agent" }).click();
  const email = page.getByLabel("Sign-in email");
  const password = page.locator('input[name="password"]');
  await expect(email).toBeVisible();
  const emailBox = await email.boundingBox();
  const passwordBox = await password.boundingBox();
  expect(emailBox && passwordBox).toBeTruthy();
  expect(Math.abs(emailBox!.y - passwordBox!.y)).toBeLessThan(2);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../output/qa/agent-credentials-aligned-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  if (await closeMenu.isVisible()) await closeMenu.evaluate((button) => (button as HTMLButtonElement).click());
  await password.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../output/qa/agent-credentials-aligned-phone.png" });
});
