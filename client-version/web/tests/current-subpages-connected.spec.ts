import { expect, Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { businessDate } from "../src/businessTime";

test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(
        new URL(baseURL || "http://invalid").hostname,
      ),
    "Current data and export checks run against explicitly opted-in isolated QA",
  );
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.locator("input[type=email]").fill("admin@relay.demo");
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.locator("#workspace-content").getByRole("heading").first(),
  ).toBeVisible({ timeout: 20000 });
}

async function settled(page: Page, heading: string) {
  await expect(
    page.getByRole("heading", { name: new RegExp(`^${heading}`) }).first(),
  ).toBeVisible();
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator("#workspace-content .error-state")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("all current sales and supply sections remain usable at desktop and narrow widths", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.startsWith("/api/") &&
      response.status() >= 500
    )
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await signIn(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/sales");
    for (const [tab, heading] of [
      ["Sales", "Sales register"],
      ["No-sale feedback", "No-sale feedback"],
      ["Targets", "Targets"],
      ["Call work queue", "Ready to contact"],
      ["Status import", "Update sale statuses"],
      ["Sales staff", "Sales and call staff"],
      ["SR verification", "Daily SR verification"],
    ]) {
      await page
        .getByRole("navigation", { name: "Sales sections" })
        .getByRole("button", { name: tab, exact: true })
        .click();
      await settled(page, heading);
      await page.screenshot({
        path: info.outputPath(`${width}-sales-${tab.replaceAll(" ", "-")}.png`),
        animations: "disabled",
      });
    }
    await page.goto("/equipment");
    for (const [tab, heading] of [
      ["Stock register", "Asset register"],
      ["Requests", "Asset requests"],
      ["Balances & alerts", "Balances & shortage alerts"],
      ["Movements", "Stock movements"],
      ["Returns & transfers", "Stock return checklist"],
    ]) {
      await page
        .getByRole("navigation", { name: "Asset sections" })
        .getByRole("button", { name: new RegExp(`^${tab}`) })
        .click();
      await settled(page, heading);
      await page.screenshot({
        path: info.outputPath(
          `${width}-supplies-${tab.replaceAll(" ", "-")}.png`,
        ),
        animations: "disabled",
      });
    }
  }
  expect(errors).toEqual([]);
});

test("every current portal report downloads real CSV, Excel and PDF content with the shared filters", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await signIn(page);
  await page.goto("/reports");
  const branch = page.getByRole("combobox", { name: "Branch", exact: true });
  await expect.poll(() => branch.locator("option").count()).toBeGreaterThan(1);
  const branchId = await branch
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .find(Boolean),
    );
  expect(branchId).toBeTruthy();
  await branch.selectOption(branchId!);
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    businessDate(),
  );
  await expect(page.getByLabel("To date", { exact: true })).toHaveValue(
    businessDate(),
  );
  const report = page.getByLabel("Detailed report download", { exact: true });
  const reportChoice = report.getByRole("combobox", {
    name: "Report type",
    exact: true,
  });
  const reports = await reportChoice
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({
        id: (option as HTMLOptionElement).value,
        title: option.textContent!,
      })),
    );
  const reportCount = reports.length;
  expect(reportCount).toBe(8);
  let checked = 0;
  for (const { id, title } of reports) {
    await reportChoice.selectOption(id);
    for (const format of ["csv", "xlsx", "pdf"]) {
      const requested = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname.startsWith("/api/reports/") ||
          new URL(request.url()).pathname === "/api/incentives/final/export",
      );
      const downloaded = page.waitForEvent("download");
      await report
        .getByRole("combobox", { name: "Download report format", exact: true })
        .selectOption(format);
      await report
        .getByRole("button", { name: "Download report", exact: true })
        .click();
      const file = await downloaded;
      const bytes = await readFile((await file.path())!);
      expect(bytes.length, `${title} ${format} is nonempty`).toBeGreaterThan(0);
      expect(file.suggestedFilename()).toMatch(
        new RegExp(`^qanawat-.*\\.${format}$`),
      );
      if (format === "pdf")
        expect(bytes.subarray(0, 5).toString(), `${title} PDF signature`).toBe(
          "%PDF-",
        );
      if (format === "xlsx")
        expect(
          bytes.subarray(0, 2).toString(),
          `${title} Excel signature`,
        ).toBe("PK");
      if (format === "csv") {
        expect(bytes.toString("utf8")).not.toMatch(/<html|\{"detail"/i);
        expect(bytes.toString("utf8").split("\n")[0]).toMatch(
          /[,]|No matching records/,
        );
      }
      const query = new URL((await requested).url()).searchParams;
      expect(query.get("branch_id")).toBe(branchId);
      expect(query.get("start") || query.get("from_date")).toBe(businessDate());
      expect(query.get("end") || query.get("to_date")).toBe(businessDate());
      await file.saveAs(info.outputPath(file.suggestedFilename()));
      checked++;
      await expect(
        report.getByRole("button", { name: "Download report", exact: true }),
      ).toBeEnabled();
    }
  }
  expect(checked).toBe(reportCount * 3);
  const finalReport = page.locator(".report-card").filter({
    has: page.getByRole("heading", {
      name: "Incentive tracking",
      exact: true,
    }),
  });
  for (const format of ["csv", "xlsx", "pdf"]) {
    await finalReport
      .getByRole("combobox", {
        name: "Export incentive tracking format",
        exact: true,
      })
      .selectOption(format);
    const requested = page.waitForRequest(
      (r) => new URL(r.url()).pathname === "/api/incentives/final/export",
    );
    const downloaded = page.waitForEvent("download");
    await finalReport
      .getByRole("button", { name: "Export incentive tracking", exact: true })
      .click();
    const file = await downloaded,
      bytes = await readFile((await file.path())!);
    expect(bytes.length).toBeGreaterThan(0);
    const params = new URL((await requested).url()).searchParams;
    expect(params.get("from_date")).toBe(businessDate());
    expect(params.get("to_date")).toBe(businessDate());
    expect(params.get("branch_id")).toBe(branchId);
    if (format === "pdf") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    if (format === "xlsx") expect(bytes.subarray(0, 2).toString()).toBe("PK");
    if (format === "csv")
      expect(bytes.toString().split("\n")[0]).toContain(",");
    await file.saveAs(info.outputPath(file.suggestedFilename()));
  }
});
