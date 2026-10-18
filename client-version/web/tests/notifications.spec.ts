import { test, expect } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";
async function login(page: any, account = "admin") {
  await page.goto("/");
  await page.locator("input[type=email]").fill(`${account}@relay.demo`);
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  const signedIn = page.waitForResponse(
    (response: any) =>
      new URL(response.url()).pathname === "/api/auth/login" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  const response = await signedIn;
  expect(response.status()).toBe(200);
  await expect(page.locator("input[type=password]")).toBeHidden();
  return response.json();
}
test("inbox categories read state reload and scoped links", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Notifications/ }),
  ).toBeVisible();
  await expect(page.locator(".notification-row").first()).toBeVisible();
  await page.screenshot({ path: "../output/qa/notifications-desktop.png" });
  for (const category of [
    "Transactions",
    "Calls",
    "Stock",
    "Support",
    "Workspace",
  ]) {
    await page
      .locator(".notification-filters")
      .getByRole("button", { name: new RegExp(`^${category}`) })
      .click();
    await expect(
      page
        .locator(".notification-filters")
        .getByRole("button", { name: new RegExp(`^${category}`) }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page
    .locator(".notification-filters")
    .getByRole("button", { name: /^Transactions/ })
    .click();
  const row = page.locator(".notification-row").first();
  const title = await row.locator("strong").innerText();
  await row.getByRole("button", { name: /^Mark / }).click();
  await page.reload();
  await page
    .locator(".notification-filters")
    .getByRole("button", { name: /^Transactions/ })
    .click();
  await expect(
    page.locator(".notification-row").filter({ hasText: title }).first(),
  ).toBeVisible();
  await page.locator(".notification-open").first().click();
  await expect(page).toHaveURL(/kyc-capture\?capture=|sales\?selected=/);
  await page.goto("/notifications");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "../output/qa/notifications-narrow.png" });
});
for (const account of [
  "agent1",
  "leader",
  "salesmanager",
  "tele",
  "welcome",
  "compliance",
])
  test(`${account} has a working notifications inbox`, async ({ page }) => {
    const session = await login(page, account);
    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", { name: /Notifications/ }),
    ).toBeVisible();
    await expect(page.getByText("Could not load")).toHaveCount(0);
    const response = await page.request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(response.status()).toBe(200);
    expect(Array.isArray((await response.json()).items)).toBe(true);
  });
test("phone demo inbox handles empty categories and opens available records", async ({
  page,
}) => {
  test.setTimeout(120000);
  await mobileSignIn(page);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByRole("switch", { name: "Unread only" })).toBeVisible({
    timeout: 15000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "../output/qa/notifications-phone.png" });
  const auth = await page.request.post("/api/auth/login", {
    data: {
      email: "agent1@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  const headers = {
    Authorization: `Bearer ${(await auth.json()).access_token}`,
  };
  const items = (
    await (await page.request.get("/api/notifications", { headers })).json()
  ).items;
  const target =
    items.find((row: any) => row.category === "Transactions") ||
    items.find((row: any) => row.mobile_path);
  await page
    .getByRole("checkbox", {
      name: target?.category || "Transactions",
      exact: true,
    })
    .click();
  await expect(page.getByRole("switch", { name: "Unread only" })).toBeVisible();
  if (!target) {
    await expect(
      page.getByText("You’re all caught up", { exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "All", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "Unread only" }),
    ).toBeVisible();
    return;
  }
  const label = target.title + " " + target.category + " " + target.message;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByRole("group", { name: new RegExp(escaped) })
    .first()
    .click();
  await expect
    .poll(async () => {
      const data = await (
        await page.request.get("/api/notifications", { headers })
      ).json();
      return data.items.find((row: any) => row.id === target.id)?.read;
    })
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeHidden();
});
