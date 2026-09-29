import { test, expect } from "@playwright/test";
for (const action of ["Scan document", "Upload photo"]) {
  test(`${action} animates identity capture and advances to SIM allocation`, async ({
    page,
  }) => {
    await page.goto(
      process.env.MOBILE_PREVIEW_URL || "http://127.0.0.1:5176/mobile-demo/",
    );
    await expect(
      page.getByText("Your day, at a glance", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await page.getByRole("tab", { name: "Capture", exact: true }).click();
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(
      page.getByText(/Capturing document|Uploading photo/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Document captured View", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../output/qa/document41-${action.replaceAll(" ", "-")}.png`,
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Scan SIM barcode", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Subscriber plan", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "../output/qa/document41-sim-stage.png" });
    if (action === "Upload photo") {
      await page
        .getByRole("button", { name: "Scan SIM barcode", exact: true })
        .click();
      await page.getByRole("button", { name: /5G Unlimited Ultra/ }).first().click();
      await page
        .getByRole("button", { name: "Add customer signature", exact: true })
        .click();
      const pad = page.getByText("Customer signature pad", { exact: true });
      const box = (await pad.boundingBox())!;
      await page.mouse.move(box.x + 30, box.y + 70);
      await page.mouse.down();
      for (let i = 1; i < 20; i++)
        await page.mouse.move(box.x + 30 + i * 8, box.y + 70 + (i % 4) * 5);
      await page.mouse.up();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Upload", exact: true }),
      ).toBeVisible({ timeout: 5000 });
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Upload payment confirmation",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("group", {
            name: /Payment successful Pending verification/,
          })
          .first(),
      ).toBeVisible();
      await page.waitForTimeout(2300);
      await page.screenshot({ path: "../output/qa/document41-invoice.png" });
    }
  });
}
