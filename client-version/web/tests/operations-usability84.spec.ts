import { expect, Page, test } from "@playwright/test";
import { businessDate } from "../src/businessTime";

async function workspace(
  page: Page,
  permissions = ["read", "report.read", "inventory.write"],
  role = "Administrator",
) {
  let quantity = 8;
  const mutations: unknown[] = [],
    exports: URL[] = [],
    failures: string[] = [];
  let rejectAdjustment = false;
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path.includes("/export") || path.startsWith("/api/reports/")) {
      exports.push(url);
      return route.fulfill({
        contentType: "text/csv",
        body: "Date,Amount\n2026-10-14,125\n",
      });
    }
    if (path === "/api/field-assets/stock-one/adjust") {
      mutations.push(request.postDataJSON());
      if (rejectAdjustment)
        return route.fulfill({
          status: 409,
          json: {
            detail:
              "Stock changed. Reload the current balance before trying again.",
          },
        });
      quantity += request.postDataJSON().delta;
      return route.fulfill({ json: { id: "stock-one", quantity } });
    }
    let data: unknown = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-usability-check",
        user: {
          id: "usability-reviewer",
          name: "Usability reviewer",
          role,
          permissions,
        },
      };
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/branches")
      data = [{ id: "branch-one", name: "Marina Branch" }];
    else if (path === "/api/organization")
      data = {
        branches: [{ id: "branch-one", name: "Marina Branch" }],
        leaders: [],
      };
    else if (path === "/api/field-assets")
      data = [
        {
          id: "stock-one",
          category: "UNIFORM",
          label: "Branch uniforms",
          serial: "Not recorded",
          quantity,
          branch_id: "branch-one",
          branch: "Marina Branch",
          agent_id: null,
          agent: "Unassigned",
          status: "AVAILABLE",
        },
      ];
    return route.fulfill({ json: data });
  });
  return {
    mutations,
    exports,
    failures,
    reject: () => (rejectAdjustment = true),
  };
}

test("stock adjustment shows the new balance before saving and rejects an excessive reduction", async ({
  page,
}) => {
  const audit = await workspace(page);
  await page.goto("/equipment");
  await page.getByRole("button", { name: "Adjust qty", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Adjust stock quantity" });
  await dialog
    .getByLabel("Adjustment type", { exact: true })
    .selectOption("remove");
  await dialog.getByLabel("Adjustment quantity", { exact: true }).fill("9");
  await dialog
    .getByLabel("Reason for adjustment", { exact: true })
    .fill("Corrected branch count");
  await expect(dialog.getByRole("alert")).toContainText(
    "You can remove up to 8 items",
  );
  await expect(
    dialog.getByRole("button", { name: "Review adjustment", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Adjustment quantity", { exact: true }).fill("3");
  await expect(
    dialog.getByRole("region", { name: "Stock adjustment summary" }),
  ).toContainText("Quantity after adjustment5");
  await dialog
    .getByRole("button", { name: "Review adjustment", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Review stock adjustment" }),
  ).toContainText("8 → 5");
  expect(audit.mutations).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Save stock adjustment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(audit.mutations).toEqual([
    { delta: -3, reason: "Corrected branch count" },
  ]);
  expect(audit.failures).toEqual([]);
});

test("stock adjustment preserves the review when the server rejects a stale change", async ({
  page,
}) => {
  const audit = await workspace(page);
  audit.reject();
  await page.goto("/equipment");
  await page.getByRole("button", { name: "Adjust qty", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Adjust stock quantity" });
  await dialog.getByLabel("Adjustment quantity", { exact: true }).fill("2");
  await dialog
    .getByLabel("Reason for adjustment", { exact: true })
    .fill("Received two uniforms");
  await dialog
    .getByRole("button", { name: "Review adjustment", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save stock adjustment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Stock changed");
  await expect(
    dialog.getByRole("region", { name: "Review stock adjustment" }),
  ).toContainText("8 → 10");
  await dialog
    .getByRole("button", { name: "Back to edit", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Reason for adjustment", { exact: true }),
  ).toHaveValue("Received two uniforms");
  expect(audit.failures).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`report date controls precede downloads, recover invalid dates and fit ${width}px`, async ({
    page,
  }, info) => {
    const audit = await workspace(page);
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/reports");
    const period = page.getByRole("region", { name: "Report date range" });
    const from = period.getByLabel("From date", { exact: true }),
      to = period.getByLabel("To date", { exact: true });
    await expect(from).toHaveValue(businessDate());
    await expect(to).toHaveValue(businessDate());
    const download = page.getByRole("button", {
      name: "Export incentive tracking",
      exact: true,
    });
    expect((await period.boundingBox())!.y).toBeLessThan(
      (await download.boundingBox())!.y,
    );
    await from.fill("2026-10-20");
    await to.fill("2026-10-01");
    await expect(period.getByRole("alert")).toBeVisible();
    await expect(download).toBeDisabled();
    await page.getByRole("button", { name: "This month", exact: true }).click();
    await expect(from).toHaveValue(`${businessDate().slice(0, 7)}-01`);
    await expect(to).toHaveValue(businessDate());
    await expect(download).toBeEnabled();
    await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(audit.exports[0].searchParams.get("from_date")).toBe(
      `${businessDate().slice(0, 7)}-01`,
    );
    expect(audit.exports[0].searchParams.get("to_date")).toBe(businessDate());
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`reports-usability-${width}.png`),
      fullPage: true,
    });
    expect(audit.failures).toEqual([]);
  });
}

test("revoked stock and report export grants hide mutation controls", async ({
  page,
}) => {
  const audit = await workspace(page, ["read"], "Sales Manager");
  await page.goto("/equipment");
  await expect(
    page.getByRole("heading", { name: "Assets & supplies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adjust qty", exact: true }),
  ).toHaveCount(0);
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reports & exports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Export incentive tracking",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "XLSX", exact: true }).first(),
  ).toBeDisabled();
  expect(audit.failures).toEqual([]);
});
