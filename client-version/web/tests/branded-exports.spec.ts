import { expect, Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function workspace(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    const data =
      path === "/api/auth/refresh"
        ? {
            access_token: "synthetic-export-token",
            user: {
              id: "export-user",
              name: "Export reviewer",
              role: "Administrator",
              permissions: ["read", "report.read", "audit.read"],
            },
          }
        : path === "/api/notifications"
          ? { items: [], unread: 0 }
          : path === "/api/resources/branches"
            ? [{ id: "branch-q", name: "Marina Branch" }]
            : [];
    await route.fulfill({ json: data });
  });
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reports & exports" }),
  ).toBeVisible();
}

test("Qanawat reports download all formats with the shared branch and date filters", async ({
  page,
}) => {
  await workspace(page);
  await expect(
    page.locator(".sidebar img[alt='Qanawat Connect Solutions LLC']"),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("branch-q");
  await page.getByLabel("From date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-11");
  await page.getByPlaceholder("Sales agent, branch, reference…").fill("Zayn");
  const report = page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "Historical daily activation" }),
    });
  for (const format of ["xlsx", "csv", "pdf"]) {
    let query: URLSearchParams | undefined;
    const content =
      format === "pdf"
        ? "%PDF-1.4\nQanawat"
        : format === "xlsx"
          ? "PK\u0003\u0004Qanawat"
          : "SR number,Phone\r\nSR-001,0500000000\r\n";
    await page.route("**/api/reports/daily?**", async (route) => {
      query = new URL(route.request().url()).searchParams;
      await route.fulfill({
        contentType:
          format === "pdf"
            ? "application/pdf"
            : format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "text/csv;charset=utf-8",
        headers: {
          "Content-Disposition": `attachment; filename="qanawat-daily-2026-10-01-2026-10-11.${format}"`,
        },
        body: content,
      });
    });
    const downloaded = page.waitForEvent("download");
    await report
      .getByRole("button", { name: format.toUpperCase(), exact: true })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(
      `qanawat-daily-2026-10-01-2026-10-11.${format}`,
    );
    expect((await readFile((await file.path())!)).toString()).toBe(content);
    expect(query?.get("branch_id")).toBe("branch-q");
    expect(query?.get("start")).toBe("2026-10-01");
    expect(query?.get("end")).toBe("2026-10-11");
    expect(query?.get("q")).toBe("Zayn");
    await page.unroute("**/api/reports/daily?**");
  }
});

test("failed export is explained and can be retried without a stuck loading state", async ({
  page,
}) => {
  await workspace(page);
  const report = page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "Historical daily activation" }),
    });
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: "Your export access was removed. Refresh your role." },
    }),
  );
  await report.getByRole("button", { name: "XLSX", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your export access was removed" }),
  ).toBeVisible();
  await expect(
    report.getByRole("button", { name: "XLSX", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".export-progress")).toHaveCount(0);
  await page.unroute("**/api/reports/daily?**");
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "SR,Status\nSR-001,Closed\n",
    }),
  );
  const downloaded = page.waitForEvent("download");
  await report.getByRole("button", { name: "CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /^qanawat-daily-.*\.csv$/,
  );
});

test("exports recover an expired token once and reject an empty file", async ({
  page,
}) => {
  await workspace(page);
  const report = page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "Historical daily activation" }),
    });
  let requests = 0;
  await page.route("**/api/reports/daily?**", async (route) => {
    requests += 1;
    await route.fulfill(
      requests === 1
        ? { status: 401, json: { detail: "Expired" } }
        : { contentType: "application/pdf", body: "" },
    );
  });
  await report.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "This export is empty" }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await expect(
    report.getByRole("button", { name: "PDF", exact: true }),
  ).toBeEnabled();
});
