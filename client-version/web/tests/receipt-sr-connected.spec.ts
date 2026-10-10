import { test, expect } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";

test("mobile receipt SR extraction reaches the same administrator record", async ({
  page,
  browser,
  request,
}) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1",
    "Isolated QA database only",
  );
  test.setTimeout(240000);
  let receipt: any, capture: any, submitted: any;
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname;
    if (!response.ok()) return;
    if (path === "/api/kyc-captures/receipt-fields")
      receipt = await response.json();
    if (path === "/api/kyc-captures/sale-submissions") {
      submitted = response.request().postDataJSON();
      capture = await response.json();
    }
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
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect
    .poll(() => receipt?.fields?.sr_number, { timeout: 60000 })
    .toMatch(/^SAMPLE-SR-/);
  expect(receipt.sr_check).toBeTruthy();
  await expect(
    page.getByRole("group", {
      name: /Review & submit sale.*SR number read from receipt/,
    }),
  ).toBeVisible();
  await page.getByRole("region", { name: "Interactive phone" }).hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  await expect(
    page.getByRole("button", { name: "Submit sale", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "../output/qa/latest-real-mobile-receipt-sr.png",
  });
  await page.getByRole("button", { name: "Submit sale", exact: true }).click();
  await expect
    .poll(() => capture?.status, { timeout: 60000 })
    .toBe("SUBMITTED");
  expect(submitted.intake.sr_number).toBe(receipt.fields.sr_number);
  expect(submitted.intake.receipt_sr_check).toBe(receipt.sr_check);
  expect(submitted.intake.payment_image).toBeTruthy();
  expect(capture.payment_record_status).toBe("RECORDED");
  expect(capture.sr_verification.status).toBe("PENDING_SR_VERIFICATION");
  expect(capture.activation_label).toBe("Activated · pending SR verification");
  const login = await request.post("/api/auth/login", {
    data: {
      email: "admin@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const stored = await request.get(`/api/kyc-captures/${capture.id}`, {
    headers: { Authorization: `Bearer ${(await login.json()).access_token}` },
  });
  expect(stored.ok(), await stored.text()).toBeTruthy();
  const record = await stored.json();
  expect(record.intake.sr_number).toBe(receipt.fields.sr_number);
  expect(record.intake.receipt_sr_check).toBe(receipt.sr_check);
  expect(record.intake.payment_image).toBe(submitted.intake.payment_image);
  expect(record.intake.order_reference).not.toBe(record.intake.sr_number);
  const context = await browser.newContext();
  const admin = await context.newPage();
  await admin.goto("/");
  await admin.locator("input[type=email]").fill("admin@relay.demo");
  await admin.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await admin
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: /^Operations overview/ }),
  ).toBeVisible();
  await admin.goto(`/kyc-capture?capture=${capture.id}`);
  await admin
    .getByRole("button", { name: "Payment receipt", exact: true })
    .click();
  await expect(
    admin
      .getByRole("tabpanel")
      .getByText(receipt.fields.sr_number, { exact: true }),
  ).toBeVisible();
  await expect(admin.locator(".review-comparison img")).toBeVisible();
  await admin
    .getByRole("tabpanel")
    .getByText(receipt.fields.sr_number, { exact: true })
    .scrollIntoViewIfNeeded();
  await admin.waitForTimeout(450);
  await admin.screenshot({
    path: "../output/qa/latest-real-admin-receipt-sr.png",
  });
  await context.close();
});
