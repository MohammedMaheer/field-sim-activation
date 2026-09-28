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
  await expect(page.getByRole("alert")).toContainText("Required to continue");
  await page
    .getByLabel("Identity document", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/transaction-sample.png"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await page.screenshot({
    path: "../output/qa/web-intake-scanning-390.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await page.getByLabel("Full name", { exact: true }).fill("Alex Sample");
  await page
    .getByLabel("Document number", { exact: true })
    .fill("SAMPLE-ID-001");
  await page.getByLabel("Nationality", { exact: true }).fill("Sample");
  await page.getByLabel("Date of birth", { exact: true }).fill("1990-01-01");
  await page.getByLabel("Expiry date", { exact: true }).fill("2030-01-01");
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
    .getByLabel("SIM serial / ICCID", { exact: true })
    .fill("SAMPLE-SIM-001");
  await page.locator(".intake-plans button").first().click();
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
    page.getByLabel("Source transaction reference", { exact: true }),
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
