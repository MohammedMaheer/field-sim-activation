import { test, expect } from "@playwright/test";
import { authenticate } from "./session";

test("branch selection scopes charts and team rosters; retired location routes stay absent", async ({
  page,
}) => {
  await authenticate(page);
  await expect(
    page.getByRole("link", { name: "Territories", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Branch performance", exact: true }),
  ).toBeVisible();
  const branch = page.getByRole("combobox", { name: "Branch", exact: true });
  await expect(branch.locator("option")).toHaveCount(3);
  await branch.selectOption({ label: "Abu Dhabi Region" });
  await expect(page.locator(".branch-team-card")).toHaveCount(1);
  await expect(page.locator(".branch-team-card")).toContainText("Mira Rowan");
  await page.getByRole("link", { name: "Branch teams", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption({ label: "Abu Dhabi Region" });
  await expect(
    page.getByRole("button", { name: "View Rayan Vale", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View Mira Rowan", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Abu Dhabi Region");
  await expect(page.getByRole("dialog")).not.toContainText("Zayn Mercer");
  await page.keyboard.press("Escape");
  await page.goto("/territories");
  await expect(
    page.getByRole("heading", { name: "Page not included" }),
  ).toBeVisible();
});

test("capture has three real stages without extra activation forms", async ({page}) => {
  await authenticate(page);
  await page.goto("/kyc-capture");
  const guide = page.getByRole("region", { name: "Transaction capture progress" });
  await expect(guide.locator("li")).toHaveCount(3);
  await expect(guide.locator('[aria-current="step"]')).toHaveText("1Capture transaction");
  await expect(guide).toContainText("complete identity, customer, plan and order details in Etisalat");
  await expect(guide.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Next stage"})).toHaveCount(0);
});
