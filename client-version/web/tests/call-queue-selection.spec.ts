import {test, expect} from "@playwright/test";

const cases = [
  {account: "tele", stage: "TELE_VERIFICATION", status: "COMPLETED"},
  {account: "welcome", stage: "WELCOME_CALL", status: "BLOCKED"},
  {account: "tele", stage: "WELCOME_CALL", status: "PENDING"},
];
for (const scenario of cases) {
  test(`call notification selection cannot open ${scenario.status} ${scenario.stage} for ${scenario.account}`, async ({page}) => {
    await page.goto("/");
    await page.locator("input[type=email]").fill(`${scenario.account}@relay.demo`);
    await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
    await page.getByRole("button", {name: "Sign in to workspace"}).click();
    await expect(page.getByRole("heading", {name: "Call work queue", exact: true})).toBeVisible();
    await page.route("**/api/sales-management/call-tasks", route => route.fulfill({json: [{
      id: "selection-guard", sale_id: "selection-guard-sale", customer_name: "Sample customer",
      stage: scenario.stage, status: scenario.status, plan_name: "Sample plan", request_id: "sample-request",
      branch: "Sample branch", agent: "Sample agent", msisdn: "Not recorded", last_outcome: "Not recorded",
    }]}));
    await page.goto("/call-work?selected=selection-guard");
    await expect(page.getByRole("button", {name: "All", exact: true})).toHaveClass(/active/);
    await expect(page.locator(".call-task").first().getByRole("heading", {name: "Sample customer"})).toBeVisible();
    await expect(page.getByRole("form", {name: "Record call outcome"})).toHaveCount(0);
    await expect(page.getByRole("button", {name: "Save outcome", exact: true})).toHaveCount(0);
  });
}

test("cancelling a call notification selection keeps its form closed after refresh", async ({page}) => {
  await page.goto("/");
  await page.locator("input[type=email]").fill("tele@relay.demo");
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", {name: "Sign in to workspace"}).click();
  await expect(page.getByRole("heading", {name: "Call work queue", exact: true})).toBeVisible();
  await page.route("**/api/sales-management/call-tasks", route => route.fulfill({json: [{
    id: "selection-guard", sale_id: "selection-guard-sale", customer_name: "Sample customer",
    stage: "TELE_VERIFICATION", status: "PENDING", plan_name: "Sample plan", request_id: "sample-request",
    branch: "Sample branch", agent: "Sample agent", msisdn: "Not recorded", last_outcome: "Not recorded",
  }]}));
  await page.goto("/call-work?selected=selection-guard");
  await expect(page.getByRole("form", {name: "Record call outcome"})).toBeVisible();
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
  await expect(page).not.toHaveURL(/selected=/);
  await page.getByRole("button", {name: "Refresh", exact: true}).click();
  await expect(page.locator(".call-task").getByRole("heading", {name: "Sample customer"})).toBeVisible();
  await expect(page.getByRole("form", {name: "Record call outcome"})).toHaveCount(0);
});
