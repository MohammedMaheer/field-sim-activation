import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

const rows = [
  {
    sale_id: "matched-sale",
    customer_name: "Matched customer",
    agent: "Sales one",
    branch: "Marina Branch",
    branch_id: "marina",
    sr_number: "SR-100",
    to: "MATCHED",
    reason: "SR matched the daily report",
    comparison: {
      recorded_sr: "SR-100",
      recorded_request_id: "REQ-100",
      recorded_status: "CLOSED",
      report_available: true,
      sr_result: "MATCHED",
      request_id_result: "MATCHED",
      report_row: {
        sr_number: "SR-100",
        request_id: "REQ-100",
        status: "CLOSED",
        row_number: 2,
      },
      related_report_rows: [],
    },
  },
  {
    sale_id: "request-mismatch",
    customer_name: "Different request",
    agent: "Sales two",
    branch: "Marina Branch",
    branch_id: "marina",
    sr_number: "SR-200",
    to: "MISMATCH",
    reason: "SR matched but the report's request ID differs",
    comparison: {
      recorded_sr: "SR-200",
      recorded_request_id: "REQ-200",
      recorded_status: "CLOSED",
      report_available: true,
      sr_result: "MATCHED",
      request_id_result: "MISMATCH",
      report_row: {
        sr_number: "SR-200",
        request_id: "REQ-OTHER",
        status: "CLOSED",
        row_number: 3,
      },
      related_report_rows: [],
    },
  },
  {
    sale_id: "missing-sr",
    customer_name: "Wrong SR customer",
    agent: "Sales three",
    branch: "Downtown Branch",
    branch_id: "downtown",
    sr_number: "SR-WRONG",
    to: "MISMATCH",
    reason: "SR not found in the selected day's report",
    comparison: {
      recorded_sr: "SR-WRONG",
      recorded_request_id: "REQ-300",
      recorded_status: "CLOSED",
      report_available: true,
      sr_result: "NOT_IN_REPORT",
      request_id_result: "NOT_COMPARED",
      report_row: null,
      related_report_rows: [
        {
          sr_number: "SR-CORRECT",
          request_id: "REQ-300",
          status: "CLOSED",
          row_number: 4,
        },
      ],
    },
  },
  {
    sale_id: "pending-sale",
    customer_name: "Pending customer",
    agent: "Sales four",
    branch: "Marina Branch",
    branch_id: "marina",
    sr_number: "",
    to: "PENDING_SR_VERIFICATION",
    reason: "SR number not recorded on the sale",
    comparison: {
      recorded_sr: null,
      recorded_request_id: "REQ-400",
      recorded_status: "CLOSED",
      report_available: false,
      sr_result: "NOT_CHECKED",
      request_id_result: "NOT_COMPARED",
      report_row: null,
      related_report_rows: [],
    },
  },
];

async function setup(
  page: Page,
  options: {
    manager?: boolean;
    legacy?: boolean;
    branch?: string;
    missingSrAfterReport?: boolean;
  } = {},
) {
  await previewBuild(page);
  if (options.branch)
    await page.addInitScript(
      (branch) => sessionStorage.setItem("relay.branch.sr-admin", branch),
      options.branch,
    );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-sr-comparison",
        user: {
          id: "sr-admin",
          name: "SR reviewer",
          role: options.manager ? "Sales Manager" : "Administrator",
          permissions: options.manager
            ? ["read", "report.read"]
            : ["read", "compliance.write", "settings.write"],
        },
      };
    else if (path === "/api/resources/branches")
      data = [
        { id: "marina", name: "Marina Branch" },
        { id: "downtown", name: "Downtown Branch" },
      ];
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path.endsWith("/sr/results"))
      data = {
        items: rows.map((row) =>
          options.missingSrAfterReport && row.sale_id === "pending-sale"
            ? {
                ...row,
                comparison: {
                  ...row.comparison,
                  report_available: true,
                  sr_result: "NOT_RECORDED",
                },
              }
            : row,
        ),
        summary: { matched: 1, mismatch: 2, pending: 1 },
      };
    else if (path.endsWith("/sr/batches"))
      data = [
        {
          id: "batch-one",
          business_date: "2026-10-13",
          filename: "carrier-daily.xlsx",
          matched: 1,
          mismatch: 2,
          pending: 1,
        },
      ];
    else if (path.endsWith("/sr/batches/batch-one"))
      data = {
        filename: "carrier-daily.xlsx",
        business_date: "2026-10-13",
        changes: rows,
        comparison_source: options.legacy
          ? "CURRENT_SALE"
          : "SAVED_VERIFICATION",
      };
    else if (path.endsWith("/sr/email-status")) data = { configured: false };
    else if (path.endsWith("/sr/file"))
      data = {
        changes: rows,
        summary: { matched: 1, mismatch: 2, pending: 1 },
        errors: [],
        preview_token: "synthetic-preview",
        applied: !!request.postDataJSON().apply,
      };
    await route.fulfill({ json: data });
  });
}

