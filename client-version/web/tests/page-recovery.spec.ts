import { test, expect } from "@playwright/test";
import { authenticate } from "./session";

test("a failed page keeps workspace navigation available and recovers on another page", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/resources/agents*", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    // A malformed record must not take down the entire signed-in workspace.
    await route.fulfill({ json: [{ ...rows[0], name: { invalid: true } }] });
  });
  await page.goto("/live");
  await expect(
    page.getByRole("heading", { name: "This page couldn’t be displayed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Return to overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This page couldn’t be displayed" }),
  ).toHaveCount(0);
  await page.unroute("**/api/resources/agents*");
  await page.goto("/live");
  await expect(
    page.getByRole("heading", { name: "This page couldn’t be displayed" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Live operations", exact: true }),
  ).toBeVisible();
});

test("a temporary request limit explains the wait and can be retried", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/commissions/summary?**", (route) =>
    route.fulfill({
      status: 429,
      contentType: "text/plain",
      headers: { "Retry-After": "60" },
      body: "Too many requests. Try again shortly.",
    }),
  );
  await page.goto("/incentives");
  const commission = page.locator(".commission-workspace");
  await expect(
    commission.getByText("Too many requests. Wait a minute and try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute("**/api/commissions/summary?**");
  await commission
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(
    commission.getByRole("button", { name: "Breakdown", exact: true }).first(),
  ).toBeVisible();
  await expect(commission.locator(".error-state")).toHaveCount(0);
});
