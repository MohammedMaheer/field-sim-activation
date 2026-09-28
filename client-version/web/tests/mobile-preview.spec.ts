import { test, expect } from "@playwright/test";
test("isolated Flutter phone preview", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const apiCalls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiCalls.push(r.url());
  });
  await page.goto(
    process.env.MOBILE_PREVIEW_URL || "http://127.0.0.1:5188/mobile-demo/",
  );
  await expect(
    page.getByText("Your day, at a glance", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.screenshot({
    path: "../output/qa/phone-preview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("My field tasks", { exact: true })).toBeVisible();
  await page.getByText("Mark complete", { exact: true }).first().click();
  await page.getByRole("tab", { name: "Stock", exact: true }).click();
  await expect(page.getByText("My SIM stock", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  await expect(page.getByText("My workspace", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Receipts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New transaction" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Scan document", exact: true })
    .click();
  await page.waitForTimeout(800);
  await (await reveal("Continue")).click();
  await page
    .getByRole("button", { name: "Scan SIM barcode", exact: true })
    .click();
  await page.mouse.move(700, 80);
  await page.waitForTimeout(300);
  const phone = page.getByRole("textbox", {
    name: "Phone number",
    exact: true,
  });
  for (const [plan, detail] of [
    ["5G Unlimited Ultra", "Unlimited 5G Data + 1500 Flexi Mins"],
    ["Flexi Postpaid", "100GB 5G Data + 500 Local Mins"],
    ["Tourist Prepaid", "50GB High Speed + Free Roaming"],
    ["Enterprise M2M", "Telemetry VPN + Fixed IP"],
  ]) {
    const card = page.getByRole("button", { name: new RegExp(plan) }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(detail);
  }
  const touristPlan = page.getByRole("button", { name: /Tourist Prepaid/ }).first();
  await expect(touristPlan).toContainText("AED 199");
  await expect(touristPlan).not.toContainText("month");
  await page.screenshot({
    path: "../output/qa/phone-preview-sim-plans.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: /5G Unlimited Ultra/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  const pad = await revealText("Customer signature pad");
  const bounds = await pad.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.move(bounds!.x + 20, bounds!.y + 40);
  await page.mouse.down();
  for (let i = 1; i < 15; i++)
    await page.mouse.move(
      bounds!.x + 20 + i * 8,
      bounds!.y + 40 + (i % 3) * 10,
    );
  await page.mouse.up();
  await page.screenshot({
    path: "../output/qa/phone-preview-signature.png",
    fullPage: false,
  });
  await (await reveal("Continue")).click();
  await expect(page.getByText(/phone number/i)).toBeVisible();
  await expect(phone).toBeFocused();
  await expect(await reveal("Continue")).toBeEnabled();
  await page.screenshot({
    path: "../output/qa/phone-intake-missing-phone.png",
    fullPage: true,
  });
  await phone.click();
  await page.keyboard.type("SAMPLE-PHONE");
  await (await reveal("Continue")).click();

  const host = await page.locator("#flutter-host").boundingBox();
  await page.waitForTimeout(300);
  await (await reveal("Upload")).click();
  await page
    .getByRole("button", { name: "Upload receipt", exact: true })
    .click();
  await expect(
    page.getByText("Transaction rows", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Field name" }).first(),
  ).toBeAttached();
  await page.waitForTimeout(800);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "../output/qa/phone-preview-receipt.png",
    fullPage: true,
  });
  async function reveal(name: string) {
    const button = page.getByRole("button", { name, exact: true });
    for (let i = 0; i < 14; i++) {
      const b = await button.boundingBox({ timeout: 250 }).catch(() => null);
      const h = await page.locator("#flutter-host").boundingBox();
      if (b && h && b.y >= h.y && b.y + b.height <= h.y + h.height)
        return button;
      await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(100);
    }
    return button;
  }
  async function revealText(name: string) {
    const text = page.getByText(name, { exact: true });
    for (let i = 0; i < 14; i++) {
      const b = await text.boundingBox({ timeout: 250 }).catch(() => null);
      const h = await page.locator("#flutter-host").boundingBox();
      if (b && h && b.y >= h.y && b.y + b.height <= h.y + h.height - 120)
        return text;
      await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height * 0.65);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(100);
    }
    return text;
  }
  await page.waitForTimeout(800);
  await (await reveal("Save details")).click();
  const download = page.waitForEvent("download");
  await (await reveal("Share Excel")).click();
  expect((await download).suggestedFilename()).toMatch(/xlsx$/);
  await (await reveal("Submit for review")).click();
  await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2);
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(400);
  await expect(page.getByText(/Status: SUBMITTED/)).toBeAttached({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  for (const [button, heading] of [
    ["Customers", "Customer directory"],
    ["Daily report", "Daily report"],
    ["Incentives", "My incentives"],
    ["Need field support?", "Support"],
  ] as const) {
    await (await reveal(button)).click();
    await page.waitForTimeout(250);
    await expect(
      page.getByRole("button", { name: "Back", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../output/qa/phone-preview-${button.replace(/[^a-z]/gi, "")}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "↻ Start over", exact: true }).click();
  await expect(
    page.getByText("Your day, at a glance", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".phone").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../output/qa/phone-preview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "↗ Expand app", exact: true }).click();
  await expect(page.locator("body")).toHaveClass("expanded");
  await page.getByRole("button", { name: "Exit expanded view" }).click();
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
