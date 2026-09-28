import { test, expect } from "@playwright/test";
import { previewBuild } from "./preview";
import { readFile } from "node:fs/promises";
import path from "node:path";
test("backend side-by-side review, correction and verification", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const login = await request.post("/api/auth/login", {
    data: {
      email: "agent1@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json(),
    headers = { Authorization: "Bearer " + auth.access_token };
  const me = await (await request.get("/api/auth/me", { headers })).json();
  const plans = await (
    await request.get("/api/resources/plans", { headers })
  ).json();
  const proof = (
    await readFile(path.resolve("tests/fixtures/transaction-sample.png"))
  ).toString("base64");
  const intake = {
    name: "Alex Sample",
    document_number: "SAMPLE-ID",
    nationality: "Sample",
    birth_date: "1990-01-01",
    expiry_date: "2030-01-01",
    document_image: proof,
    sim_identifier: "SAMPLE-SIM",
    plan_id: plans[0].id,
    msisdn: "SAMPLE-PHONE",
    signature: [Array.from({ length: 10 }, (_, i) => [i / 10, 0.5])],
  };
  const created = await request.post("/api/kyc-captures", {
    headers,
    data: {
      agent_id: me.agent_id,
      document_kind: "PAYMENT_CONFIRMATION",
      intake,
      operation_id: crypto.randomUUID(),
      source_reference: "PAY-REVIEW-" + Date.now(),
      image_base64: (
        await readFile(path.resolve("tests/fixtures/transaction-sample.png"))
      ).toString("base64"),
    },
  });
  expect(created.ok()).toBeTruthy();
  let capture = await created.json();
  const url = "/api/kyc-captures/" + capture.id;
  await expect
    .poll(
      async () => {
        capture = await (await request.get(url, { headers })).json();
        return capture.status;
      },
      { timeout: 60000 },
    )
    .toBe("EXTRACTED");
  const saved = await request.patch(url + "/rows", {
    headers,
    data: {
      version: capture.version,
      rows: capture.rows,
      reason: "Checked synthetic payment image",
    },
  });
  expect(saved.ok()).toBeTruthy();
  capture = await saved.json();
  expect(
    (
      await request.post(url + "/submit", {
        headers,
        data: { version: capture.version },
      })
    ).ok(),
  ).toBeTruthy();
  await previewBuild(page);
  await page.goto("/");
  await page.locator("input[type=email]").fill("compliance@relay.demo");
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  let imageAttempts = 0;
  await page.route("**/api/kyc-captures/*/original", (route) =>
    ++imageAttempts === 1
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.continue(),
  );
  await page.goto("/kyc-capture");
  await page
    .getByLabel("Search reference", { exact: true })
    .fill(capture.source_reference);
  await page
    .getByRole("button")
    .filter({ hasText: capture.source_reference })
    .click();
  await expect(
    page.getByRole("button", { name: "Verify submission", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry image", exact: true }).click();
  const image = page.getByRole("img", { name: /Payment confirmation from/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByText("Payment invoice", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment successful", exact: true }),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  expect((await pendingDownload).suggestedFilename()).toMatch(/\.pdf$/);
  await page.locator(".verified-receipt").scrollIntoViewIfNeeded();
  await page.waitForTimeout(850);
  await page.screenshot({ path: "../output/qa/receipt-pending-desktop.png" });
  await expect(
    page.getByRole("button", { name: "Verify submission", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Zoom in image" }).click();
  await expect(page.getByRole("button", { name: "Fit image" })).toHaveText(
    "125%",
  );
  await page.getByRole("button", { name: "Fit image" }).click();
  await page.getByRole("tab", { name: /Text from image/ }).click();
  await expect(page.locator(".review-raw-lines")).toContainText("Jordan Demo");
  await page.getByRole("tab", { name: "Payment fields" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  expect((await dl).suggestedFilename()).toMatch(/xlsx$/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/backend-review-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Please confirm the payment amount against the receipt.");
  await page
    .getByRole("button", { name: "Request correction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Returned for correction" }),
  ).toBeVisible();
  capture = await (await request.get(url, { headers })).json();
  expect(capture.status).toBe("REJECTED");
  capture = await (
    await request.patch(url + "/rows", {
      headers,
      data: {
        version: capture.version,
        rows: capture.rows,
        reason: "Agent confirmed amount",
      },
    })
  ).json();
  await request.post(url + "/submit", {
    headers,
    data: { version: capture.version },
  });
  await expect(
    page.getByLabel(
      "I checked the image against the customer, SIM and captured details.",
    ),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Original payment image and captured details match.");
  await page
    .getByLabel("I checked the image against the customer, SIM and captured details.")
    .check();
  await page
    .getByRole("button", { name: "Verify submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment verified", exact: true }),
  ).toBeVisible();
  expect((await (await request.get(url, { headers })).json()).status).toBe(
    "VERIFIED",
  );
  await expect(
    page.getByRole("heading", {
      name: "Payment successful",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".verified-receipt").scrollIntoViewIfNeeded();
  await page.waitForTimeout(850);
  await page.screenshot({ path: "../output/qa/receipt-verified-phone.png" });
  await page.evaluate(() => {
    (window as any).printed = false;
    window.print = () => {
      (window as any).printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Print invoice", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).printed)).toBeTruthy();
});
