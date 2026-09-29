import { test, expect } from "@playwright/test";
import { authenticate } from "./session";
import { readFile } from "node:fs/promises";
import path from "node:path";
test("payment invoice and backend activation remain connected", async ({
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
  const plans = await (
    await request.get("/api/resources/plans", { headers })
  ).json();
  const image = (
    await readFile(path.resolve("tests/fixtures/transaction-sample.png"))
  ).toString("base64");
  const identityImage = (
    await readFile(path.resolve("../mobile/assets/demo/identity.png"))
  ).toString("base64");
  const identityResponse = await request.post(
    "/api/kyc-captures/read-document",
    {
      headers,
      data: { image_base64: identityImage },
    },
  );
  expect(identityResponse.ok()).toBeTruthy();
  const identity = await identityResponse.json();
  expect(identity.document_check).toBeTruthy();
  const made = await request.post("/api/kyc-captures", {
    headers,
    data: {
      document_kind: "PAYMENT_CONFIRMATION",
      operation_id: crypto.randomUUID(),
      agent_id: auth.user.agent_id,
      source_reference: "PAY-QA-" + Date.now(),
      image_base64: image,
      intake: {
        ...identity,
        nationality: "Sample",
        document_image: identityImage,
        sim_identifier: "QA-UNLISTED-SIM",
        plan_id: plans[0].id,
        msisdn: "SAMPLE-PHONE",
        signature: [Array.from({ length: 10 }, (_, i) => [i / 10, 0.5])],
      },
    },
  });
  expect(made.ok()).toBeTruthy();
  let capture = await made.json();
  const url = "/api/kyc-captures/" + capture.id;
  expect(capture.invoice.heading).toBe("Payment successful");
  await expect
    .poll(
      async () => {
        capture = await (await request.get(url, { headers })).json();
        return ["EXTRACTED", "OCR_FAILED"].includes(capture.status);
      },
      { timeout: 60000 },
    )
    .toBeTruthy();
  let saved = await request.patch(url + "/rows", {
    headers,
    data: {
      version: capture.version,
      rows: [
        {
          fields: [
            { label: "Total paid", value: "AED 350.00" },
            { label: "Payment method", value: "Card" },
          ],
        },
      ],
      reason: "Checked uploaded payment",
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
  await authenticate(page);
  await page.goto("/kyc-capture");
  await page
    .getByLabel("Search reference", { exact: true })
    .fill(capture.source_reference);
  await page
    .getByRole("button")
    .filter({ hasText: capture.source_reference })
    .click();
  await expect(
    page.getByRole("img", { name: /Payment confirmation from/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Identity document", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Identity document", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel")).toContainText("Alex Synthetic");
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await expect(
    page
      .getByRole("img", { name: "Captured customer signature", exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Payment confirmation", exact: true })
    .click();
  await page.getByText("Payment invoice", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment successful", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".invoice-sections")).toContainText("Not recorded");
  await page
    .getByRole("button", { name: "Replay invoice printing", exact: true })
    .click();
  const paper = page.locator(".verified-receipt");
  await page.waitForTimeout(500);
  const feeding = await paper.evaluate((el) => getComputedStyle(el).transform);
  expect(feeding).not.toBe("none");
  expect(feeding).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({ path: "../output/qa/invoice-39-web-printing.png" });
  await page.waitForTimeout(2000);
  expect(await paper.evaluate((el) => getComputedStyle(el).transform)).toBe(
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(850);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/payment-review-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Original payment and identity details match");
  await page
    .getByLabel(
      "I checked the image against the customer, SIM and captured details.",
    )
    .check();
  await page
    .getByRole("button", { name: "Verify submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Backend activation", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Carrier activation reference", { exact: true })
    .fill("EXTERNAL-QA-123");
  await page
    .getByLabel("Completion note", { exact: true })
    .fill("Completed in carrier system");
  await page
    .getByRole("button", { name: "Record completed activation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Activation completed", exact: true }),
  ).toBeVisible();
  const invoiceDetails = page
    .locator("details")
    .filter({ has: page.getByText("Payment invoice", { exact: true }) });
  if (!((await invoiceDetails.getAttribute("open")) !== null))
    await page.getByText("Payment invoice", { exact: true }).click();
  await expect(page.locator(".invoice-sections")).toContainText("ACTIVATED");
  await expect(page.locator(".invoice-sections")).toContainText(
    "EXTERNAL-QA-123",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".verified-receipt").scrollIntoViewIfNeeded();
  await page.waitForTimeout(850);
  await page.screenshot({ path: "../output/qa/payment-invoice-paper.png" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../output/qa/payment-completed-desktop.png",
    fullPage: true,
  });
  await page.goto("/administration");
  await expect(
    page.getByRole("heading", { name: "Field network" }),
  ).toBeVisible();
  await page.waitForTimeout(850);
  await page.screenshot({
    path: "../output/qa/admin-simplified-desktop.png",
    fullPage: true,
  });
});