test("SR results show the exact request-ID difference and related SR row without false matches", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/sr-verification");
  const comparison = page.getByLabel("SR comparison results");
  await expect(comparison.locator("tbody tr")).toHaveCount(4);
  await comparison.getByRole("button", { name: /^Mismatches/ }).click();
  await expect(comparison.locator("tbody tr")).toHaveCount(2);
  const different = comparison
    .locator("tbody tr")
    .filter({ hasText: "Different request" });
  await expect(different).toContainText("REQ-200");
  await expect(different).toContainText("REQ-OTHER");
  await expect(different).toContainText("Request IDs differ");
  await expect(different).toContainText("Report row 3");
  const missing = comparison
    .locator("tbody tr")
    .filter({ hasText: "Wrong SR customer" });
  await expect(missing).toContainText("SR-WRONG");
  await expect(missing).toContainText("Not found");
  await expect(missing).toContainText("Related row by request ID");
  await expect(missing).toContainText("SR-CORRECT · row 4");
  await expect(missing.getByText("Matched", { exact: true })).toHaveCount(0);
  await expect(
    different.getByRole("link", { name: "Different request" }),
  ).toHaveAttribute("href", "/sales?selected=request-mismatch");
  await comparison.getByRole("button", { name: /^Matched/ }).click();
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
  await expect(comparison).toContainText("Request IDs match");
});

test("pending verification uses truthful missing values and search narrows results", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/sr-verification");
  const comparison = page.getByLabel("SR comparison results");
  await comparison.getByRole("button", { name: /^Pending/ }).click();
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
  await expect(comparison).toContainText("Not recorded");
  await expect(comparison).toContainText("Not checked");
  await comparison.getByRole("button", { name: /^All sales/ }).click();
  await comparison.getByLabel("Search verification results").fill("REQ-200");
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
  await expect(comparison).toContainText("Different request");
});

test("a missing recorded SR remains explicit after a report has been uploaded", async ({
  page,
}) => {
  await setup(page, { missingSrAfterReport: true });
  await page.goto("/sr-verification");
  const comparison = page.getByLabel("SR comparison results");
  await comparison.getByRole("button", { name: /^Pending/ }).click();
  await expect(comparison).toContainText("SR not recorded");
  await expect(comparison).toContainText("Record SR to compare");
  await expect(comparison).not.toContainText("Not checked");
  await expect(comparison).not.toContainText("Awaiting comparison");
});

test("shared branch filter applies to per-sale comparisons", async ({
  page,
}) => {
  await setup(page, { branch: "marina" });
  await page.goto("/sr-verification");
  const comparison = page.getByLabel("SR comparison results");
  await expect(comparison.locator("tbody tr")).toHaveCount(3);
  await expect(
    comparison.getByText("Wrong SR customer", { exact: true }),
  ).toHaveCount(0);
});

test("sales managers can inspect saved comparisons but cannot import or apply", async ({
  page,
}) => {
  await setup(page, { manager: true });
  await page.goto("/sr-verification");
  await expect(page.getByLabel("Sales date")).toBeVisible();
  await expect(page.getByLabel("Daily SR report")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview matches" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View comparisons", exact: true })
    .click();
  await expect(page.locator(".sr-saved-comparison")).toContainText(
    "Values saved when this report was verified",
  );
  await expect(
    page.getByRole("button", { name: "Apply verification", exact: true }),
  ).toHaveCount(0);
});

test("legacy history explains that original comparison was not recorded", async ({
  page,
}) => {
  await setup(page, { legacy: true });
  await page.goto("/sr-verification");
  await page
    .getByRole("button", { name: "View comparisons", exact: true })
    .click();
  await expect(page.locator(".sr-saved-comparison")).toContainText(
    "Historical comparison was not recorded",
  );
  await expect(page.locator(".sr-saved-comparison")).toContainText(
    "does not change the verification result",
  );
});

test("preview retains comparison details after applying verification", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/sr-verification");
  await page.getByLabel("Daily SR report").setInputFiles({
    name: "daily.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("sr_number\nSR-100\n"),
  });
  await page
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Report preview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply verification", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Applied report comparison" }),
  ).toBeVisible();
  await expect(page.getByLabel("SR comparison results")).toContainText(
    "REQ-OTHER",
  );
  await expect(
    page.getByText("SR verification saved", { exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 1280, 1024, 390])
  test(`SR comparison controls fit at ${width}px`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/sr-verification");
    await expect(
      page.getByRole("heading", { name: "Daily SR verification", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBeTruthy();
    expect(
      await page
        .locator(".sr-comparison > .sales-table-wrap")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBeTruthy();
    expect(
      await page
        .locator(".sr-comparison-table td")
        .evaluateAll((cells) =>
          cells.every((cell) => cell.scrollHeight <= cell.clientHeight + 2),
        ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/demo82-sr-comparison-${width}.png`,
      fullPage: true,
    });
  });
