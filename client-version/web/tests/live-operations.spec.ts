import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

const agents = [
  {
    id: "sample-zayn",
    name: "Zayn Mercer",
    employee_id: "SAMPLE-001",
    branch_id: "marina",
    branch: "Marina Branch",
    outlet: "Marina Branch",
    status: "ACTIVE",
    on_shift: true,
    activations: 7,
    achievement: 35,
    stock: 3,
    aht: 6,
    ekyc_rate: 98,
    ocr: 96,
    last_sync: "2026-10-09T08:05:00Z",
  },
  {
    id: "sample-leila",
    name: "Leila Arden",
    employee_id: "SAMPLE-002",
    branch_id: "downtown",
    branch: "Downtown Branch",
    outlet: "Downtown Branch",
    status: "INACTIVE",
    on_shift: false,
    activations: 2,
    achievement: 10,
    stock: 18,
    aht: 8,
    ekyc_rate: 99,
    ocr: 97,
    last_sync: "2026-10-09T08:00:00Z",
  },
];

async function liveOperationsFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/api/auth/refresh") {
      data = {
        access_token: "synthetic-access",
        user: {
          id: "sample-admin",
          name: "Sample Administrator",
          role: "Administrator",
          permissions: ["read"],
        },
      };
    } else if (url.pathname === "/api/notifications") {
      data = { items: [], unread: 0 };
    } else if (url.pathname === "/api/events/stream") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    } else if (url.pathname === "/api/resources/branches") {
      data = [
        { id: "marina", name: "Marina Branch" },
        { id: "downtown", name: "Downtown Branch" },
      ];
    } else if (url.pathname === "/api/resources/agents") {
      const branch = url.searchParams.get("branch_id");
      data = agents.filter((agent) => !branch || agent.branch_id === branch);
    }
    await route.fulfill({ json: data });
  });
}

for (const width of [1440, 390]) {
  test(`live operations renders named columns and keeps controls usable at ${width}px`, async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await previewBuild(page);
    await liveOperationsFixture(page);
    await page.goto("/live");
    await expect(
      page.getByRole("heading", { name: "Live operations", exact: true }),
    ).toBeVisible();
    const table = page.locator(".table-shell");
    await expect(table.locator("thead th")).toHaveText([
      "Status",
      "Sales agent",
      "Outlet / branch",
      "Activations",
      "Daily target",
      "Stock",
      "Last sync",
      "Details",
    ]);
    const zayn = table.locator("tbody tr").filter({ hasText: "Zayn Mercer" });
    await expect(zayn.locator('[data-label="Activations"]')).toHaveText("7");
    await expect(zayn.locator('[data-label="Daily target"]')).toHaveText("35%");
    await expect(zayn.locator('[data-label="Stock"]')).toHaveText("3");
    await page.screenshot({
      path: `../output/qa/live-operations-${width}.png`,
      fullPage: true,
    });

    await page
      .getByRole("textbox", { name: "Search records" })
      .fill("No such agent");
    await expect(
      page.getByText("No matching records", { exact: true }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Search records" }).fill("");
    if (width < 600) {
      await page
        .getByRole("combobox", { name: "Sort records" })
        .selectOption("stock");
      await page
        .getByRole("button", { name: "Reverse sort direction" })
        .click();
    } else {
      await table.getByRole("button", { name: "Stock", exact: true }).click();
      await table.getByRole("button", { name: "Stock", exact: true }).click();
    }
    await expect(table.locator("tbody tr").first()).toContainText(
      "Leila Arden",
    );
    await zayn.getByRole("button", { name: "Zayn Mercer" }).click();
    await expect(
      page.getByRole("dialog", { name: "Sales agent workspace" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close details" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: /Active shifts/ }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator("tbody tr")).toContainText("Zayn Mercer");
    await page.getByRole("button", { name: /Active shifts/ }).click();
    await page
      .getByRole("combobox", { name: "Branch", exact: true })
      .selectOption("downtown");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator("tbody tr")).toContainText("Leila Arden");
    expect(failures).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}
