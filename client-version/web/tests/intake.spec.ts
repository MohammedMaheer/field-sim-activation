import { test, expect } from "@playwright/test";
import { authenticate } from "./session";
import path from "node:path";
test("identity and signature gate receipt submission", async ({ page }) => {
  await authenticate(page);
  await page.goto("/kyc-capture");
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer identity", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Document wasn");
  await page
    .getByLabel("Identity document", { exact: true })
    .setInputFiles(path.resolve("../mobile/assets/demo/identity.png"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await page.screenshot({
    path: "../output/qa/web-intake-scanning-390.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await page.locator(".identity-capture-actions").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../output/qa/web-intake-identity-controls-390.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByLabel("Full name", {exact:true})).toHaveValue("Avery Stone");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/intake-identity-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "SIM & plan", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "SIM & plan", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.locator(".intake-plans button")).toHaveCount(4);
  for (const [name, details] of [
    ["5G Unlimited Ultra", "Unlimited 5G Data + 1500 Flexi Mins"],
    ["Flexi Postpaid", "100GB 5G Data + 500 Local Mins"],
    ["Tourist Prepaid", "50GB High Speed + Free Roaming"],
    ["Enterprise M2M", "Telemetry VPN + Fixed IP"],
  ]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(details, { exact: true })).toBeVisible();
  }
  await expect(page.locator(".intake-plans button").nth(2)).toContainText("AED 199");
  await expect(page.locator(".intake-plans button").nth(2)).not.toContainText("month");
  expect(
    await page
      .locator(".intake-plans button")
      .evaluateAll((cards) =>
        cards.every((card) => card.scrollWidth <= card.clientWidth),
      ),
  ).toBeTruthy();
  await page.locator(".intake-plans").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../output/qa/web-intake-sim-plans-viewport-390.png",
  });
  await page.screenshot({
    path: "../output/qa/web-intake-sim-plans-390.png",
    fullPage: true,
  });
  await page
    .getByLabel("SIM serial / ICCID", { exact: true })
    .fill("SAMPLE-SIM-001");
  await page.getByRole("button", { name: /5G Unlimited Ultra/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("phone number");
  await expect(page.getByRole("alert")).toContainText("customer signature");
  await expect(page.getByLabel("Phone number", { exact: true })).toBeFocused();
  const canvas = page.locator("canvas");
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 50);
  await page.mouse.down();
  for (let i = 1; i < 14; i++)
    await page.mouse.move(box.x + 20 + i * 8, box.y + 50 + (i % 3) * 8);
  await page.mouse.up();
  await page.screenshot({
    path: "../output/qa/intake-sim-390.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("phone number");
  await expect(page.getByLabel("Phone number", { exact: true })).toBeFocused();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "../output/qa/web-intake-missing-phone-390.png",
    fullPage: true,
  });
  await page.getByLabel("Phone number", { exact: true }).fill("SAMPLE-PHONE");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByLabel("Payment reference (optional)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Kiosk reference", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "../output/qa/intake-receipt-390.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Activation confirmed", exact: true }),
  ).toHaveCount(0);
});
