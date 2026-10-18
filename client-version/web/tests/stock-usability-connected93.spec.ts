import { expect, test } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";

test("mobile keeps a rejected stock request, retries it and receives the admin decision", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname),
    "Synthetic mutations require the isolated QA service",
  );
  test.setTimeout(150000);
  await mobileSignIn(page);
  await page.getByRole("tab", { name: "Stock", exact: true }).click();
  await page
    .getByRole("button", { name: "Assets & supplies", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Request stock", exact: true })
    .click();
  const reason = `Shared usability request ${Date.now()}`;
  await page.getByRole("textbox", { name: "Reason", exact: true }).fill(reason);
  let reject = true;
  await page.route("**/api/field-assets/requests", async (route) => {
    if (reject && route.request().method() === "POST") {
      reject = false;
      return route.fulfill({
        status: 409,
        json: { detail: "Check the request and try again." },
      });
    }
    return route.continue();
  });
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(
    page
      .locator("#flutter-host")
      .getByText("Check the request and try again.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toHaveValue(reason);
  const stored = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/field-assets/requests" &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  const created = await (await stored).json();
  await expect(page.getByText(new RegExp(reason))).toBeVisible();
  const context = await browser.newContext();
  const admin = await context.newPage();
  try {
    await admin.goto("/");
    await admin.locator("input[type=email]").fill("admin@relay.demo");
    await admin
      .locator("input[type=password]")
      .fill(process.env.DEMO_PASSWORD!);
    await admin
      .getByRole("button", { name: "Sign in to workspace", exact: true })
      .click();
    await expect(admin.locator("input[type=password]")).toBeHidden();
    await admin.goto("/equipment?tab=requests");
    const row = admin.locator("tbody tr").filter({ hasText: reason });
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = admin.getByRole("dialog", {
      name: "Approve stock request",
      exact: true,
    });
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Checked and approved for this branch");
    const decision = admin.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `/api/field-assets/requests/${created.id}` &&
        r.request().method() === "PATCH",
    );
    await dialog
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    expect((await decision).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(
      row.getByRole("cell", { name: "Approved", exact: true }),
    ).toBeVisible();
    await admin.screenshot({
      path: "../output/qa/usability93-connected-admin.png",
    });
    await expect(
      page.getByText(new RegExp(`${reason}.*Normal · Approved`, "s")),
    ).toBeVisible({ timeout: 35000 });
    await page.screenshot({
      path: "../output/qa/usability93-connected-mobile.png",
    });
  } finally {
    await context.close();
  }
});
