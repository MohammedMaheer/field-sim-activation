import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

async function workspace(page: Page) {
  await previewBuild(page);
  const agents = [
    {
      id: "avery",
      name: "Avery Sales",
      employee_id: "QN-001",
      branch_id: "marina",
      branch: "Marina Branch",
      leader_id: "mira",
      leader: "Mira Rowan",
    },
    {
      id: "jordan",
      name: "Jordan Sales",
      employee_id: "QN-002",
      branch_id: "marina",
      branch: "Marina Branch",
      leader_id: "rayan",
      leader: "Rayan Alexander Vale",
    },
    {
      id: "unassigned",
      name: "New Sales Agent",
      employee_id: "QN-003",
      branch_id: "marina",
      branch: "Marina Branch",
      leader_id: null,
      leader: null,
    },
  ].map((row) => ({
    ...row,
    target: 20,
    activations: 2,
    achievement: 10,
    stock: 0,
    aht: 5,
    ekyc_rate: 100,
    ocr: 99,
    last_sync: "2026-10-13T08:00:00Z",
    status: "ACTIVE",
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: any = [];
    if (path === "/api/auth/refresh") {
      data = {
        access_token: "synthetic-assignment-readability",
        user: {
          id: "manager",
          name: "Sales manager",
          role: "Sales Manager",
          permissions: ["read", "report.read"],
        },
      };
    } else if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path === "/api/resources/branches") {
      data = [{ id: "marina", name: "Marina Branch" }];
    } else if (path === "/api/resources/agents") data = agents;
    else if (path === "/api/notifications") {
      data = { items: [], unread: 0, categories: [] };
    }
    await route.fulfill({ json: data });
  });
}

for (const width of [1440, 390]) {
  test(`sales agent assignments are explicit and readable at ${width}px`, async ({
    page,
  }) => {
    await workspace(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/agents");
    await expect(
      page.getByRole("heading", { name: "Sales agent management" }),
    ).toBeVisible();
    const rows = page.locator(".table-shell tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(
      rows.nth(0).locator('td[data-label="Team leader"]'),
    ).toHaveText("Mira Rowan");
    await expect(
      rows.nth(1).locator('td[data-label="Team leader"]'),
    ).toHaveText("Rayan Alexander Vale");
    // A second leader in the same branch must never substitute a missing assignment.
    await expect(
      rows.nth(2).locator('td[data-label="Team leader"]'),
    ).toHaveText("Not assigned");
    await expect(rows.nth(0).locator(".person-cell small")).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(rows.nth(0).locator(".person-cell small")).toHaveCSS(
      "font-weight",
      "500",
    );
    await expect(rows.nth(0).locator(".person-cell small")).toHaveCSS(
      "color",
      "rgb(78, 92, 115)",
    );
    await page
      .getByRole("textbox", { name: "Search records" })
      .fill("Rayan Alexander Vale");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Jordan Sales");
    await page
      .getByRole("button", { name: "View Jordan Sales", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Sales agent workspace" });
    const assignment = dialog.locator('[aria-label="Sales agent assignment"]');
    await expect(assignment).toContainText("Marina Branch");
    await expect(assignment).toContainText("Rayan Alexander Vale");
    await expect(assignment.locator("dt")).toHaveText([
      "Branch",
      "Team leader",
    ]);
    await expect(
      dialog.getByRole("button", { name: "Change branch or team leader" }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Inventory", exact: true })
      .click();
    await expect(assignment).toBeVisible();
    await expect(assignment).toContainText("Rayan Alexander Vale");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const overlap = await assignment.evaluate((element) => {
      return [...element.querySelectorAll("div")].some((row) => {
        const label = row.querySelector("dt")!.getBoundingClientRect();
        const value = row.querySelector("dd")!.getBoundingClientRect();
        return label.bottom > value.top;
      });
    });
    expect(overlap).toBe(false);
    await page.screenshot({
      path: `../output/qa/sales-agent-assignment-82-${width}.png`,
      animations: "disabled",
    });
  });
}

test("missing leader is clearly unassigned in the sales agent workspace", async ({
  page,
}) => {
  await workspace(page);
  await page.goto("/agents");
  await page
    .getByRole("button", { name: "View New Sales Agent", exact: true })
    .click();
  const assignment = page
    .getByRole("dialog")
    .locator('[aria-label="Sales agent assignment"]');
  await expect(assignment).toContainText("Marina Branch");
  await expect(assignment).toContainText("Not assigned");
  await expect(assignment).not.toContainText("Mira Rowan");
  await expect(assignment).not.toContainText("Rayan Alexander Vale");
});
