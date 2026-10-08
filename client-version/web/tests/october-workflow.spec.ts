import { test, expect, Page } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";
import { writeFile } from "node:fs/promises";

async function adminLogin(page: Page) {
  await page.goto("/");
  await page.locator("input[type=email]").fill("admin@relay.demo");
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
}

test("phone sale without receipt reaches independent review and SR reconciliation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240000);
  let capture: any;
  page.on("response", async (response) => {
    if (
      new URL(response.url()).pathname ===
        "/api/kyc-captures/sale-submissions" &&
      response.ok()
    )
      capture = await response.json();
  });
  await mobileSignIn(page);
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Document captured View", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Scan order", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Document captured View", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: "../output/qa/october-phone-order.png" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Submit sale", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Submit sale", exact: true }).click();
  await expect.poll(() => capture?.status).toBe("SUBMITTED");
  expect(capture.payment_record_status).toBe("NOT_RECORDED");
  expect(capture.sr_verification.status).toBe("PENDING_SR_VERIFICATION");
  await page.waitForTimeout(2400);
  await page.screenshot({
    path: "../output/qa/october-phone-sale-receipt.png",
  });
  await writeFile("../output/qa/october-browser-capture-id.txt", capture.id);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await adminLogin(admin);
  await admin.goto("/kyc-capture");
  await admin
    .getByRole("button", { name: new RegExp(capture.source_reference) })
    .first()
    .click();
  await expect(
    admin.getByRole("heading", { name: "Customer & order details", exact: true }),
  ).toBeVisible();
  await admin
    .getByRole("button", { name: "Customer details", exact: true })
    .click();
  await expect(admin.locator('img[alt*="Customer"]')).toBeVisible();
  await admin
    .getByRole("button", { name: "Order details", exact: true })
    .click();
  await expect(admin.locator('img[alt*="Order"]')).toBeVisible();
  await admin.screenshot({
    path: "../output/qa/october-backend-comparison.png",
    fullPage: true,
  });
  await admin.getByRole("checkbox", { name: /I checked/ }).check();
  await admin
    .getByRole("textbox", { name: "Review note" })
    .fill(
      "Synthetic customer and order evidence compared; no payment confirmation required.",
    );
  await admin
    .getByRole("button", { name: "Verify submission", exact: true })
    .click();
  await expect(
    admin.getByText(/Transaction confirmed by backend/),
  ).toBeVisible();
  await admin.goto("/sales");
  await admin
    .getByRole("button", { name: "SR verification", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Daily SR verification" }),
  ).toBeVisible();
  await admin
    .getByLabel("Daily SR report")
    .setInputFiles({
      name: "daily-sr.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("sr_number,status\nOTHER-SR,CLOSED\n"),
    });
  await admin.getByRole("button", { name: "Preview matches" }).click();
  await expect(
    admin.getByRole("button", { name: "Apply verification" }),
  ).toBeVisible();
  await admin.screenshot({
    path: "../output/qa/october-sr-preview.png",
    fullPage: true,
  });
  await admin.getByRole("button", { name: "Apply verification" }).click();
  await expect(
    admin.getByText("SR verification saved", { exact: true }),
  ).toBeVisible();
  const auth = await request.post("/api/auth/login", {
    data: {
      email: "admin@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(auth.ok()).toBeTruthy();
  const token = (await auth.json()).access_token;
  const updated = await request.get(`/api/kyc-captures/${capture.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const record = await updated.json();
  expect(record.invoice.sale_status).toBe("CLOSED");
  expect(record.sr_verification.status).toBe("PENDING_SR_VERIFICATION");
  await adminContext.close();
});

test("approved incentives and global Sales Manager views stay readable and read only", async ({
  page,
  browser,
}) => {
  await adminLogin(page);
  await page.goto("/incentives");
  await expect(
    page.getByRole("heading", { name: "Commission calculations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configure", exact: true }).first(),
  ).toBeVisible();
  await page.getByText("Approved incentive tables", { exact: true }).click();
  await page
    .locator(".commission-policy summary")
    .filter({ hasText: "MBO staff" })
    .click();
  await page.screenshot({
    path: "../output/qa/october-incentive-tables.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Configure", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Policy", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Approval note")).toBeVisible();
  await page.screenshot({
    path: "../output/qa/october-commission-configuration.png",
  });
  const context = await browser.newContext();
  const manager = await context.newPage();
  await manager.goto("/");
  await manager.locator("input[type=email]").fill("salesmanager@relay.demo");
  await manager
    .locator("input[type=password]")
    .fill(process.env.DEMO_PASSWORD!);
  await manager.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(manager.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await manager.goto("/incentives");
  await expect(
    manager.getByRole("heading", { name: "Commission calculations" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "Configure", exact: true }),
  ).toHaveCount(0);
  await manager.goto("/sales");
  await expect(
    manager.getByRole("heading", { name: "Sales register" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "SR verification", exact: true }),
  ).toHaveCount(0);
  await expect(
    manager.getByRole("button", { name: "Record sale", exact: true }),
  ).toHaveCount(0);
  await manager.setViewportSize({ width: 390, height: 844 });
  expect(
    await manager.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await manager.screenshot({
    path: "../output/qa/october-sales-manager-phone.png",
    fullPage: true,
  });
  await context.close();
});
