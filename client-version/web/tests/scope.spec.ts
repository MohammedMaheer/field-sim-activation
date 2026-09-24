import { test, expect } from "@playwright/test";
import { authenticate, remember } from "./session";
import path from "node:path";

test.beforeEach(async ({ page }) => authenticate(page));
test.afterEach(async ({ page }) => remember(page));

test("proposal navigation and historical record details", async ({ page }) => {
  for (const name of [
    "Field tasks",
    "Customers",
    "KYC transactions",
    "SIM inventory",
    "Incentives",
    "Support",
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Orders", "Settings", "Outlets", "eKYC verification"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Activations", exact: true }).click();
  await page
    .getByRole("button", { name: /^View RLY/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Lifecycle timeline");
  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: "KYC transactions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /KYC transaction capture/i }),
  ).toBeVisible();
  await expect(
    page.getByText("Etisalat", { exact: false }).first(),
  ).toBeVisible();
});

test("task, incentive and support actions are saved", async ({ page }) => {
  const stamp = Date.now().toString();
  await page.getByRole("link", { name: "Field tasks", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel("Task title").fill("Synthetic proposal QA " + stamp);
  await page.getByRole("button", { name: "Assign task" }).click();
  await expect(page.getByText("Synthetic proposal QA " + stamp)).toBeVisible();
  const task = page
    .locator(".proposal-task")
    .filter({ hasText: "Synthetic proposal QA " + stamp });
  const completed = page.waitForResponse(
    (r) =>
      r.url().includes("/api/field-tasks/") && r.request().method() === "PATCH",
  );
  await task.getByRole("button", { name: "Complete" }).click();
  expect((await completed).status()).toBe(200);
  await page
    .getByRole("textbox", { name: "Search tasks" })
    .fill("Synthetic proposal QA " + stamp);
  await page.getByRole("combobox", { name: "Task status" }).selectOption("ALL");
  await expect(task).toContainText("done");

  await page.getByRole("link", { name: "Incentives", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Incentives", exact: true }),
  ).toBeVisible();
  const incentiveAgent = page.getByRole("combobox", {
    name: "Agent",
    exact: true,
  });
  await expect(incentiveAgent.locator("option")).toHaveCount(13);
  await incentiveAgent.selectOption({ label: "Zayn Mercer · RLY-1041" });
  await expect(incentiveAgent).not.toHaveValue("");
  await page.getByLabel("Amount (AED)").fill("47.25");
  await page.getByLabel("Reason / note").fill("Synthetic proposal QA " + stamp);
  await expect(
    page.getByRole("combobox", { name: "Agent", exact: true }),
  ).not.toHaveValue("");
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/api/incentives") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save entry" }).click();
  expect((await saved).status()).toBe(201);
  await expect(
    page.getByRole("cell", { name: "Synthetic proposal QA " + stamp }),
  ).toBeVisible();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);

  await page.getByRole("link", { name: "Support", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Support & help" }),
  ).toBeVisible();
  const supportAgent = page.getByRole("combobox", {
    name: "Agent",
    exact: true,
  });
  await expect(supportAgent.locator("option")).toHaveCount(13);
  await supportAgent.selectOption({ label: "Zayn Mercer" });
  await page.getByLabel("Subject").fill("Synthetic support QA " + stamp);
  await page
    .getByLabel("Details")
    .fill("Testing proposal field support workflow");
  await expect(supportAgent).not.toHaveValue("");
  const opened = page.waitForResponse(
    (r) =>
      r.url().includes("/api/support-tickets") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send request" }).click();
  expect((await opened).status()).toBe(201);
  const ticket = page
    .locator(".proposal-task")
    .filter({ hasText: "Synthetic support QA " + stamp });
  await expect(ticket).toBeVisible();
  await ticket
    .getByLabel("Response for Synthetic support QA " + stamp)
    .fill("Issue resolved in QA");
  await ticket.getByRole("button", { name: "Resolve" }).click();
  await expect(ticket).toContainText("Issue resolved in QA");
});

test("CSV and compliance PDF downloads", async ({ page }) => {
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toHaveCount(9);
  for (const format of ["CSV", "PDF"]) {
    const dl = page.waitForEvent("download");
    await page
      .getByRole("button", { name: format, exact: true })
      .first()
      .click();
    expect((await dl).suggestedFilename()).toMatch(
      new RegExp("\\." + format.toLowerCase() + "$"),
    );
  }
});

test("Excel incentive upload validates and appears in history", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Incentives", exact: true }).click();
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/incentives/import") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Upload incentive CSV or Excel" })
    .setInputFiles(path.resolve("tests/fixtures/incentives-proposal.xlsx"));
  expect((await imported).status()).toBe(201);
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Synthetic imported incentive");
  await expect(
    page.getByRole("cell", { name: "Synthetic imported incentive" }),
  ).toBeVisible();
});

test("proposal views fit desktop, tablet and mobile web", async ({ page }) => {
  for (const route of [
    "/live",
    "/team-leaders",
    "/kyc-capture",
    "/field-tasks",
    "/incentives",
    "/support",
    "/audit",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Operations overview" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    if (width === 390) {
      const recent = page.locator('.dashboard-records > button').first();
      await expect(recent).toBeVisible();
      await expect(recent.locator('.badge')).toBeVisible();
      expect(await recent.evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBeTruthy();
    }
    await page.screenshot({
      path: "../output/qa/proposal-web-" + width + ".png",
      fullPage: true,
    });
  }
});
